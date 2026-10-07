import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAddon } from './harness.mjs';

async function table() {
  await loadAddon();
  const S = globalThis.__MQDT__;
  S.newGrid().place(0, 0, 0, 'mq_decrafting_table:table');
  const block = S.blockAt(0, 0, 0);
  const hooks = S.blockComponents.get('mqdt:container_lifecycle');
  hooks.onPlace({ block });
  return { S, block, hooks, container: block.getComponent('minecraft:inventory').container };
}
test('native input/output use slots 1/2 and never overwrite the hidden marker', async () => {
  const { S, block, hooks, container } = await table();
  const marker = container.getItem(0);
  container.setItem(1, S.createItem('minecraft:acacia_door', 3));
  hooks.onTick({ block });
  assert.equal(container.getItem(1), undefined);
  assert.equal(container.getItem(2).typeId, 'mq_decrafting_item:acacia_door');
  assert.equal(container.getItem(2).amount, 1);
  assert.equal(container.getItem(0), marker);
});
test('partial batch never destroys an already produced result on the next tick', async () => {
  const { S, block, hooks, container } = await table();
  container.setItem(1, S.createItem('minecraft:acacia_door', 4));
  hooks.onTick({ block });
  hooks.onTick({ block });
  assert.equal(container.getItem(1).amount, 1);
  assert.equal(container.getItem(2).typeId, 'mq_decrafting_item:acacia_door');
  assert.equal(container.getItem(2).amount, 1);
});
test('full output does not create a negative shortfall or consume input', async () => {
  const { S, block, hooks, container } = await table();
  container.setItem(1, S.createItem('minecraft:acacia_door', 3));
  container.setItem(2, S.createItem('mq_decrafting_item:acacia_door', 64));
  hooks.onTick({ block });
  assert.equal(container.getItem(1).amount, 3);
  assert.equal(container.getItem(2).amount, 64);
});
test('legacy entity inventory migrates once with original slot meanings intact', async () => {
  const { S, container } = await table();
  const legacy = S.addContainer();
  legacy.container.setItem(0, S.createItem('minecraft:diamond', 5));
  legacy.container.setItem(1, S.createItem('mq_decrafting_item:acacia_door', 2));
  S.advance(4);
  assert.equal(legacy.isValid, false);
  assert.equal(container.getItem(1).typeId, 'minecraft:diamond');
  assert.equal(container.getItem(1).amount, 5);
  assert.equal(container.getItem(2).amount, 2);
  assert.equal(legacy.container.getItem(0), undefined);
  assert.equal(legacy.container.getItem(1), undefined);
  S.advance(8);
  assert.equal(container.getItem(2).amount, 2);
});
test('migration preserves occupied native cells and drops legacy items instead', async () => {
  const { S, container } = await table();
  container.setItem(1, S.createItem('minecraft:torch', 4));
  container.setItem(2, S.createItem('minecraft:diamond', 3));
  const legacy = S.addContainer();
  legacy.container.setItem(0, S.createItem('minecraft:iron_ingot', 5));
  S.advance(4);
  assert.equal(container.getItem(1).typeId, 'minecraft:torch');
  assert.equal(container.getItem(2).typeId, 'minecraft:diamond');
  assert.equal(S.dropped[0].typeId, 'minecraft:iron_ingot');
  assert.equal(legacy.isValid, false);
});
test('marker recovery moves a misplaced ordinary item without consuming it', async () => {
  const { S, block, hooks, container } = await table();
  container.setItem(0, S.createItem('minecraft:diamond', 7));
  hooks.onTick({ block });
  assert.equal(container.getItem(0).typeId, 'mqdt:ui_marker');
  assert.equal(container.getItem(1).typeId, 'minecraft:diamond');
  assert.equal(container.getItem(1).amount, 7);
});
for (const kind of ['damaged', 'enchanted']) test(`${kind} equipment is preserved with a rejection hint`, async () => {
  const { S, block, hooks, container } = await table();
  const item = S.createItem('minecraft:diamond_sword');
  if (kind === 'damaged') item.components.set('minecraft:durability', { maxDurability: 1561, damage: 1 });
  else item.components.set('minecraft:enchantable', { getEnchantments: () => [{ level: 1 }] });
  container.setItem(1, item);
  hooks.onTick({ block });
  assert.equal(container.getItem(1), item);
  assert.equal(container.getItem(2).typeId, 'mq_decrafting_item:need');
  assert.equal(container.getItem(2).nameTag, undefined);
  assert.deepEqual(container.getItem(2).getRawLore(), [
    { translate: 'mqdt.hint.protected' }, { translate: 'mqdt.hint.cannot_decraft' },
  ]);
});
test('escaped marker is reclaimed in inventory and cursor without granting materials', async () => {
  const { S, container } = await table();
  const player = S.createPlayer();
  player.container.setItem(3, container.getItem(0));
  S.fireInventoryChange(player, 3);
  assert.equal(player.container.getItem(3), undefined);
  S.handlers.worldLoad();
  player.cursor.item = S.createItem('mqdt:ui_marker');
  S.advance(20);
  assert.equal(player.cursor.item, undefined);
  assert.equal(player.granted.length, 0);
});
test('marker drops from a destroyed native container are removed; real drops survive', async () => {
  const { S } = await table();
  const drop = typeId => ({ typeId: 'minecraft:item', isValid: true,
    getComponent: () => ({ itemStack: S.createItem(typeId) }), remove() { this.isValid = false; } });
  const marker = drop('mqdt:ui_marker');
  const diamond = drop('minecraft:diamond');
  S.handlers.entitySpawn({ entity: marker });
  S.handlers.entitySpawn({ entity: diamond });
  assert.equal(marker.isValid, false);
  assert.equal(diamond.isValid, true);
});
