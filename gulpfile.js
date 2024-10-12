const useMinecraftPreview = false;
const projectname = 'mq_decrafting_table';
const bpfoldername = 'mq_decrafting_table_bp';
const rpfoldername = 'mq_decrafting_table_rp';

import { defineConfig, build as tsbuild } from 'tsup';
import gulp from 'gulp';
import os from 'os';
import minimist from 'minimist';
import zip from 'gulp-zip';
import { deleteAsync, deleteSync } from 'del';
const mcdir =
	os.homedir() +
	(useMinecraftPreview
		? '/AppData/Local/Packages/Microsoft.MinecraftWindowsBeta_8wekyb3d8bbwe/LocalState/games/com.mojang/'
		: '/AppData/Local/Packages/Microsoft.MinecraftUWP_8wekyb3d8bbwe/LocalState/games/com.mojang/');
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
	await tsbuild(config);
	if (argv.d) {
		await deploy();
	}
}

export async function build() {
	await deleteAsync('target', { force: true });
	config.outDir = `target/${bpfoldername}/scripts`;
	config.minify = true;
	config.treeshake = true;
	await tsbuild(config);
	gulp.series(
		() =>
			gulp
				.src(['pack/**', '!pack/mq_decrafting_table_bp/{recipes,items,loot_tables}/decrafting/.gitkeep'], { encoding: false })
				.pipe(gulp.dest('target')),
		() =>
			gulp
				.src('target/**', { encoding: false })
				.pipe(zip(`${projectname}.mcaddon`))
				.pipe(gulp.dest('target'))
	)();
}

export const deploy = gulp.series(gulp.parallel(deploy_behavior_packs, deploy_resource_packs));
export default main;
