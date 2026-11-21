import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partImgFromQuery, handlePartImg } from '../sc-img.js';
import { missileRow, rankMissiles } from '../../site/bureau/rsi1/companion/rank-core.js';

const answer = { query: { normalized: [{ from: 'bulwark', to: 'Bulwark' }], redirects: [{ from: 'Ravager', to: 'Ravager-212' }], pages: [
  { title: 'Bulwark', thumbnail: { source: 'https://media.starcitizen.tools/thumb/a/ab/Bulwark.jpg/200px-Bulwark.jpg' } },
  { title: 'Ravager-212', thumbnail: { source: 'https://evil.example/thumb/a/ab/x.jpg/200px-x.jpg' } },
  { title: 'Nothing', missing: true }] } };

test('page images are kept only from the wiki media host and plain paths, and follow redirects and normalised titles', () => {
  const r = partImgFromQuery(answer, ['bulwark', 'Ravager', 'Nothing', 'Unasked']);
  assert.equal(r.bulwark, 'thumb/a/ab/Bulwark.jpg/200px-Bulwark.jpg'); assert.equal(r.Ravager, ''); assert.equal(r.Nothing, ''); assert.equal(r.Unasked, '');
  assert.deepEqual(partImgFromQuery(null, ['x']), { x: '' });
});

test('the picture endpoint asks the wiki once per name, remembers hits and misses, and rejects an empty request', async () => {
  const store = new Map(); const env = { SC_DATA: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  const real = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (u) => { calls++; assert.match(String(u), /starcitizen\.tools\/api\.php/); return { ok: true, json: async () => ({ query: { pages: [{ title: 'Bulwark', thumbnail: { source: 'https://media.starcitizen.tools/thumb/a/ab/Bulwark.jpg/200px-Bulwark.jpg' } }] } }) }; };
  try {
    const r = await handlePartImg(new URL('https://x/api/sc-partimg?n=Bulwark&n=Mystery%20Part&n=x'), env);
    assert.equal(r.status, 200); assert.equal(r.body.images.Bulwark, 'thumb/a/ab/Bulwark.jpg/200px-Bulwark.jpg'); assert.equal(r.body.images['Mystery Part'], ''); assert.equal(calls, 1);
    const again = await handlePartImg(new URL('https://x/api/sc-partimg?n=Bulwark&n=Mystery%20Part'), env);
    assert.equal(calls, 1); assert.equal(again.body.images['Mystery Part'], '');
    assert.equal((await handlePartImg(new URL('https://x/api/sc-partimg'), env)).status, 400);
    globalThis.fetch = async () => { throw new Error('down'); };
    const down = await handlePartImg(new URL('https://x/api/sc-partimg?n=Other'), env);
    assert.equal(down.status, 200); assert.equal(down.body.images.Other, '');
  } finally { globalThis.fetch = real; }
});

const parts = [
  { id: 'a', type: 'Missile', name: 'Dominator II', size: 2, msl: { sig: 'IR', dmg: 1500, lock: 2.5, speed: 900, rmax: 4000 } },
  { id: 'b', type: 'Missile', name: 'Tempest', size: 3, msl: { sig: 'EM', dmg: 2800, lock: 4, speed: 700, rmax: 5000 } },
  { id: 'c', type: 'Missile', name: 'Bad', size: 1, msl: { sig: 'IR', dmg: 0 } },
  { id: 'd', type: 'WeaponGun', name: 'Gun', wpn: { burst: 1 } }
];

test('missiles are ranked by damage, lock time or speed, filtered by size and tracking, with missiles to kill', () => {
  assert.equal(missileRow(parts[2], 4000), null); assert.equal(missileRow({ type: 'Missile' }, 1), null);
  assert.deepEqual(rankMissiles(parts, 4000).map((r) => r.name), ['Tempest', 'Dominator II']);
  assert.deepEqual(rankMissiles(parts, 4000, { sort: 'lock' }).map((r) => r.name), ['Dominator II', 'Tempest']);
  assert.deepEqual(rankMissiles(parts, 4000, { sort: 'speed' }).map((r) => r.name), ['Dominator II', 'Tempest']);
  assert.deepEqual(rankMissiles(parts, 4000, { size: '3' }).map((r) => r.name), ['Tempest']); assert.deepEqual(rankMissiles(parts, 4000, { sig: 'IR' }).map((r) => r.name), ['Dominator II']);
  assert.equal(rankMissiles(parts, 4000)[0].kills, 2); assert.equal(rankMissiles(parts, 4000)[1].kills, 3); assert.equal(rankMissiles(parts, 0)[0].kills, null);
  assert.deepEqual(rankMissiles(null, 1), []);
});

test('the part pages ask for a wiki picture when the item database has none, and the route is wired', () => {
  const dir = new URL('../../site/bureau/rsi1/companion/', import.meta.url);
  const builder = readFileSync(new URL('builder.js', dir), 'utf8');
  assert.match(builder, /lazyPhoto\(p\)/); assert.match(readFileSync(new URL('builder-holo.js', dir), 'utf8'), /lazyPhoto\(part/);
  assert.match(readFileSync(new URL('rank-ui.js', dir), 'utf8'), /rankMissiles/);
  assert.match(readFileSync(new URL('../../../../worker/index.js', dir), 'utf8'), /\/api\/sc-partimg/);
});
