import { getOctokit } from "@actions/github";
import { exec } from "@actions/exec";
import { HttpClient } from "@actions/http-client";
import { exit } from "process";
import path from "path";
import fs, { createReadStream, promises, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import * as compressing from "compressing";
import crypto from "crypto";
import sleep from "atomic-sleep";
import { build } from "./gulpfile.js";
import { log } from "console";
import sodium from "libsodium-wrappers";
import core from "@actions/core";
import axios from "axios";
import FormData from "form-data";
import { matchGameVersion, versionCandidates } from "./scripts/cf-version.mjs";
import { selectQueue, resolvePrerelease, TAG_RE, versionKey } from "./scripts/ci-versions.mjs";
import { panData } from './scripts/pan-response.mjs';

const OWNER = "lxhzzy06";
const REPO = "mq_decrafting_table";
const UPSTREAM = { owner: "Mojang", repo: "bedrock-samples" };
const FOLDER_123 = 11163835;
const CF_PROJECT = 1263630;

/// 只补最近几个版本系列(如 1.26.60.x / 1.26.50.x / 1.26.40.x), 否则仓库里 200 多个历史 tag 会被一起翻出来
const SERIES = Number(process.env.MQDT_SERIES ?? 3);
/// 单次运行最多构建几个版本, 剩下的留给下一次夜间任务
const MAX_PER_RUN = Number(process.env.MQDT_MAX_PER_RUN ?? 4);

/// 本地演练: 只做发现/下载/生成/打包, 不建 release、不传网盘、不发商店
const DRY_RUN = process.env.MQDT_DRY_RUN === "1";
/// 下载与解压位置, 默认 ./bedrock-samples; 本地演练时要指向别处, 免得清掉开发者自己的签出
const SAMPLES_DIR = process.env.MQDT_SAMPLES_DIR ?? "./bedrock-samples";
const SAMPLES_ZIP = process.env.MQDT_SAMPLES_ZIP ?? "./bedrock-samples.zip";

const octokit = getOctokit(process.env.GITHUB_TOKEN);
const http = new HttpClient();
const headers = { authorization: `Bearer ${process.env.TOKEN123}`, platform: "open_platform" };
const secrets = () => [process.env.GITHUB_TOKEN, process.env.CF_API_TOKEN, process.env.TOKEN123, process.env.CLIENT_SECRET].filter(Boolean);

/// 出错信息可能带上传 URL, 打印前先把已知凭据打码
function redact(text) {
  let out = String(text);
  for (const s of secrets()) out = out.split(s).join("***");
  return out;
}
function warn(...args) {
  log("::warning::", redact(args.join(" ")));
}

/**
 * 待发布版本 = 上游 release 对象 ∪ 上游 tag。
 *
 * 只看 listReleases()[0] 会永久漏掉正式版: 正式版 tag 常常比同系列的 preview 晚几天才有
 * release 对象(或像 v1.26.40.5 那样根本没有 release 对象), 那时 data[0] 已经被更新的 preview 占掉。
 */
async function discover() {
  const fixedTag = process.env.MQDT_UPSTREAM_TAG;
  const releaseTag = process.env.MQDT_RELEASE_TAG;
  if (releaseTag && (!fixedTag || !/^v\d+\.\d+\.\d+$/.test(releaseTag))) throw new Error("新版本发布须指定官方标签与有效附加包版本号");
  if (fixedTag) {
    if (!TAG_RE.test(fixedTag) || versionKey(fixedTag)[2] < 50) throw new Error("原生库存要求 1.26.50 或更新的官方语料");
    // Resolve the upstream ref before creating any release or deleting downloaded data.
    await octokit.rest.repos.getCommit({ ...UPSTREAM, ref: fixedTag });
    const version = { tag: fixedTag, releaseTag: releaseTag || fixedTag,
      name: releaseTag ? `MQ's Decrafting Table ${releaseTag} — Bedrock 26.50 / 26.52` : fixedTag,
      prerelease: fixedTag.endsWith('-preview'), upstreamPrerelease: undefined,
      zipball: `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}/archive/refs/tags/${fixedTag}.zip`,
      source: `tree/${fixedTag}` };
    return { queue: [version], total: 1, deferred: 0 };
  }
  const [releases, tags, ours] = await Promise.all([
    octokit.paginate(octokit.rest.repos.listReleases, { ...UPSTREAM, per_page: 100 }),
    octokit.paginate(octokit.rest.repos.listTags, { ...UPSTREAM, per_page: 100 }),
    octokit.paginate(octokit.rest.repos.listReleases, { owner: OWNER, repo: REPO, per_page: 100 }),
  ]);

  const byTag = new Map();
  for (const name of tags.map((t) => t.name)) {
    if (!TAG_RE.test(name)) continue;
    byTag.set(name, {
      tag: name,
      name,
      prerelease: name.endsWith("-preview"),
      zipball: `https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}/archive/refs/tags/${name}.zip`,
      source: `tree/${name}`,
      upstreamPrerelease: undefined,
    });
  }
  // release 对象信息更全(标题、是否预发布、zipball), 覆盖同名 tag
  for (const r of releases) {
    if (!TAG_RE.test(r.tag_name)) continue;
    byTag.set(r.tag_name, {
      tag: r.tag_name,
      name: r.name ?? r.tag_name,
      prerelease: !!r.prerelease,
      zipball: r.zipball_url,
      source: `releases/tag/${r.tag_name}`,
      upstreamPrerelease: !!r.prerelease,
    });
  }

  const compatible = [...byTag.values()].filter(v => {
    const key = versionKey(v.tag);
    return key && (key[1] > 26 || (key[1] === 26 && key[2] >= 50));
  });
  const { queue, missing, deferred } = selectQueue(compatible, {
    published: ours.map((r) => r.tag_name),
    series: SERIES,
    maxPerRun: MAX_PER_RUN,
  });
  return { queue, total: missing, deferred };
}

/** `$TAG` 在首次构建时就会被替换掉, 所以先留一份原始内容, 保证多版本连发时各自写自己的 tag */
const LANG_DIRS = ["./pack/mq_decrafting_table_bp/texts", "./pack/mq_decrafting_table_rp/texts"];
const langTemplates = LANG_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((file) => file.endsWith(".lang"))
    .map((file) => [`${dir}/${file}`, readFileSync(`${dir}/${file}`, "utf-8")])
);

