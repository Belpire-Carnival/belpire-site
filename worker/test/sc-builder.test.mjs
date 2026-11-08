import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  slimPrices, slimPart, slimShip, collectSlots, buildSnapshot, jobUrl, stepWork, refreshBuilder, handleBuilder, REBUILD_MS
} from '../sc-builder.js';
import { fits, partsFor, indexParts, resolve, totals, diff, cheapest, upgradeCost } from '../../site/bureau/rsi1/companion/builder-core.js';

// Fixtures are trimmed copies of real api.star-citizen.wiki responses for game version 4.10.2-LIVE.12881860.
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8')).data;
const carrack = fx('carrack-slim.json');
const weapons = fx('weapons-slim.json');

const count = (slots, type) => slots.filter((s) => s.type === type).length;

test('slimShip finds the Carrack\'s swappable hardpoints, turret guns included', () => {
  const ship = slimShip(carrack);
  assert.equal(ship.name, 'Carrack');
  assert.equal(ship.mfr, 'Anvil Aerospace');
  assert.equal(count(ship.slots, 'Shield'), 2);
  assert.equal(count(ship.slots, 'Cooler'), 2);
  assert.equal(count(ship.slots, 'PowerPlant'), 2);
  assert.equal(count(ship.slots, 'QuantumDrive'), 1);
  assert.equal(count(ship.slots, 'WeaponGun'), 8);
  // Non-editable mounts (the gimbals, countermeasures) are not slots.
  assert.ok(ship.slots.every((s) => !['Turret', 'TurretBase', 'WeaponDefensive'].includes(s.type)));
  // Ids are unique even though both turrets name their gun port the same.
  assert.equal(new Set(ship.slots.map((s) => s.id)).size, ship.slots.length);
  const gun = ship.slots.find((s) => s.type === 'WeaponGun');
  assert.deepEqual([gun.min, gun.max], [4, 4]);
  assert.match(gun.id, /turret_left\/hardpoint_class_2$/);
});

test('stock totals agree with the game data\'s own ship totals', () => {
  const ship = slimShip(carrack);
  const parts = new Map();
  const walk = (ports) => ports?.forEach((p) => { if (p.equipped_item) { const s = slimPart(p.equipped_item); if (s) parts.set(s.id, s); } walk(p.ports); });
  walk(carrack.ports);
  const t = totals(ship, parts);
  assert.equal(t.missing, 0);
  assert.equal(t.shieldHp, ship.api.shieldHp);
  assert.equal(t.shieldRegen, ship.api.shieldRegen);
  assert.equal(t.coolGen, ship.api.coolSeg);
  assert.ok(Math.abs(t.burstDps - (ship.api.pilotDps + ship.api.turretDps)) < 0.5, `dps ${t.burstDps}`);
  // Known difference: the two Reliance plants give 2 × 23 = 46 segments, but the ship record reports 30.
  // The page shows the parts' own figure and does not claim it equals the ship record.
  assert.equal(t.powerGen, 46);
  assert.equal(ship.api.powerSeg, 30);
});

test('slimPrices keeps the cheapest known shops, newest date and place intact', () => {
  const rows = slimPrices(weapons[0].uex_prices);
  assert.equal(rows[0].p, 23905);
  assert.equal(rows[0].where, 'HUR-L3 Thundering Express Station');
  assert.equal(rows[0].sys, 'Stanton');
  assert.equal(rows[0].d, '2026-09-30');
  assert.ok(rows.every((r, i) => i === 0 || r.p >= rows[i - 1].p));
  assert.deepEqual(slimPrices({ purchase: [{ price_buy: null }, { price_buy: 0 }] }), []);
  assert.deepEqual(slimPrices(undefined), []);
});

