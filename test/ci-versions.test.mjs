import assert from 'node:assert/strict';
import test from 'node:test';
import { selectQueue, versionKey, seriesOf } from '../scripts/ci-versions.mjs';

const tags = (...names) => names.map((tag) => ({ tag }));

test('正式版被同期 preview 挤掉时仍能入选', () => {
	// 复现 v1.26.50.4 事故: 上游最新的 release 已经是更新的 preview
	const { queue } = selectQueue(tags('v1.26.50.4', 'v1.26.50.25-preview', 'v1.26.50.27-preview', 'v1.26.60.24-preview'), {
		published: [],
	});
	assert.deepEqual(
		queue.map((v) => v.tag),
		['v1.26.50.4', 'v1.26.50.25-preview', 'v1.26.50.27-preview', 'v1.26.60.24-preview']
	);
});

test('只有 tag 没有 release 对象的版本也能补发', () => {
	const { queue } = selectQueue(tags('v1.26.40.5'), { published: [] });
	assert.deepEqual(queue.map((v) => v.tag), ['v1.26.40.5']);
});

test('已发布过的 tag 不重复构建', () => {
	const { queue, missing } = selectQueue(tags('v1.26.50.4', 'v1.26.60.29-preview'), { published: ['v1.26.50.4'] });
	assert.deepEqual(queue.map((v) => v.tag), ['v1.26.60.29-preview']);
	assert.equal(missing, 1);
});

test('更早的系列不回补, 避免一次翻出上百个历史版本', () => {
	const { queue, missing } = selectQueue(tags('v1.21.100.6', 'v1.26.20.4', 'v1.26.30.5', 'v1.26.40.5', 'v1.26.50.4'), {
		published: [],
		series: 3,
	});
	assert.equal(missing, 5);
	assert.deepEqual(queue.map((v) => v.tag), ['v1.26.30.5', 'v1.26.40.5', 'v1.26.50.4']);
});

test('超出单次上限的版本留给后续运行', () => {
	const { queue, deferred } = selectQueue(tags('v1.26.40.5', 'v1.26.50.4', 'v1.26.60.24-preview'), {
		published: [],
		maxPerRun: 2,
	});
	assert.deepEqual(queue.map((v) => v.tag), ['v1.26.40.5', 'v1.26.50.4']);
	assert.equal(deferred, 1);
});

test('非法 tag 被忽略', () => {
	assert.equal(versionKey('v1.19.30'), null, '三段号不是可发布版本');
	assert.equal(versionKey('latest'), null);
	assert.equal(versionKey('1.26.50.4'), null, '缺 v 前缀');
	assert.deepEqual(versionKey('v1.26.60.29-preview'), [1, 26, 60, 29]);
	const { queue } = selectQueue(tags('v1.19.30', 'latest', 'v1.26.50.4'), { published: [] });
	assert.deepEqual(queue.map((v) => v.tag), ['v1.26.50.4']);
});

test('系列归属正确', () => {
	assert.equal(seriesOf('v1.26.60.29-preview'), '1.26.60');
	assert.equal(seriesOf('nope'), null);
});

const { resolvePrerelease } = await import('../scripts/ci-versions.mjs');

test('上游 release 对象的标记优先', () => {
	assert.equal(resolvePrerelease({ upstreamPrerelease: true, record: { version: '1.26.20.26' } }), true);
	assert.equal(resolvePrerelease({ upstreamPrerelease: false, record: { type: 'preview' } }), false);
});

test('没有 release 对象时看 version.json 的 type', () => {
	assert.equal(resolvePrerelease({ record: { type: 'preview' } }), true);
	assert.equal(resolvePrerelease({ record: { version: '1.26.50.4' } }), false, '正式版条目不带 type');
});

test('两者都没有时保守当作预览版', () => {
	// 误判成正式版会把预发布构建推上商店的稳定版通道, 反过来只是少发一次更新
	assert.equal(resolvePrerelease({}), true);
});