function applyLang(tag) {
  for (const [path, template] of langTemplates) {
    writeFileSync(path, template.replaceAll("$TAG", tag));
  }
}

async function downloadAndGenerate(version) {
  const body = await (await http.get(version.zipball, { "User-Agent": "mq_decrafting_table - GitHub Actions" })).readBodyBuffer();
  if (!body?.length) throw new Error(`下载的 ${version.tag} 源码包为空`);
  writeFileSync(SAMPLES_ZIP, body);

  log("解压文件");
  const samplesTarget = path.resolve(SAMPLES_DIR);
  const workspaceRoot = path.resolve('.');
  if (!samplesTarget.startsWith(workspaceRoot + path.sep) || existsSync(path.join(samplesTarget, '.git'))) {
    throw new Error('拒绝清理工作区外路径或已初始化的 Git 签出，请指定独立下载目录');
  }
  rmSync(samplesTarget, { recursive: true, force: true });
  await compressing.zip.uncompress(SAMPLES_ZIP, SAMPLES_DIR);

  log("处理配方文件");
  // 显式指向刚解压出来的语料: 生成器默认路径靠 cwd 推断, 隐式耦合会让它读到开发者本地那份旧签出
  await exec("cargo run -r --quiet", [], {
    cwd: "./mq_decrating_table-rs",
    env: { ...process.env, MQDT_SRC_DIR: path.resolve(SAMPLES_DIR) },
  });
  await exec(process.execPath, ["scripts/gen-index.mjs"]);
}

