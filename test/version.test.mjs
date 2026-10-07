import assert from 'node:assert/strict';
import test from 'node:test';
import { matchGameVersion, versionCandidates } from '../scripts/cf-version.mjs';

test('同时生成传统编号与年份编号两种候选', () => {
	const candidates = versionCandidates('v1.26.50.4');
	assert.ok(candidates.includes('1.26.50'), '缺少传统编号候选');
	assert.ok(candidates.includes('26.50'), '缺少年份编号候选');
});

test('CurseForge 使用年份编号(26.50)时能够命中', () => {
	const versions = [
		{ name: '1.21.50', id: 1 },
		{ name: '26.50', id: 2 },
	];
	const matched = matchGameVersion('v1.26.50.4', versions);
	assert.equal(matched?.id, 2);
});

test('CurseForge 沿用传统编号(1.26.50)时同样能够命中', () => {
	const versions = [
		{ name: '1.26.50', id: 7 },
		{ name: '1.21.50', id: 1 },
	];
	const matched = matchGameVersion('v1.26.50.4', versions);
	assert.equal(matched?.id, 7);
});

test('找不到匹配时返回 undefined, 由调用方跳过发布', () => {
	const versions = [{ name: '1.21.50', id: 1 }];
	assert.equal(matchGameVersion('v1.26.50.4', versions), undefined);
});

test('不带 v 前缀的 tag 也能处理', () => {
	const candidates = versionCandidates('1.26.0.2');
	assert.ok(candidates.includes('26.0'));
	assert.ok(candidates.includes('1.26.0'));
});
