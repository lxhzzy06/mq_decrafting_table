#!/usr/bin/env node
/**
 * 数据包一致性校验。无需启动游戏, 纯静态检查生成的 JSON 与资源引用。
 * 覆盖: JSON 合法性、manifest 元信息、分解产物三件套一致性、标识符命名空间、纹理引用、本地化文件。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packDir = path.join(root, 'pack');
const bpDir = path.join(packDir, 'mq_decrafting_table_bp');
const rpDir = path.join(packDir, 'mq_decrafting_table_rp');

const errors = [];
const notes = [];
let checked = 0;

function fail(message) {
	errors.push(message);
}

/** 递归读取目录下所有 json, 返回 { file, absolute, dir } */
function collectJson(dir) {
	const out = [];
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir)) {
		const absolute = path.join(dir, entry);
		if (statSync(absolute).isDirectory()) {
			out.push(...collectJson(absolute));
		} else if (entry.endsWith('.json')) {
			out.push({ file: path.relative(root, absolute), absolute, dir });
		}
	}
	return out;
}

/**
 * 剥掉 C 风格注释。
 *
 * JSON UI(以及实体定义)允许写注释, 引擎能读, 标准 JSON.parse 不认。
 * 字符串内部的 "//"(比如纹理路径)必须原样保留, 所以要一边走一边记是否在字符串里。
 */
function stripComments(text) {
	let out = '';
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		const next = text[i + 1];
		if (escaped) {
			out += c;
			escaped = false;
			continue;
		}
		if (inString) {
			out += c;
			if (c === '\\') escaped = true;
			else if (c === '"') inString = false;
			continue;
		}
		if (c === '"') {
			inString = true;
			out += c;
			continue;
		}
		if (c === '/' && next === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			out += '\n';
			continue;
		}
		if (c === '/' && next === '*') {
			i += 2;
			while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
			i++;
			continue;
		}
		out += c;
	}
	return out;
}

function readJson(absolute, label) {
	checked++;
	try {
		return JSON.parse(stripComments(readFileSync(absolute, 'utf-8')));
	} catch (e) {
		fail(`${label} 不是合法 JSON: ${e.message}`);
		return undefined;
	}
}

/**
 * 该配方需要玩家在 3x3 里摆出多少格。
 *
 * 有序配方一格只吃一个物品; 无序配方的 ingredient.count 实测数的也是"占了几格"
 * 而不是物品总数(64 个火把挤一格匹配不上 count=4, 分到 4 格就能匹配),
 * 所以两条路都是按格计, 上限都是 9。
 */
function slotsRequired(component) {
	if (component.ingredients) {
		return component.ingredients.reduce((n, i) => n + (i?.count ?? 1), 0);
	}
	return (component.pattern ?? []).join('').replace(/ /g, '').length;
}

function hasNamespace(id) {
	return typeof id === 'string' && id.includes(':') && !id.startsWith(':') && !id.endsWith(':');
}

/** 收集配方里所有带数量的物品堆: 产物(单个或数组)与无序配方的输入 */
function collectStacks(component) {
	const out = [];
	if (Array.isArray(component.result)) out.push(...component.result);
	else if (component.result) out.push(component.result);
	out.push(...(component.ingredients ?? []));
	return out.filter((s) => s && typeof s === 'object');
}

// ---------- 1. 全部 JSON 可解析 ----------
for (const { file, absolute } of collectJson(packDir)) {
	readJson(absolute, file);
}

// ---------- 2. manifest 元信息 ----------
const bpManifest = readJson(path.join(bpDir, 'manifest.json'), 'bp/manifest.json');
const rpManifest = readJson(path.join(rpDir, 'manifest.json'), 'rp/manifest.json');