async function uploadTo123(file, version) {
  log("上传到 123pan");
  const userInfo = JSON.parse(await (await http.get("https://open-api.123pan.com/api/v1/user/info", headers)).readBody());
  if (userInfo.code === 401) {
    log("更新 token");
    const { key: publicKey, key_id } = (await octokit.rest.actions.getRepoPublicKey({ owner: OWNER, repo: REPO })).data;
    const secretValue = panData((
      await http.postJson(
        "https://open-api.123pan.com/api/v1/access_token",
        { client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET },
        { platform: "open_platform" }
      )
    ).result, 'access_token').accessToken;
    if (!secretValue) throw new Error('access_token: token missing');
    core.setSecret(secretValue);

    await sodium.ready;
    const encrypted = sodium.to_base64(
      sodium.crypto_box_seal(sodium.from_string(secretValue), sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL)),
      sodium.base64_variants.ORIGINAL
    );
    // 原来没 await: 任务可能在密钥写入前就结束, 下次仍用过期的 TOKEN123
    await octokit.rest.actions.createOrUpdateRepoSecret({
      owner: OWNER,
      repo: REPO,
      secret_name: "TOKEN123",
      encrypted_value: encrypted,
      key_id,
    });
    headers.authorization = `Bearer ${secretValue}`;
    log("更新 token 成功");
  } else {
    panData(userInfo, 'user/info');
  }
  log("Token 校验完毕");

  const create = panData((
    await http.postJson(
      "https://open-api.123pan.com/upload/v1/file/create",
      {
        parentFileId: FOLDER_123,
        filename: `MQ的分解台-${version.releaseTag ?? version.tag}.mcaddon`,
        etag: crypto.createHash("md5").update(file).digest("hex"),
        size: file.length,
      },
      headers
    )
  ).result, 'file/create');

  if (create.reuse === true) {
    log("秒传完毕");
    return;
  }

  log("上传文件...");
  if (!create.preuploadID) throw new Error('file/create: preuploadID missing');
  const presignedURL = panData((
    await http.postJson(
      "https://open-api.123pan.com/upload/v1/file/get_upload_url",
      { preuploadID: create.preuploadID, sliceNo: 1 },
      headers
    )
  ).result, 'get_upload_url').presignedURL;
  if (!presignedURL) throw new Error('get_upload_url: URL missing');
  await axios.put(presignedURL, file);

  const complete = panData((
    await http.postJson("https://open-api.123pan.com/upload/v1/file/upload_complete", { preuploadID: create.preuploadID }, headers)
  ).result, 'upload_complete');
  if (!complete.async) return;

  for (let i = 0; i < 60; i++) {
    const result = panData((
      await http.postJson("https://open-api.123pan.com/upload/v1/file/upload_async_result", { preuploadID: create.preuploadID }, headers)
    ).result, 'upload_async_result');
    // 只打状态, 响应里的 fileId/URL 属于可访问资源标识, 不进公开日志
    log("123pan 合并中...", result.completed === true ? "done" : "pending");
    if (result.completed === true) return;
    sleep(1000);
  }
  throw new Error("123pan 上传在 60 次轮询后仍未完成");
}

