import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCompanionData, manifest } from '../companion-data.js';

const get = (qs = '', method = 'GET') => handleCompanionData(new Request('https://bureau.belpire.com/api/companion/data' + qs, { method }));

test('manifest lists both channels, each with both files and one build', async () => {
  const r = get(); assert.equal(r.status, 200);
  const m = await r.json();
  assert.equal(m.v, 2); assert.deepEqual(Object.keys(m.channels).sort(), ['live', 'ptu']);
  for (const c of Object.values(m.channels)) { assert.deepEqual(Object.keys(c.files).sort(), ['app-blueprints', 'factions']); assert.equal(typeof c.build, 'string'); assert.equal(c.available, c.build !== ''); }
  assert.match(m.channels.live.build, /^\d/); assert.equal(m.channels.live.available, true);
  assert.ok(m.channels.live.files.factions.bytes > 1000 && m.channels.live.files['app-blueprints'].bytes > 1000);
  assert.equal(m.build, m.channels.live.build); assert.deepEqual(m.files, m.channels.live.files);
  assert.deepEqual(m, manifest());
});
test('LIVE is the default channel; factions have ladders, blueprints have items', async () => {
  const f = await get('?name=factions').json(); assert.ok(Array.isArray(f.ladders) && f.ladders.length > 0);
  const b = await get('?name=app-blueprints&channel=live').json(); assert.ok(Array.isArray(b.items) && b.items.length > 0);
  assert.ok(b.items.every((i) => i.n && !/PLACEHOLDER/i.test(i.n)));
  assert.equal((await get('?name=factions&channel=LIVE').json()).build, f.build);
});
test('PTU is served only once it has an extracted build', async () => {
  const ptu = (await get().json()).channels.ptu;
  const r = get('?name=factions&channel=ptu');
  if (ptu.available) { assert.equal(r.status, 200); assert.equal((await r.json()).build, ptu.build); }
  else { assert.equal(r.status, 404); assert.equal((await r.json()).error, 'channel_not_available'); }
});
test('unknown channels, names, odd names and wrong methods are refused', async () => {
  assert.equal(get('?name=factions&channel=beta').status, 404); assert.equal(get('?name=factions&channel=__proto__').status, 404);
  assert.equal(get('?name=secrets').status, 404); assert.equal(get('?name=__proto__').status, 404); assert.equal(get('?name=').status, 404);
  assert.equal(get('', 'POST').status, 405);
  assert.equal(get('?name=factions', 'HEAD').status, 200);
});
test('responses are public and typed as JSON', () => {
  const r = get('?name=factions'); assert.match(r.headers.get('Content-Type'), /json/); assert.match(r.headers.get('Cache-Control'), /public/);
});
