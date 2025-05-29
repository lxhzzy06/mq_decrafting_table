import { getOctokit } from "@actions/github";
import { exec } from "@actions/exec";
import { HttpClient } from "@actions/http-client";
import { exit } from "process";
import { createWriteStream, promises, readdirSync, readFileSync, writeFileSync } from "fs";
import * as compressing from "compressing";
import crypto from "crypto";
import sleep from "atomic-sleep";
import { build } from "./gulpfile.js";
import { log } from "console";
import sodium from "libsodium-wrappers";
import core from "@actions/core";
import axios from "axios";

const folderId = 11163835;
const headers = { authorization: `Bearer ${process.env.TOKEN123}`, platform: "open_platform" };

const octokit = getOctokit(process.env.GITHUB_TOKEN);
const latest_release = (await octokit.rest.repos.listReleases({ owner: "Mojang", repo: "bedrock-samples" })).data[0];

octokit.rest.repos
  .getReleaseByTag({ owner: "lxhzzy06", repo: "mq_decrafting_table", tag: latest_release.tag_name })
  .then(() => {
    log("没有新的版本");
    exit(0);
  })
  .catch(async (e) => {
    if (e.status === 404) {
      const body = `[Action] 自动为${latest_release.prerelease ? "预览版" : "正式版"}: [${latest_release.name}](${
        latest_release.html_url
      }) 构建并发布包`;
      log("新的版本:", latest_release.tag_name);
      const release = await octokit.rest.repos.createRelease({
        owner: "lxhzzy06",
        repo: "mq_decrafting_table",
        tag_name: latest_release.tag_name,
        name: latest_release.name,
        body,
        prerelease: latest_release.prerelease,
      });

      log("下载源代码", latest_release.zipball_url);
      const writer = createWriteStream("./bedrock-samples.zip", { encoding: "binary" });

      const http = new HttpClient();
      writer.write(await (await http.get(latest_release.zipball_url, { "User-Agent": "Awesome - Octocat - App" })).readBodyBuffer());
      writer.end();

      writer.on("close", async () => {
        await exec("ls -l");

        log("解压文件");
        await compressing.zip.uncompress("./bedrock-samples.zip", "./bedrock-samples");

        log("处理配方文件");
        await exec("cargo run -r", [], { cwd: "./mq_decrating_table-rs" });

        for (const file of readdirSync("./pack/mq_decrafting_table_bp/texts").concat(readdirSync("./pack/mq_decrafting_table_rp/texts"))) {
          if (file.includes(".lang")) {
            writeFileSync(
              `./pack/mq_decrafting_table_bp/texts/${file}`,
              readFileSync(`./pack/mq_decrafting_table_bp/texts/${file}`, { encoding: "utf-8" }).replace("$TAG", latest_release.tag_name)
            );
            writeFileSync(
              `./pack/mq_decrafting_table_rp/texts/${file}`,
              readFileSync(`./pack/mq_decrafting_table_rp/texts/${file}`, { encoding: "utf-8" }).replace("$TAG", latest_release.tag_name)
            );
          }
        }

        log("打包文件");
        build().then(() =>
          setTimeout(async () => {
            log("上传 Release 文件");
            const file = await promises.readFile("./target/mq_decrafting_table.mcaddon");
            await octokit.rest.repos.uploadReleaseAsset({
              owner: "lxhzzy06",
              repo: "mq_decrafting_table",
              release_id: release.data.id,
              name: `mq_decrafting_table-${latest_release.tag_name}.mcaddon`,
              data: file,
              mediaType: "application/zip",
              headers: { "content-type": "application/zip", "content-length": file.length },
            });
            log("成功发布");

            log("上传到 123pan");
            if (JSON.parse(await (await http.get("https://open-api.123pan.com/api/v1/user/info", headers)).readBody()).code === 401) {
              log("更新 token");
              const { key, key_id } = (await octokit.rest.actions.getRepoPublicKey({ owner: "lxhzzy06", repo: "mq_decrafting_table" })).data;

              const secretValue = (
                await http.postJson(
                  "https://open-api.123pan.com/api/v1/access_token",
                  {
                    client_id: process.env.CLIENT_ID,
                    client_secret: process.env.CLIENT_SECRET,
                  },
                  { platform: "open_platform" }
                )
              ).result.data.accessToken;
              core.setSecret(secretValue);

              await sodium.ready;
              const binaryKey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
              const binarySecret = sodium.from_string(secretValue);
              const encryptedBytes = sodium.crypto_box_seal(binarySecret, binaryKey);
              const encrypted_value = sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);

              octokit.rest.actions.createOrUpdateRepoSecret({
                owner: "lxhzzy06",
                repo: "mq_decrafting_table",
                secret_name: "TOKEN123",
                encrypted_value,
                key_id,
              });
              headers.authorization = `Bearer ${secretValue}`;
              log("更新 token 成功");
            }
            log("Token 校验完毕");

            const create = (
              await http.postJson(
                "https://open-api.123pan.com/upload/v1/file/create",
                {
                  parentFileId: folderId,
                  filename: `MQ的分解台-${latest_release.tag_name}.mcaddon`,
                  etag: crypto.createHash("md5").update(file).digest("hex"),
                  size: file.length,
                },
                headers
              )
            ).result.data;

            if (create.reuse === false) {
              log("上传文件...");
              const presignedURL = (
                await http.postJson(
                  "https://open-api.123pan.com/upload/v1/file/get_upload_url",
                  {
                    preuploadID: create.preuploadID,
                    sliceNo: 1,
                  },
                  headers
                )
              ).result.data.presignedURL;
              await axios.put(presignedURL, file);

              const upload = (
                await http.postJson(
                  "https://open-api.123pan.com/upload/v1/file/upload_complete",
                  {
                    preuploadID: create.preuploadID,
                  },
                  headers
                )
              ).result.data;

              log(upload);

              if (upload.async) {
                let result;
                do {
                  result = (
                    await http.postJson(
                      "https://open-api.123pan.com/upload/v1/file/upload_async_result",
                      { preuploadID: create.preuploadID },
                      headers
                    )
                  ).result.data;
                  log(result);
                  sleep(1000);
                } while (result.completed === false);
                log("轮询完成", result);
              }
            } else {
              log("秒传完毕");
            }

            if (latest_release.prerelease === false) {
              log("发布到CF");
              const base_url = "https://minecraft-bedrock.curseforge.com";
              const id = JSON.parse(await (await http.get(base_url + "/api/game/versions?token=" + process.env.CF_API_TOKEN)).readBody()).find(
                (version) => version.name === latest_release.tag_name.slice(1, 8)
              ).id;

              const metadata = {
                changelog: `[Auto] - Compatibility update for ${latest_release.tag_name} `,
                changelogType: "markdown",
                displayName: `mq's decrafting table-${latest_release.tag_name}.mcaddon`,
                gameVersions: [id],
                releaseType: "release",
              };
              const form = new FormData();
              form.append("file", fs.readFileSync("./target/mq_decrafting_table.mcaddon"), {
                filename: `mq_decrafting_table-${latest_release.tag_name}.mcaddon`,
              });
              form.append("metadata", JSON.stringify(metadata));
              const response = await http.post(base_url + "/api/projects/1263630/upload-file", form, {
                "X-Api-Token": token,
                ...form.getHeaders(),
              });

              log(await response.readBody());
            }
            exit(0);
          }, 3000)
        );
      });
    }
  });