async function publishToCurseForge(packagePath, version) {
  const cfToken = process.env.CF_API_TOKEN;
  if (!cfToken) {
    throw new Error("缺少 CF_API_TOKEN，无法发布 CurseForge");
  }
  log("发布到 CurseForge");
  const baseUrl = "https://minecraft-bedrock.curseforge.com";
  // 沿用官方文档的鉴权写法(版本列表走 query token, 上传走 X-Api-Token 头); 凭据统一由 redact() 打码后才可能进日志
  const versions = JSON.parse(await (await http.get(`${baseUrl}/api/game/versions?token=${cfToken}`)).readBody());
  // CurseForge 面向玩家, 版本清单跟随年份编号(26.xx); 而发布 tag 是内部编号(1.26.xx), 两侧都要能匹配
  const matched = matchGameVersion(version.tag, versions);
  if (!matched) {
    throw new Error(`未匹配到 CurseForge 游戏版本 ${version.tag}, 候选 ${versionCandidates(version.tag).join(", ")}`);
  }

  const form = new FormData();
  form.append("file", createReadStream(packagePath), { filename: `mq_decrafting_table-${version.releaseTag ?? version.tag}.mcaddon` });
  form.append(
    "metadata",
    JSON.stringify({
      changelog: version.changelog ?? `[Auto] - Compatibility update for ${version.tag} `,
      changelogType: "markdown",
      displayName: `mq's decrafting table-${version.releaseTag ?? version.tag}.mcaddon`,
      gameVersions: [matched.id],
      releaseType: version.prerelease ? "beta" : "release",
    })
  );
  const response = await axios.post(`${baseUrl}/api/projects/${CF_PROJECT}/upload-file`, form, {
    headers: { "X-Api-Token": cfToken, ...form.getHeaders() },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  log("CurseForge 返回", response.status);
}

/** 读上游签出的 version.json, 取该 tag 对应的版本记录(可能没有) */
function upstreamVersionRecord(tag) {
  const wanted = tag.replace(/^v/, "");
  const roots = [
    SAMPLES_DIR,
    ...readdirSync(SAMPLES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${SAMPLES_DIR}/${entry.name}`),
  ];
  for (const root of roots) {
    const file = `${root}/version.json`;
    if (!existsSync(file)) continue;
    const json = JSON.parse(readFileSync(file, "utf-8"));
    const record = json[wanted] ?? (json.latest?.version === wanted ? json.latest : undefined);
    if (record) return record;
  }
  return undefined;
}

async function buildOne(version, results) {
  log(`==== ${version.tag} ====`);
  await downloadAndGenerate(version);
  version.prerelease = resolvePrerelease({ upstreamPrerelease: version.upstreamPrerelease, record: upstreamVersionRecord(version.tag) });
  log(version.prerelease ? "预览版" : "正式版", version.tag);
  const releaseTag = version.releaseTag ?? version.tag;
  const notesFile = /^v\d+\.\d+\.\d+$/.test(releaseTag)
    ? `./docs/RELEASE_NOTES_${releaseTag.slice(1)}.md` : undefined;
  version.changelog = notesFile && existsSync(notesFile) ? readFileSync(notesFile, 'utf-8') : undefined;
  applyLang(releaseTag);

  log("打包文件");
  const packagePath = await build();
  const file = await promises.readFile(packagePath);

  if (DRY_RUN) {
    log(`[dry-run] 将创建 release ${version.tag} (prerelease=${version.prerelease}) 并挂上 mq_decrafting_table-${version.tag}.mcaddon (${file.length} 字节)`);
    return;
  }
  const release = await octokit.rest.repos.createRelease({
    owner: OWNER,
    repo: REPO,
    tag_name: releaseTag,
    target_commitish: process.env.GITHUB_SHA || undefined,
    name: version.name,
    body: version.changelog ?? `[Action] 自动为${version.prerelease ? "预览版" : "正式版"}: [${version.name}](https://github.com/${UPSTREAM.owner}/${UPSTREAM.repo}/${version.source}) 构建并发布包`,
    prerelease: version.prerelease,
  });

  await octokit.rest.repos.uploadReleaseAsset({
    owner: OWNER,
    repo: REPO,
    release_id: release.data.id,
    name: `mq_decrafting_table-${releaseTag}.mcaddon`,
    data: file,
    mediaType: "application/zip",
    headers: { "content-type": "application/zip", "content-length": file.length },
  });
  log("GitHub Release 已发布:", release.data.html_url);

  // 网盘和商店各自失败不影响对方, 但都必须被记下来
  if (DRY_RUN) {
    log(`[dry-run] 跳过 123pan${version.prerelease ? "" : " 与 CurseForge"} 上传 (${version.tag})`);
    return;
  }
  try {
    await uploadTo123(file, version);
  } catch (e) {
    results.notes.push(`${version.tag} 123pan: ${redact(e.message)}`);
    warn(`${version.tag} 的 123pan 上传失败: ${redact(e.message)}`);
  }

  if (!version.prerelease) {
    try {
      await publishToCurseForge(packagePath, version);
    } catch (e) {
      results.notes.push(`${version.tag} CurseForge: ${redact(e.message)}`);
      warn(`${version.tag} 的 CurseForge 发布失败: ${redact(e.message)}`);
    }
  }
}

const results = { ok: [], notes: [] };
// Retry a failed mirror using the exact already-published bytes. Other channels
// are left alone, so recovery cannot create duplicate releases or store files.
if (process.env.MQDT_RETRY_123 === 'true') {
  const tag = process.env.MQDT_RELEASE_TAG;
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('云盘重试须指定附加包版本标签');
  try {
    const release = (await octokit.rest.repos.getReleaseByTag({ owner: OWNER, repo: REPO, tag })).data;
    const asset = release.assets.find(a => a.name === `mq_decrafting_table-${tag}.mcaddon` && a.state === 'uploaded');
    if (!asset || release.draft) throw new Error('已公开的正式包不存在');
    const file = await (await http.get(asset.browser_download_url)).readBodyBuffer();
    if (file.length !== asset.size) throw new Error('下载的发布包大小不符');
    if (asset.digest && asset.digest !== `sha256:${crypto.createHash('sha256').update(file).digest('hex')}`) throw new Error('下载的发布包校验不符');
    await uploadTo123(file, { releaseTag: tag });
    log(`123pan ${tag} 上传完成，使用 GitHub 已发布的原始包`);
    exit(0);
  } catch (e) {
    core.setFailed(redact(e.message));
    exit(1);
  }
}
const { queue, total, deferred } = await discover();
log(`待发布版本共 ${total} 个, 本轮处理 ${queue.length} 个:`, queue.map((v) => v.tag).join(", ") || "(无)");
if (deferred) log(`还有 ${deferred} 个在窗口内但超出单次上限, 留给后续运行`);

for (const version of queue) {
  try {
    await buildOne(version, results);
    results.ok.push(version.tag);
  } catch (e) {
    // GitHub 侧失败(下载/生成/建 release)算这个版本没发出去, 下一个继续试
    results.notes.push(`${version.tag} 发布失败: ${redact(e.message)}`);
    log(`::error::${version.tag} 发布失败: ${redact(e.message)}`);
  }
}

// 还原模板: pack/*/texts/*.lang 是纳入版本控制的, 不该留下替换后的内容
for (const [path, template] of langTemplates) writeFileSync(path, template);

log("==== 汇总 ====");
log("已发布:", results.ok.join(", ") || "无");
for (const note of results.notes) log("待处理:", note);
if (results.notes.length) core.setFailed(`${results.notes.length} 项失败或降级, 详见日志`);
exit(results.notes.length ? 1 : 0);
