import { mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as compressing from 'compressing';

const archive = process.argv[2] ?? 'target/mq_decrafting_table.mcaddon';
await mkdir('.workbuddy', { recursive: true });
const directory = await mkdtemp(path.resolve('.workbuddy/archive-check-'));
await compressing.zip.uncompress(archive, directory);
const json = async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
const bp = await json('mq_decrafting_table_bp/manifest.json');
const rp = await json('mq_decrafting_table_rp/manifest.json');
const version = JSON.parse(await readFile('package.json', 'utf8')).version.split('.').map(Number);
assert.deepEqual(bp.header.version, version);
assert.deepEqual(rp.header.version, version);
const script = bp.modules.find(m => m.type === 'script');
assert.equal(script.entry, 'scripts/main.js');
assert.ok((await stat(path.join(directory, 'mq_decrafting_table_bp', script.entry))).size > 0);
assert.ok(bp.modules.some(m => m.type === 'data'));
assert.deepEqual(bp.dependencies.find(d => d.uuid === rp.header.uuid).version, version);
const index = await json('mq_decrafting_table_bp/decrafting_index.json');
assert.ok(Object.keys(index).length >= 800);
for (const value of Object.values(index)) {
  await json(`mq_decrafting_table_bp/items/decrafting/${value.table}.json`);
  await json(`mq_decrafting_table_bp/loot_tables/decrafting/${value.table}.json`);
}
await json('mq_decrafting_table_rp/ui/data_driven_container_screen.json');
await json('mq_decrafting_table_rp/ui/mqdt_screen.json');
assert.ok(!(await readFile(path.join(directory, 'mq_decrafting_table_bp/texts/zh_CN.lang'), 'utf8')).includes('$TAG'));
console.log(`Archive valid: ${version.join('.')}, ${Object.keys(index).length} rules, script and both packs present.`);
console.log('SHA-256: ' + createHash('sha256').update(await readFile(archive)).digest('hex'));
