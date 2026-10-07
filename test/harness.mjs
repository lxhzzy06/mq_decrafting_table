/**
 * 把 src/main.ts 打包成可在 Node 中加载的模块, 并将其依赖 @minecraft/server 替换为测试替身。
 */
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const mockPath = fileURLToPath(new URL('./mock.mjs', import.meta.url));

export async function loadAddon() {
	const outDir = await mkdtemp(path.join(tmpdir(), 'mqdt-test-'));
	const outfile = path.join(outDir, 'addon.mjs');

	await build({
		entryPoints: [path.join(projectRoot, 'src/main.ts')],
		outfile,
		bundle: true,
		format: 'esm',
		platform: 'node',
		target: 'node18',
		alias: { '@minecraft/server': mockPath },
		logLevel: 'silent',
	});

	await import(pathToFileURL(outfile).href);

	return {
		state: globalThis.__MQDT__,
		cleanup: () => rm(outDir, { recursive: true, force: true }),
	};
}