test('slimPart reads weapon stats and rejects incomplete items', () => {
  const p = slimPart(weapons[1]);
  assert.equal(p.name, '11-Series Broadsword Cannon');
  assert.equal(p.size, 3);
  assert.equal(p.wpn.burst, 455.3);
  assert.equal(p.buy[0].p, 53790);
  assert.equal(slimPart({ name: 'x' }), null);
  assert.equal(slimPart(null), null);
});

test('fits matches kind and size range; costs only count known prices', () => {
  const slot = { id: 's', type: 'WeaponGun', min: 3, max: 4, stock: 'a' };
  const s3 = slimPart(weapons[1]);
  const s2 = slimPart(weapons[0]);
  assert.equal(fits(slot, s3), true);
  assert.equal(fits(slot, s2), false);
  assert.equal(fits({ ...slot, type: 'Shield' }, s3), false);
  assert.deepEqual(partsFor(slot, [s2, s3]).map((p) => p.id), [s3.id]);

  const ship = { slots: [slot, { id: 't', type: 'WeaponGun', min: 3, max: 4, stock: 'b' }] };
  const noShop = { ...s3, id: 'b2', name: 'No shop', buy: undefined };
  const byId = indexParts([s3, noShop, { ...s3, id: 'a' }, { ...s3, id: 'b' }]);
  const cost = upgradeCost(ship, byId, { s: s3.id, t: 'b2' }, Date.parse('2026-11-08'));
  assert.equal(cost.total, 53790);
  assert.equal(cost.unknown, 1);
  assert.equal(cost.stale, true); // the Sept 2 price is more than 30 days old
  assert.equal(upgradeCost(ship, byId, {}).lines.length, 0);
  assert.equal(cheapest({}), null);
});

test('diff and resolve compare two loadouts', () => {
  const ship = { slots: [{ id: 's', type: 'WeaponGun', min: 3, max: 4, stock: 'a' }] };
  const a = { ...slimPart(weapons[1]), id: 'a' };
  const b = { ...slimPart(weapons[1]), id: 'b', wpn: { burst: 500, sustained: 400, alpha: 120, range: 3000 } };
  const by = indexParts([a, b]);
  assert.deepEqual(resolve(ship, { s: 'b' }), { s: 'b' });
  const d = diff(totals(ship, by), totals(ship, by, { s: 'b' }));
  assert.equal(d.burstDps, 44.7);
});

test('collectSlots copes with odd data', () => {
  assert.deepEqual(collectSlots(null), []);
  assert.deepEqual(collectSlots([null, { name: 'x', type: 'Shield', editable: false }]), []);
});

test('jobUrl encodes brackets and filters ships to spaceships', () => {
  const u = jobUrl({ kind: 'ships', page: 2, size: 20 });
  assert.equal(u, '/vehicles?page%5Bsize%5D=20&page%5Bnumber%5D=2&filter%5Bis_spaceship%5D=true');
  assert.match(jobUrl({ kind: 'parts', page: 1, size: 100 }), /^\/vehicle-items\?.*filter%5Btype%5D=Shield%2CPowerPlant/);
  assert.match(jobUrl({ kind: 'weapons', page: 1, size: 100 }), /^\/vehicle-weapons\?/);
});

// ---------------------------------------------------------------- rebuild flow with a fake wiki API and KV
function fakeKv() {
  const m = new Map();
  return {
    m,
    async get(k, t) { const v = m.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); }
  };
}

function fakeWiki(calls, { version = '4.10.2-LIVE.1', shipPages = 3 } = {}) {
  return async (input) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const json = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (url.pathname.endsWith('/game-versions/default')) return json({ data: { code: version } });
    const page = Number(url.searchParams.get('page[number]') || 1);
    if (url.pathname.endsWith('/vehicle-items')) return json({ data: [weapons[0]].map((w) => ({ ...w, type: 'Shield', uuid: `shield-${page}` })), meta: { last_page: 1 } });
    if (url.pathname.endsWith('/vehicle-weapons')) return json({ data: weapons, meta: { last_page: 1 } });
    if (url.pathname.endsWith('/vehicles')) return json({ data: [{ ...carrack, uuid: `ship-${page}`, name: `Carrack ${page}` }], meta: { last_page: shipPages } });
    return new Response('nope', { status: 404 });
  };
}