if (bpManifest && rpManifest) {
	if (bpManifest.header?.uuid === rpManifest.header?.uuid) {
		fail('行为包与资源包的 header.uuid 不能相同');
	}
	const bpMin = bpManifest.header?.min_engine_version;
	const rpMin = rpManifest.header?.min_engine_version;
	if (JSON.stringify(bpMin) !== JSON.stringify(rpMin)) {
		fail(`min_engine_version 不一致: 行为包 ${JSON.stringify(bpMin)} / 资源包 ${JSON.stringify(rpMin)}`);
	}

	const pkg = readJson(path.join(root, 'package.json'), 'package.json');
	const packVersion = pkg?.version?.split('.').map(Number);
	if (JSON.stringify(bpManifest.header.version) !== JSON.stringify(packVersion)
		|| JSON.stringify(rpManifest.header.version) !== JSON.stringify(packVersion)) fail('BP/RP 版本与 package.json 不一致');
	const declared = bpManifest.dependencies?.find((d) => d.module_name === '@minecraft/server')?.version;
	const installed = pkg?.dependencies?.['@minecraft/server'];
	if (declared && installed) {
		const strip = (v) => v.replace(/^[\^~]/, '');
		if (strip(declared) !== strip(installed)) {
			fail(`manifest 依赖 @minecraft/server ${declared} 与 package.json 的 ${installed} 不一致`);
		}
	}

	const scriptEntry = bpManifest.modules?.find((m) => m.type === 'script')?.entry;
	if (scriptEntry !== 'scripts/main.js') fail('脚本入口必须与构建输出 scripts/main.js 一致');
	const dependency = bpManifest.dependencies?.find(d => d.uuid === rpManifest.header.uuid);
	if (JSON.stringify(dependency?.version) !== JSON.stringify(rpManifest.header.version)) fail('行为包须依赖同版本资源包');
	if (scriptEntry && !existsSync(path.join(bpDir, scriptEntry))) {
		notes.push(`脚本入口 ${scriptEntry} 需由构建步骤产出(tsup), 源码位于 src/main.ts`);
	}
}

// Hidden marker protocol must agree between script, item definition and generated UI.
const protocol = readFileSync(path.join(root, 'src/ui-marker.ts'), 'utf8');
const markerMax = Number(protocol.match(/UI_MARKER_MAX = (\d+);/)?.[1]);
const layoutKey = Number(protocol.match(/UI_LAYOUT_KEY = (\d+);/)?.[1]);
const marker = readJson(path.join(bpDir, 'items/ui_marker.json'), 'UI marker');
if (marker?.['minecraft:item']?.components?.['minecraft:durability']?.max_durability !== markerMax) fail('标记最大耐久与脚本不一致');
const nativeBlock = readJson(path.join(bpDir, 'blocks/decrafting_table.json'), 'native table');
if (nativeBlock?.['minecraft:block']?.components?.['minecraft:block_entity']?.container?.slot_count !== 3) fail('分解台原生库存应为三格');
const layout = readJson(path.join(rpDir, 'ui/mqdt_screen.json'), 'marker UI');
const expression = `((#mqdt_identity = ${markerMax}) and (#mqdt_layout = ${layoutKey}))`;
if (layout?.marker_gate?.bindings?.at(-1)?.source_property_name !== expression) fail('UI 识别条件与脚本不一致');
for (const [name, slot] of [['input_host', 1], ['output_host', 2]]) {
	if (layout?.[name]?.controls?.[0]?.['cell@mqdt.slot_cell']?.collection_index !== slot) fail(`${name} 的业务槽位不匹配`);
}

// ---------- 3. 分解产物三件套一致性 ----------
const itemDir = path.join(bpDir, 'items', 'decrafting');
const lootDir = path.join(bpDir, 'loot_tables', 'decrafting');
const recipeDir = path.join(bpDir, 'recipes', 'decrafting');

const listIds = (dir) =>
	existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [];

const itemIds = listIds(itemDir);
const lootIds = listIds(lootDir);
const recipeFiles = existsSync(recipeDir) ? readdirSync(recipeDir).filter((f) => f.endsWith('.json')) : [];
const index = readJson(path.join(bpDir, 'decrafting_index.json'), 'decrafting index');
if (itemIds.length && index) {
	if (Object.keys(index).length !== itemIds.length) fail('索引数量与中介物数量不一致');
	for (const [id, entry] of Object.entries(index)) {
		if (!itemIds.includes(entry.table) || !lootIds.includes(entry.table)) fail(`索引 ${id} 缺少对应中介物/战利品表`);
		if (!Number.isInteger(entry.batch) || entry.batch < 1) fail(`索引 ${id} 批量数量无效`);
	}
}

