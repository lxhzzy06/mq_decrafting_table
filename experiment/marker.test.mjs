import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureMarker, isMarker, isValidMarker, MARKER_MAX, LAYOUT_KEY, MARKER_ID } from './bp/scripts/marker.js';

const item = (typeId, amount = 1) => ({ typeId, amount, getComponent: () => undefined });
const marker = (damage = MARKER_MAX - LAYOUT_KEY) => ({ ...item(MARKER_ID),
  getComponent: () => ({ maxDurability: MARKER_MAX, damage }) });
function inventory(stacks) {
  return { size: stacks.length, getItem: slot => stacks[slot],
    setItem: (slot, stack) => { stacks[slot] = stack; },
    moveItem: (from, to) => { assert.equal(stacks[to], undefined); stacks[to] = stacks[from]; stacks[from] = undefined; },
  };
}
test('world reload with valid marker leaves both business cells untouched', () => {
  const stacks = [marker(), item('minecraft:diamond', 7), item('minecraft:torch', 4)];
  const snapshot = [...stacks];
  assert.equal(ensureMarker(inventory(stacks), () => { throw Error('unexpected write'); }), false);
  assert.deepEqual(stacks, snapshot);
});
test('taking the marker only refills its reserved cell', () => {
  const stacks = [undefined, item('minecraft:diamond'), item('minecraft:torch')];
  const original = [...stacks];
  ensureMarker(inventory(stacks), marker);
  assert.ok(isValidMarker(stacks[0]));
  assert.equal(stacks[1], original[1]);
  assert.equal(stacks[2], original[2]);
});
test('quick-move into the reserved cell preserves the real item in an empty business cell', () => {
  const real = item('minecraft:iron_ingot', 64);
  const stacks = [real, undefined, item('minecraft:torch')];
  ensureMarker(inventory(stacks), marker);
  assert.equal(stacks[1], real);
  assert.ok(isValidMarker(stacks[0]));
});
test('full business cells spill only the misplaced real item', () => {
  const real = item('minecraft:iron_ingot', 64);
  const stacks = [real, item('minecraft:diamond'), item('minecraft:torch')];
  const drops = [];
  ensureMarker(inventory(stacks), marker, stack => drops.push(stack));
  assert.deepEqual(drops, [real]);
  assert.ok(isValidMarker(stacks[0]));
  assert.equal(stacks[1].typeId, 'minecraft:diamond');
  assert.equal(stacks[2].typeId, 'minecraft:torch');
});
test('failed spill preserves all items for a later retry', () => {
  const stacks = [item('minecraft:iron_ingot'), item('minecraft:diamond'), item('minecraft:torch')];
  const before = [...stacks];
  assert.throws(() => ensureMarker(inventory(stacks), marker, () => { throw Error('unloaded'); }), /unloaded/);
  assert.deepEqual(stacks, before);
});
test('old two-slot containers cannot be rewritten by marker recovery', () => {
  const stacks = [item('minecraft:diamond'), item('minecraft:torch')];
  const before = [...stacks];
  assert.throws(() => ensureMarker(inventory(stacks), marker), /Expected 3 slots/);
  assert.deepEqual(stacks, before);
});
test('corrupt marker key is repaired; cleanup matches only our item ID', () => {
  const stacks = [marker(0), undefined, undefined];
  assert.equal(isValidMarker(stacks[0]), false);
  ensureMarker(inventory(stacks), marker);
  assert.ok(isValidMarker(stacks[0]));
  assert.equal(isMarker(item('minecraft:stick')), false);
});
