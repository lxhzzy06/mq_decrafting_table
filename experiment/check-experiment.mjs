import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { MARKER_ID, MARKER_MAX, LAYOUT_KEY, INPUT_SLOT, OUTPUT_SLOT } from './bp/scripts/marker.js';

const root = new URL('./', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
let parsed = 0;
async function checkJson(dir) {
  for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
    const file = dir + entry.name;
    if (entry.isDirectory()) await checkJson(file + '/');
    else if (entry.name.endsWith('.json')) { await json(file); parsed++; }
  }
}
await checkJson('bp/');
await checkJson('rp/');
const marker = (await json('bp/items/ui_marker.json'))['minecraft:item'];
assert.equal(marker.description.identifier, MARKER_ID);
assert.equal(marker.components['minecraft:durability'].max_durability, MARKER_MAX);
assert.equal(marker.components['minecraft:max_stack_size'], 1);
for (const file of ['be_marker_box', 'plain_box']) {
  const block = (await json(`bp/blocks/${file}.json`))['minecraft:block'];
  assert.equal(block.components['minecraft:block_entity'].container.slot_count, 3);
}
assert.equal((await json('bp/blocks/be_box.json'))['minecraft:block'].components['minecraft:block_entity'].container.slot_count, 2);
const defs = await json('rp/ui/_ui_defs.json');
for (const file of defs.ui_defs) await json('rp/' + file);
const ui = await json('rp/ui/mqdt_exp_screen.json');
assert.equal(ui.input_host.controls[0]['cell@mqdt_exp.slot_cell'].collection_index, INPUT_SLOT);
assert.equal(ui.output_host.controls[0]['cell@mqdt_exp.slot_cell'].collection_index, OUTPUT_SLOT);
assert.equal(ui.pocket_input_host.controls[0]['cell@mqdt_exp.pocket_slot_cell'].collection_index, INPUT_SLOT);
assert.equal(ui.pocket_output_host.controls[0]['cell@mqdt_exp.pocket_slot_cell'].collection_index, OUTPUT_SLOT);
const expression = `((#mqdt_identity = ${MARKER_MAX}) and (#mqdt_layout = ${LAYOUT_KEY}))`;
for (const name of ['marker_gate', 'pocket_marker_gate']) {
  assert.equal(ui[name].bindings.at(-1).source_property_name, expression);
}
const patch = await json('rp/ui/data_driven_container_screen.json');
assert.equal(patch.panel_top_half.modifications[0].operation, 'insert_back');
assert.equal(patch.panel_top_half.controls, undefined);
for (const name of ['container_label', 'item_grid']) {
  assert.equal(patch[name].modifications[0].value.at(-1).source_property_name, `(not ${expression})`);
}
assert.ok(!JSON.stringify([ui, patch]).includes('$container_size ='));
assert.ok(!JSON.stringify([ui, patch]).includes('32749'), 'must not claim bedrock-core protocol');
console.log(`${parsed} JSON files valid; marker, business indices and UI gates agree. Rendering still needs Minecraft.`);