if (itemIds.length || lootIds.length || recipeFiles.length) {
	for (const id of itemIds) {
		const item = readJson(path.join(itemDir, `${id}.json`), `items/decrafting/${id}.json`);
		const identifier = item?.['minecraft:item']?.description?.identifier;
		if (identifier !== `mq_decrafting_item:${id}`) {
			fail(`中介物 ${id} 的 identifier 为 ${identifier}, 期望 mq_decrafting_item:${id}`);
		}
	}

	for (const id of itemIds) {
		if (!lootIds.includes(id)) {
			fail(`中介物 ${id} 缺少对应的战利品表 loot_tables/decrafting/${id}.json`);
		}
	}

	// 战利品表条目必须带命名空间, 否则 loot 命令无法命中, 物品会被吞掉
	for (const id of lootIds) {
		const table = readJson(path.join(lootDir, `${id}.json`), `loot_tables/decrafting/${id}.json`);
		for (const pool of table?.pools ?? []) {
			for (const entry of pool.entries ?? []) {
				if (!hasNamespace(entry.name)) {
					fail(`战利品表 ${id} 的条目 ${JSON.stringify(entry.name)} 缺少命名空间`);
				}
			}
		}
	}

	// 配方内的物品引用同样必须有命名空间, 且带上包过滤标签
	for (const file of recipeFiles) {
		const recipe = readJson(path.join(recipeDir, file), `recipes/decrafting/${file}`);
		const component = recipe?.['minecraft:recipe_shaped'] ?? recipe?.['minecraft:recipe_shapeless'];
		if (!component) {
			fail(`配方 ${file} 既不是 shaped 也不是 shapeless`);
			continue;
		}
		const identifier = component.description?.identifier;
		if (typeof identifier === 'string' && !identifier.startsWith('mq_decrafting_table:')) {
			fail(`配方 ${file} 的 identifier ${identifier} 未使用 mq_decrafting_table 命名空间`);
		}
		if (!(component.tags ?? []).includes('mq_decrafting_table')) {
			fail(`配方 ${file} 缺少 tags: ["mq_decrafting_table"], 无法在分解台中显示`);
		}
		const raw = JSON.stringify(component);
		for (const value of raw.match(/"(?:item|name)":"[^"]+"/g) ?? []) {
			const id = value.split(':').slice(1).join(':').slice(0, -1);
			if (!hasNamespace(id)) {
				fail(`配方 ${file} 中的物品 ${id} 缺少命名空间`);
			}
		}

		// 数量必须是 1..64 的整数: 写 0 会让引擎给出空产出, 超过 64 则永远凑不齐
		for (const stack of collectStacks(component)) {
			const count = stack.count;
			if (count === undefined) continue;
			if (!Number.isInteger(count) || count < 1 || count > 64) {
				fail(`配方 ${file} 的数量 ${count} 非法, 必须是 1..64 的整数`);
			}
		}

		// 有序配方的 key 不认 count, 一格只能消耗一个物品 —— 写了会被静默忽略, 等于白送物资
		for (const [symbol, entry] of Object.entries(component.key ?? {})) {
			if (entry?.count !== undefined) {
				fail(`配方 ${file} 的 key "${symbol}" 写了 count, 官方 schema 不支持, 会被静默忽略`);
			}
		}

		// 摆不下的配方永远不会被匹配到, 玩家只会看到"分解台没反应"
		const slots = slotsRequired(component);
		if (slots > 9) {
			fail(`配方 ${file} 需要摆 ${slots} 格, 合成台只有 9 格`);
		}
	}
} else {
	notes.push('尚未生成分解产物 (需先执行 cargo 生成器), 已跳过产物一致性检查');
}

