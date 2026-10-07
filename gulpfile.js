import { defineConfig, build as tsbuild } from 'tsup';
import gulp from 'gulp';
import os from 'os';
import minimist from 'minimist';
import zip from 'gulp-zip';
import { deleteAsync, deleteSync } from 'del';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';

const execFileAsync = promisify(execFile);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
async function prepareSources() {
	for (const args of [['scripts/gen-index.mjs'], ['experiment/build-ui.mjs', '--production']]) {
		const { stdout } = await execFileAsync(process.execPath, args, { cwd: projectRoot });
		console.log(stdout.trim());
	}
}

const projectname = 'mq_decrafting_table';
const bpfoldername = 'mq_decrafting_table_bp';
const rpfoldername = 'mq_decrafting_table_rp';

// Minecraft 自 1.21.120 起在 Windows 上从 UWP 迁移到 GDK, 开发包目录随之搬迁:
// 新位置 %appdata%\Minecraft Bedrock\users\shared\games\com.mojang
// (预览版为 %appdata%\Minecraft Bedrock Preview\...)。
// 旧 UWP 位置只留给尚未迁移的客户端, 需要时用 MQDT_UWP=1 回退。
const usePreview = process.env.MQDT_PREVIEW === '1';
const useUwp = process.env.MQDT_UWP === '1';
const appData = process.env.APPDATA ?? `${os.homedir()}/AppData/Roaming`;
const mcdir = useUwp
	? `${os.homedir()}/AppData/Local/Packages/${
			usePreview ? 'Microsoft.MinecraftWindowsBeta' : 'Microsoft.MinecraftUWP'
		}_8wekyb3d8bbwe/LocalState/games/com.mojang/`
	: `${appData}/${
			usePreview ? 'Minecraft Bedrock Preview' : 'Minecraft Bedrock'
		}/users/shared/games/com.mojang/`;

const argv = minimist(process.argv.slice(2));

const config = defineConfig({
	entry: ['src/main.ts'],
	outDir: `${mcdir}/development_behavior_packs/${bpfoldername}/scripts`,
	format: 'esm',
	target: 'es2020',
	clean: false,
	noExternal: ['@minecraft/math', 'wgpu-matrix', 'bedrock-vanilla-data-inline'],
	outExtension() {
		return { js: '.js' };
	},
	watch: argv.w ? 'src' : undefined
});

function deploy_behavior_packs() {
    const destination = `${mcdir}development_behavior_packs/${bpfoldername}`;
    console.log(`Behavior deploying to '${destination}'`);
    return gulp.src(`pack/${bpfoldername}/**/*`, { encoding: false }).pipe(gulp.dest(destination));
}

function deploy_resource_packs() {
	const destination = `${mcdir}development_resource_packs/${rpfoldername}`;
	console.log(`Resource deploying to '${destination}'`);
	return gulp.src(`pack/${rpfoldername}/**/*`, { encoding: false }).pipe(gulp.dest(destination));
}

async function main() {
	if (argv.c) {
		deleteSync([`${mcdir + 'development_behavior_packs/' + bpfoldername}`, `${mcdir + 'development_resource_packs/' + rpfoldername}`], {
			force: true
		});
	}
	await prepareSources();
	await tsbuild(config);
	if (argv.d) {
		await deploy();
	}
}

/** 等待 gulp 流写盘结束, 以便构建流程可以被 await */
function streamEnd(stream) {
	return new Promise((resolve, reject) => {
		const done = () => resolve();
		stream.on('end', done).on('finish', done).on('error', reject);
	});
}

export async function build() {
	const output = path.resolve('target');
	if (output !== path.join(projectRoot, 'target')) throw new Error('Build must run from the project root');
	await prepareSources();
	await deleteAsync(output, { force: true });
	config.outDir = `target/${bpfoldername}/scripts`;
	config.minify = true;
	config.treeshake = true;
	await tsbuild(config);
	await streamEnd(
		gulp
			.src(['pack/**', `!pack/${bpfoldername}/{recipes,items,loot_tables}/decrafting/.gitkeep`], { encoding: false })
			.pipe(gulp.dest('target'))
	);
	const packageVersion = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version;
	for (const name of [bpfoldername, rpfoldername]) {
		const directory = path.join(output, name, 'texts');
		for (const file of await readdir(directory)) {
			if (!file.endsWith('.lang')) continue;
			const filename = path.join(directory, file);
			const text = await readFile(filename, 'utf8');
			if (text.includes('$TAG')) await writeFile(filename, text.replaceAll('$TAG', `v${packageVersion}`));
		}
	}
	await streamEnd(
		gulp
			.src(['target/**', '!target/*.mcaddon'], { encoding: false })
			.pipe(zip(`${projectname}.mcaddon`))
			.pipe(gulp.dest('target'))
	);
	return `target/${projectname}.mcaddon`;
}

export const deploy = gulp.series(gulp.parallel(deploy_behavior_packs, deploy_resource_packs));
export default main;
