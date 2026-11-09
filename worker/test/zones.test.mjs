import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneFromText, plain, handleZones } from '../sc-zones.js';
import { riskOf, setZones, learnZones, nameCandidates, worst } from '../../site/bureau/rsi1/companion/risk.js';

test('wiki text: a "not an Armistice Zone" warning wins, an Armistice Zone statement is safe, silence is unknown', () => {
  assert.equal(zoneFromText('Security. Be warned - the site is not an Armistice Zone. Hostile players may attack.').z, 'open');
  assert.equal(zoneFromText('The spaceport is an Armistice Zone. Weapons are locked.').z, 'armistice');
  assert.equal(zoneFromText('Jurisdiction: Hurston Dynamics. Under its jurisdiction the landing zone is an Armistice Zone.').z, 'armistice');
  assert.equal(zoneFromText('Armistice zone: Yes').z, 'armistice');
  assert.equal(zoneFromText('A mining outpost on Wala. Sells ore.').z, 'unknown');
  assert.equal(zoneFromText('The site is an Armistice Zone, but the pad is not an Armistice Zone.').z, 'open');
  assert.match(zoneFromText('Be warned - the site is not an Armistice Zone.').ev, /not an Armistice Zone/);
});

test('plain strips tags and keeps sentences apart', () => {
  assert.equal(zoneFromText(plain('<p>Hello.</p><p>Be warned - the site is <b>not</b> an Armistice Zone.</p>')).z, 'open');
});

test('candidates go from the most specific part of a terminal name to the place', () => {
  assert.deepEqual(nameCandidates('TDD - Teasa Spaceport', 'Lorville'), ['TDD - Teasa Spaceport', 'Teasa Spaceport', 'TDD', 'Lorville']);
});

test('wiki status overrides the rule of thumb: armistice is SAFE, "not armistice" is at least Medium, Pyro stays High', () => {
  const k = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '');
  setZones({ [k('Teasa Spaceport')]: { z: 'armistice' }, [k('Shepherd Outpost')]: { z: 'open' }, [k('Lorville')]: { z: 'unknown' }, [k('Rustville')]: { z: 'open' }, [k('Grim HEX')]: { z: 'armistice' } });
  assert.equal(riskOf('Stanton', 'TDD - Teasa Spaceport', 'Lorville').level, 'safe');
  assert.equal(riskOf('Stanton', 'Shepherd Outpost').level, 'med');
  assert.equal(riskOf('Stanton', 'Admin - Lorville').level, 'low'); // unknown on the wiki keeps the rule
  assert.equal(riskOf('Pyro', 'Rustville').level, 'high');
  assert.equal(riskOf('Stanton', 'Grim HEX').level, 'safe');
  assert.equal(riskOf('Nyx', 'Somewhere Else').level, 'med');
  assert.equal(worst(riskOf('Stanton', 'TDD - Teasa Spaceport'), riskOf('Stanton', 'Shepherd Outpost')).level, 'med');
  assert.match(riskOf('Stanton', 'Shepherd Outpost').note, /not an Armistice Zone/);
});

test('learnZones asks once per name, in chunks, and survives a failing endpoint', async () => {
  const calls = [];
  const fetcher = async (u) => { calls.push(u); return { ok: true, json: async () => ({ zones: { x: { z: 'open' } } }) }; };
  const rows = Array.from({ length: 20 }, (_, i) => ({ terminal: `Admin - Place ${i}`, place: `Place ${i}` }));
  assert.equal(await learnZones(rows, { fetcher }), true);
  assert.ok(calls.length >= 2 && calls.every((u) => u.startsWith('/api/sc-zones?n=')));
  const n = calls.length;
  await learnZones(rows, { fetcher });
  assert.equal(calls.length, n);
  assert.equal(await learnZones([{ terminal: 'Boom Station', place: 'Boom' }], { fetcher: async () => { throw new Error('x'); } }), false);
});

test('endpoint reads the wiki once per name, caches, and degrades to unknown', async () => {
  const store = new Map(); const env = { SC_DATA: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, JSON.parse(v)); } } };
  const real = globalThis.fetch; let hits = 0;
  globalThis.fetch = async (u) => { hits++; const q = new URL(u).searchParams; if (q.get('action') === 'parse' && q.get('page') === 'Washout') return { ok: true, json: async () => ({ parse: { title: 'Washout', text: '<p>Be warned - the site is not an Armistice Zone.</p>' } }) }; return { ok: true, json: async () => ({ query: { search: [] } }) }; };
  try {
    const r = await handleZones(new URL('https://x/api/sc-zones?n=Washout&n=Nowhere'), env);
    assert.equal(r.body.zones.washout.z, 'open'); assert.equal(r.body.zones.nowhere.z, 'unknown');
    const before = hits; await handleZones(new URL('https://x/api/sc-zones?n=Washout'), env); assert.equal(hits, before);
    assert.equal((await handleZones(new URL('https://x/api/sc-zones'), env)).status, 400);
  } finally { globalThis.fetch = real; }
});

test('wiki visitor-information box: tick or cross on the Armistice zone row, with jurisdiction', () => {
  const box = plain('<table><tr><td>Map marker</td><td>✓</td></tr><tr><td>Jurisdiction</td><td>microTech</td></tr><tr><td>Comm-array coverage</td><td>✓</td></tr><tr><td>Armistice zone</td><td>✗</td></tr><tr><td>Private property</td><td>✗</td></tr></table>');
  const r = zoneFromText(box);
  assert.equal(r.z, 'open'); assert.equal(r.j, 'microTech');
  assert.equal(zoneFromText(plain('<tr><td>Jurisdiction</td><td>UEE</td></tr><tr><td>Armistice zone</td><td>✓</td></tr><tr><td>Private property</td><td>✗</td></tr>')).z, 'armistice');
  assert.equal(zoneFromText(plain('<tr><td>Armistice zone</td><td><img alt="No" src="x.png"></td></tr>')).z, 'open');
  assert.equal(zoneFromText(plain('<tr><td>Armistice zone</td><td>Yes</td></tr>')).z, 'armistice');
  assert.equal(zoneFromText('Comm-array coverage ✓ Private property ✗').z, 'unknown');
});

test('every place in Pyro is PvP risk (High), even when the wiki says armistice', () => {
  setZones({ checkmatestation: { z: 'armistice' }, rustvilleoutpost: { z: 'open' } });
  assert.equal(riskOf('Pyro', 'Checkmate Station').level, 'high');
  assert.equal(riskOf('Pyro', 'Some Safe Place').level, 'high');
});