// ---------- 4. 资源引用完整性 ----------
const blocksJson = readJson(path.join(rpDir, 'blocks.json'), 'rp/blocks.json');
const terrain = readJson(path.join(rpDir, 'textures', 'terrain_texture.json'), 'rp/terrain_texture.json');
const itemTexture = readJson(path.join(rpDir, 'textures', 'item_texture.json'), 'rp/item_texture.json');

if (blocksJson && terrain) {
	const known = new Set(Object.keys(terrain.texture_data ?? {}));
	known.add('crafting_table_bottom'); // 复用原版图集
	for (const [blockId, block] of Object.entries(blocksJson)) {
		if (blockId === 'format_version') continue;
		for (const texture of Object.values(block.textures ?? {})) {
			if (!known.has(texture)) {
				fail(`blocks.json 中 ${blockId} 引用的地形纹理 ${texture} 未在 terrain_texture.json 定义`);
			}
		}
	}
}

if (itemTexture) {
	for (const [name, entry] of Object.entries(itemTexture.texture_data ?? {})) {
		const target = Array.isArray(entry.textures) ? entry.textures[0] : entry.textures;
		if (typeof target === 'string' && !existsSync(path.join(rpDir, `${target}.png`))) {
			fail(`item_texture.json 中 ${name} 指向的贴图缺失: ${target}.png`);
		}
	}
}

// ---------- 5. 本地化 ----------
for (const side of ['mq_decrafting_table_bp', 'mq_decrafting_table_rp']) {
	const textsDir = path.join(packDir, side, 'texts');
	const languages = readJson(path.join(textsDir, 'languages.json'), `${side}/texts/languages.json`);
	let referenceKeys;
	for (const language of languages ?? []) {
		const filename = path.join(textsDir, `${language}.lang`);
		if (!existsSync(filename)) {
			fail(`${side} 缺少语言文件 texts/${language}.lang`);
			continue;
		}
		const keys = new Set();
		for (const line of readFileSync(filename, 'utf8').split(/\r?\n/)) {
			if (!line.trim() || line.startsWith('##')) continue;
			const separator = line.indexOf('=');
			const key = line.slice(0, separator);
			if (separator < 1 || !line.slice(separator + 1).trim()) fail(`${side}/${language} 包含无效或空翻译: ${line}`);
			if (keys.has(key)) fail(`${side}/${language} 重复翻译键: ${key}`);
			keys.add(key);
		}
		if (referenceKeys && JSON.stringify([...keys].sort()) !== JSON.stringify([...referenceKeys].sort())) {
			fail(`${side}/${language} 的翻译键与其他语言不完整对应`);
		}
		referenceKeys ??= keys;
		if (side.endsWith('_rp')) {
			const sources = [readFileSync(path.join(root, 'src/main.ts'), 'utf8'), readFileSync(path.join(root, 'src/localization.ts'), 'utf8')];
			const required = sources.flatMap(source => [...source.matchAll(/translate:\s*'(mqdt\.[^']+)'/g)].map(match => match[1]));
			for (const { absolute } of collectJson(path.join(bpDir, 'items'))) {
				const item = JSON.parse(readFileSync(absolute, 'utf8'));
				const key = item['minecraft:item']?.components?.['minecraft:display_name']?.value;
				if (typeof key === 'string' && key.startsWith('mqdt.')) required.push(key);
			}
			for (const key of new Set(required)) if (!keys.has(key)) fail(`${side}/${language} 缺少玩家可见翻译: ${key}`);
		}
	}
}

// ---------- 输出 ----------
console.log(`已检查 ${checked} 个 JSON 文件`);
console.log(`已生成 ${itemIds.length} 个中介物 / ${lootIds.length} 张战利品表 / ${recipeFiles.length} 条反向配方`);
for (const note of notes) console.log(`提示: ${note}`);

if (errors.length) {
	console.error(`\n发现 ${errors.length} 个问题:`);
	for (const error of errors) console.error(`  ✗ ${error}`);
	process.exitCode = 1;
} else {
	console.log('全部检查通过');
}
