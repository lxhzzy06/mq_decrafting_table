#!/usr/bin/env node
/**
 * 把 Rust 生成器给出的换算索引转成 TypeScript, 供脚本 import。
 *
 * 脚本读不到行为包里的 JSON(没有文件 API), 所以索引必须以源码形式打进 main.js。
 * 索引内容由 `npm run gen` 产出, 这里只做格式转换, 不再自己逆向解析配方。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, 'pack/mq_decrafting_table_bp/decrafting_index.json');
const outFile = path.join(root, 'src/generated/decrafting-index.ts');

const index = JSON.parse(readFileSync(source, 'utf-8'));
const entries = Object.entries(index).sort(([a], [b]) => a.localeCompare(b));

const body = entries
	.map(([item, v]) => `\t'${item}': { table: '${v.table}', batch: ${v.batch} },`)
	.join('\n');

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(
	outFile,
	`// 由 scripts/gen-index.mjs 从 pack/mq_decrafting_table_bp/decrafting_index.json 生成, 请勿手改。
// 先跑 npm run gen 再跑本脚本。
// batch = 原配方的产物数量: 玩家投入的物品要按 batch 整除后才能整份换算材料。
export interface DecraftEntry {
	table: string;
	batch: number;
}

export const DECRAFT_INDEX: Record<string, DecraftEntry> = {
${body}
};
`,
	'utf-8'
);

const batches = [...new Set(entries.map(([, v]) => v.batch))].sort((a, b) => a - b);
console.log(`已写出 ${entries.length} 条索引到 src/generated/decrafting-index.ts`);
console.log(`batch 取值: ${batches.join(', ')}`);
