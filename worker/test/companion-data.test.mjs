import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCompanionData, manifest } from '../companion-data.js';

const get = (qs = '', method = 'GET') => handleCompanionData(new Request('https://bureau.belpire.com/api/companion/data' + qs, { method }));

test('manifest lists both files with sizes and one build', async () => {
  const r = get(); assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.v, 1); assert.deepEqual(Object.keys(m.files).sort(), ['app-blueprints', 'factions']);
  assert.ok(m.files.factions.bytes > 1000 && m.files['app-blueprints'].bytes > 1000);
  assert.equal(typeof m.build, 'string'); assert.deepEqual(m, manifest());
});
test('factions file has ladders, blueprint file has items', async () => {
  const f = await get('?name=factions').json(); assert.ok(Array.isArray(f.ladders) && f.ladders.length > 0);
  const b = await get('?name=app-blueprints').json(); assert.ok(Array.isArray(b.items) && b.items.length > 0);
  assert.ok(b.items.every((i) => i.n && !/PLACEHOLDER/i.test(i.n)));
});
test('unknown names, odd names and wrong methods are refused', async () => {
  assert.equal(get('?name=secrets').status, 404); assert.equal(get('?name=__proto__').status, 404); assert.equal(get('?name=').status, 404);
  assert.equal(get('', 'POST').status, 405);
  assert.equal(get('?name=factions', 'HEAD').status, 200);
});
test('responses are public and typed as JSON', () => {
  const r = get('?name=factions'); assert.match(r.headers.get('Content-Type'), /json/); assert.match(r.headers.get('Cache-Control'), /public/);
});
