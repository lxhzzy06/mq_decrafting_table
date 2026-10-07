import test from 'node:test';
import assert from 'node:assert/strict';
import { panData } from '../scripts/pan-response.mjs';

test('123pan API errors are reported even when HTTP succeeded', () => {
  assert.throws(() => panData({ code: 400, message: 'invalid parentFileID', data: null }, 'create'), /code=400, invalid parentFileID/);
  assert.throws(() => panData({ code: 401, message: 'expired', data: {} }, 'info'), /code=401/);
});
test('123pan missing data cannot be mistaken for instant upload', () => {
  assert.throws(() => panData({ code: 0, data: null }, 'create'), /no data/);
  assert.throws(() => panData(undefined, 'create'), /code=missing/);
  assert.deepEqual(panData({ code: 0, data: { reuse: false } }, 'create'), { reuse: false });
});
