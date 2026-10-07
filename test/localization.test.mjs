import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAddon } from './harness.mjs';

function translations(locale) {
	return Object.fromEntries(readFileSync(new URL(`../pack/mq_decrafting_table_rp/texts/${locale}.lang`, import.meta.url), 'utf8')
		.split(/\r?\n/).filter(line => line.includes('=')).map(line => {
			const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
		}));
}

// Model only the documented RawMessage translation/parameter contract; engine rendering is checked in-game.
function render(message, dictionary) {
	if (message.rawtext) return message.rawtext.map(part => render(part, dictionary)).join('');
	if (message.text !== undefined) return message.text;
	assert.ok(dictionary[message.translate], `untranslated key: ${message.translate}`);
	const args = Array.isArray(message.with) ? message.with : message.with?.rawtext?.map(part => render(part, dictionary)) ?? [];
	let index = 0;
	return dictionary[message.translate].replace(/%s/g, () => args[index++]);
}

test('one shared hint resolves independently in English, Simplified Chinese and Traditional Chinese', async () => {
	const { state: S } = await loadAddon();
	const container = S.addContainer().container;
	const input = S.createItem('minecraft:acacia_door', 1);
	container.setItem(0, input);
	S.advance(4);
	const hint = container.getItem(1);
	for (const [locale, item, expected] of [
		['en_US', 'Acacia Door', ['Need 2 more', 'Item: Acacia Door', 'Batch size: 3']],
		['zh_CN', '金合欢木门', ['还差 2 个', '物品：金合欢木门', '每份需要 3 个']],
		['zh_TW', '相思木門', ['還差 2 個', '物品：相思木門', '每份需要 3 個']],
	]) {
		assert.deepEqual(hint.getRawLore().map(line => render(line, { ...translations(locale), [input.localizationKey]: item })), expected);
	}
	assert.equal(hint.nameTag, undefined);
});

test('hint refreshes when item or custom name changes despite identical shortfall', async () => {
	const { state: S } = await loadAddon();
	const container = S.addContainer().container;
	container.setItem(0, S.createItem('minecraft:acacia_door', 1));
	S.advance(4);
	const input = S.createItem('minecraft:birch_door', 1);
	container.setItem(0, input);
	S.advance(4);
	assert.equal(container.getItem(1).getRawLore()[1].with.rawtext[0].translate, input.localizationKey);
	input.nameTag = '%s Named Door';
	S.advance(4);
	assert.deepEqual(container.getItem(1).getRawLore()[1].with.rawtext[0], { text: '%s Named Door' });
	assert.equal(render(container.getItem(1).getRawLore()[1], translations('en_US')), 'Item: %s Named Door');
	input.nameTag = '门'.repeat(255);
	S.advance(4);
	assert.equal(Array.from(container.getItem(1).getRawLore()[1].with.rawtext[0].text).length, 40);
});

test('old hardcoded hints upgrade once and protected hints can become shortfall hints', async () => {
	const { state: S } = await loadAddon();
	const container = S.addContainer().container;
	container.setItem(0, S.createItem('minecraft:acacia_door', 2));
	const oldHint = S.createItem('mq_decrafting_item:need', 1);
	oldHint.nameTag = '还差 1 个 acacia door';
	container.setItem(1, oldHint);
	S.advance(4);
	assert.equal(container.getItem(1).nameTag, undefined);
	const writes = container.writes;
	S.advance(12);
	assert.equal(container.writes, writes);
	const protectedHint = S.createItem('mq_decrafting_item:need', 1);
	protectedHint.setLore([{ translate: 'mqdt.hint.protected' }, { translate: 'mqdt.hint.cannot_decraft' }]);
	container.setItem(1, protectedHint);
	S.advance(4);
	assert.equal(container.getItem(1).getRawLore()[0].translate, 'mqdt.hint.missing');
});

test('result explains collection and cursor messages stay client-localizable', async () => {
	const { state: S } = await loadAddon();
	const container = S.addContainer().container;
	container.setItem(0, S.createItem('minecraft:acacia_door', 3));
	S.advance(4);
	assert.deepEqual(container.getItem(1).getRawLore(), [{ translate: 'mqdt.result.collect' }]);
	const player = S.createPlayer();
	S.handlers.scriptEvent({ id: 'mqdt:cursor', sourceEntity: player, message: 'enable' });
	S.handlers.scriptEvent({ id: 'mqdt:cursor', sourceEntity: player, message: 'disable' });
	assert.deepEqual(player.messages.map(message => message.translate), ['mqdt.message.cursor_enabled', 'mqdt.message.cursor_disabled']);
});