test('rebuild spreads across cron ticks, then publishes one snapshot and skips until the version changes', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kv = fakeKv();
  const env = { SC_DATA: kv, SC_WIKI_API: 'https://wiki.test/api' };
  try {
    globalThis.fetch = fakeWiki(calls);
    // Tick 1: version check + 4 pages (parts, weapons, ship 1, ship 2); ship 3 is left for the next tick.
    assert.equal(await refreshBuilder(env), null);
    assert.equal(calls.length, 5);
    assert.ok(kv.m.has('sc:builder:work') && !kv.m.has('sc:builder'));
    // Progress is stored slimmed: a few KB, not the 70 KB-per-ship raw records.
    assert.ok(kv.m.get('sc:builder:work').length < 200000);
    // Tick 2: finishes.
    const snap = await refreshBuilder(env);
    assert.equal(snap.version, '4.10.2-LIVE.1');
    assert.equal(snap.ships.length, 3);
    assert.ok(snap.parts.some((p) => p.id === 'shield-1'));
    assert.ok(snap.parts.some((p) => p.name === 'CF-447 Rhino Repeater')); // stock part the catalogue lacked
    assert.ok(!kv.m.has('sc:builder:work'));
    assert.ok(snap.ships.every((s) => s.slots.length > 0));

    // Same version, fresh snapshot: only the one version request is made.
    calls.length = 0;
    await refreshBuilder(env);
    assert.equal(calls.length, 1);

    // A new game version triggers a rebuild.
    calls.length = 0;
    globalThis.fetch = fakeWiki(calls, { version: '4.11.0-LIVE.2' });
    assert.equal(await refreshBuilder(env), null);
    assert.ok(calls.length > 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an old snapshot is rebuilt after REBUILD_MS', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kv = fakeKv();
  const stale = buildSnapshot('4.10.2-LIVE.1', [slimShip(carrack)], []);
  stale.updatedAt = new Date(Date.now() - REBUILD_MS - 1000).toISOString();
  kv.m.set('sc:builder', JSON.stringify(stale));
  try {
    globalThis.fetch = fakeWiki(calls);
    await refreshBuilder({ SC_DATA: kv, SC_WIKI_API: 'https://wiki.test/api' });
    assert.ok(calls.length > 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a failing wiki API throws without publishing a partial snapshot', async () => {
  const realFetch = globalThis.fetch;
  const kv = fakeKv();
  try {
    globalThis.fetch = async () => new Response('down', { status: 503 });
    await assert.rejects(refreshBuilder({ SC_DATA: kv, SC_WIKI_API: 'https://wiki.test/api' }), /HTTP 503/);
    assert.equal(kv.m.size, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('stepWork stops at the page limit', async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [], meta: { last_page: 999 } }), { status: 200 });
    const work = { jobs: [{ kind: 'ships', page: 1, size: 20 }], pages: 39, ships: [], parts: [], stock: [] };
    await assert.rejects(stepWork({ SC_WIKI_API: 'https://wiki.test/api' }, work), /page limit/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('handleBuilder reports not-ready, then serves the snapshot', async () => {
  const kv = fakeKv();
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p.catch(() => {})) };
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('down', { status: 503 });
    const first = await handleBuilder({ SC_DATA: kv }, ctx);
    assert.equal(first.ready, false);
    await Promise.all(waits);
  } finally {
    globalThis.fetch = realFetch;
  }
  kv.m.set('sc:builder', JSON.stringify(buildSnapshot('4.10.2-LIVE.1', [slimShip(carrack)], [])));
  const ready = await handleBuilder({ SC_DATA: kv }, ctx);
  assert.equal(ready.ready, true);
  assert.equal(ready.ships[0].name, 'Carrack');
});
