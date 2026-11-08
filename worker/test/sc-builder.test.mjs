import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  slimPrices, slimPart, slimShip, collectSlots, buildSnapshot, jobUrl, stepWork, refreshBuilder, handleBuilder, REBUILD_MS
} from '../sc-builder.js';
import { slotLabel, partLabel, deltaClass, signed, fits, partsFor, indexParts, resolve, totals, diff, cheapest, upgradeCost } from '../../site/bureau/rsi1/companion/builder-core.js';

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
  // Draw excludes the plants' own figure: shields 10 + coolers 10 + quantum drive 5 + radar 0 + 8 guns × 0.9.
  assert.ok(t.powerDraw < 46, `draw ${t.powerDraw}`);
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

test('handleBuilder never starts a rebuild; it reports progress and then serves the snapshot', async () => {
  const kv = fakeKv();
  const realFetch = globalThis.fetch;
  let fetched = 0;
  try {
    globalThis.fetch = async () => { fetched++; return new Response('down', { status: 503 }); };
    assert.deepEqual(await handleBuilder({ SC_DATA: kv }), { ready: false, progress: null });
    kv.m.set('sc:builder:work', JSON.stringify({ pages: 4, jobs: [1, 2] }));
    assert.deepEqual(await handleBuilder({ SC_DATA: kv }), { ready: false, progress: { pages: 4, remaining: 2 } });
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
  kv.m.set('sc:builder', JSON.stringify(buildSnapshot('4.10.2-LIVE.1', [slimShip(carrack)], [])));
  const ready = await handleBuilder({ SC_DATA: kv });
  assert.equal(ready.ready, true);
  assert.equal(ready.ships[0].name, 'Carrack');
});

test('an overlapping cron run is skipped by the lock', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kv = fakeKv();
  const env = { SC_DATA: kv, SC_WIKI_API: 'https://wiki.test/api' };
  try {
    globalThis.fetch = fakeWiki(calls);
    await refreshBuilder(env, { lock: true });
    const used = calls.length;
    assert.equal(await refreshBuilder(env, { lock: true }), null);
    assert.equal(calls.length, used); // second run made no requests
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a KV delete failure after publishing does not fail the rebuild, and duplicate ships collapse', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  const kv = fakeKv();
  kv.delete = async () => { throw new Error('KV DELETE failed: 429 Too Many Requests'); };
  try {
    globalThis.fetch = fakeWiki(calls, { shipPages: 1 });
    const snap = await refreshBuilder({ SC_DATA: kv, SC_WIKI_API: 'https://wiki.test/api' });
    assert.equal(snap.ships.length, 1);
    assert.ok(kv.m.has('sc:builder'));
  } finally {
    globalThis.fetch = realFetch;
  }
  const dup = slimShip(carrack);
  assert.equal(buildSnapshot('v', [dup, dup, dup], []).ships.length, 1);
});

test('slot and part labels are readable and tell turret guns apart', () => {
  assert.equal(slotLabel({ id: 'hardpoint_shield_generator_l', type: 'Shield' }), 'shield generator l');
  const a = slotLabel({ id: 'hardpoint_turret_back_rear/turret_left/hardpoint_class_2', type: 'WeaponGun' });
  const b = slotLabel({ id: 'hardpoint_turret_back_rear/turret_right/hardpoint_class_2', type: 'WeaponGun' });
  assert.equal(a, 'turret back rear · turret left');
  assert.notEqual(a, b);
  assert.equal(slotLabel({ id: 'hardpoint_class_2#2', type: 'WeaponGun' }), 'class 2');
  assert.equal(partLabel(slimPart(weapons[1])), '11-Series Broadsword Cannon · A · 455.3 dps');
  assert.equal(deltaClass(5, true), 'ok');
  assert.equal(deltaClass(5, false), 'warn');
  assert.equal(deltaClass(0, true), '');
  assert.equal(signed(-1500), '−1,500');
  assert.equal(signed(20), '+20');
});

// ---------------------------------------------------------------- calculator additions
import { slimStats } from '../sc-builder.js';
import { reduction, coolingLoad, damageSplit, changedSlots, encodeBuild, decodeBuild, dims, gm, kms, num } from '../../site/bureau/rsi1/companion/builder-core.js';
import { shipKind } from '../../site/bureau/rsi1/companion/art.js';

const fullShip = {
  health: 29760, mass_total: 242177, dimension: { length: 37.5, width: 26.5, height: 11.5 }, cross_section_max: 40.2,
  armor: { health: 7290, damage_physical: 0.75, damage_energy: 0.6, damage_distortion: 1 },
  shield: { face_type: 'Bubble', regeneration_time: 5.5, resistance: { physical: { maximum: 0.25 }, energy: { maximum: 0 }, distortion: { maximum: 0.95 } }, absorption: { physical: { maximum: 0.45 }, energy: { maximum: 1 }, distortion: { maximum: 1 } } },
  agility: { pitch: 39, yaw: 35, roll: 110, pitch_boosted: 39, yaw_boosted: 35, roll_boosted: 110 },
  speed: { boost_forward: 465, boost_backward: 230, zero_to_scm: 2.1 },
  fuel: { capacity: 7.8, intake_rate: 0 }, quantum: { quantum_speed: 238314000, quantum_spool_time: 6.9, quantum_fuel_capacity: 4.6, quantum_range: 209.1e9 },
  signature: { ir_shields: 4200, em_shields: 11600 }, emission: { em_max: 20000 },
  weaponry: { total_missile_damage: 39200, missiles: { count: 12 } }, insurance: { claim_time: 4.8, expedite_time: 1.6, expedite_cost: 2600 }
};

test('slimStats keeps ship figures, rounds them, and leaves missing ones null', () => {
  const st = slimStats(fullShip);
  assert.equal(st.hull, 29760);
  assert.equal(st.armor.hp, 7290);
  assert.equal(st.shield.face, 'Bubble');
  assert.equal(st.shield.resist.dist, 0.95);
  assert.equal(st.agility.roll, 110);
  assert.equal(st.quantum.range, 209100000000);
  assert.equal(st.missiles.damage, 39200);
  assert.deepEqual(st.dim, [37.5, 26.5, 11.5]);
  const empty = slimStats({});
  assert.equal(empty.hull, null);
  assert.equal(empty.armor.hp, null);
  assert.deepEqual(empty.dim, [null, null, null]);
  assert.equal(slimStats(null).hull, null);
});

test('slimShip carries the stats object', () => {
  assert.equal(typeof slimShip(carrack).stats, 'object');
  assert.equal(slimShip(carrack).stats.shield.resist.phys, 0.25);
});

test('damage reduction and cooling load read the way the page shows them', () => {
  assert.equal(reduction(0.75), 25);
  assert.equal(reduction(1), 0);
  assert.equal(reduction(null), null);
  assert.equal(coolingLoad({ coolGen: 50, coolDraw: 38 }), 76);
  assert.equal(coolingLoad({ coolGen: 0, coolDraw: 5 }), null);
});

test('guns on turrets and guns on the pilot are totalled apart', () => {
  const ship = slimShip(carrack);
  const parts = indexParts([slimPart(weapons[0]), slimPart(weapons[1])].filter(Boolean));
  const split = damageSplit(ship, parts, {});
  assert.equal(split.pilot.guns + split.turret.guns <= 8, true);
  for (const b of Object.values(split)) assert.ok(b.burst >= 0);
});

test('a share link round-trips, and a mangled or foreign link is refused', () => {
  const ship = slimShip(carrack);
  const slot = ship.slots.find((s) => s.type === 'WeaponGun');
  const gun = { ...slimPart(weapons[1]), id: 'g1', size: slot.max };
  const parts = indexParts([gun]);
  const code = encodeBuild(ship, { [slot.id]: gun.id });
  assert.match(code, /^[\w-]+$/);
  const back = decodeBuild(code, [ship], parts);
  assert.equal(back.ship.id, ship.id);
  assert.deepEqual(back.overrides, { [slot.id]: gun.id });
  assert.equal(decodeBuild('not a code', [ship], parts), null);
  assert.equal(decodeBuild(encodeBuild({ ...ship, id: 'nope' }, {}), [ship], parts), null);
  // A part that does not fit the slot is dropped, not applied.
  const shield = { ...gun, id: 'x', type: 'Shield' };
  const forged = encodeBuild(ship, { [slot.id]: 'x' });
  assert.deepEqual(decodeBuild(forged, [ship], indexParts([shield])).overrides, {});
  assert.deepEqual(changedSlots(ship, { [slot.id]: slot.stock }), []);
});

test('number helpers do not invent values', () => {
  assert.equal(num(null), '—');
  assert.equal(num(1234.5, 1), '1,234.5');
  assert.equal(dims([37.5, 26.5, 11.5]), '37.5 × 26.5 × 11.5 m');
  assert.equal(dims([null, 1, 2]), '—');
  assert.equal(gm(209.1e9), '209.1 Gm');
  assert.equal(kms(238314000), '238,314 km/s');
});

test('ship silhouettes follow the ship\'s role', () => {
  assert.equal(shipKind({ role: 'Light Fighter', career: 'Combat' }), 'fighter');
  assert.equal(shipKind({ role: 'Medium Freight', career: 'Industrial', size: 3 }), 'hauler');
  assert.equal(shipKind({ role: 'Pathfinder', career: 'Exploration' }), 'explorer');
  assert.equal(shipKind({ role: 'Heavy Salvage', career: 'Industrial' }), 'tool');
  assert.equal(shipKind({}), 'fighter');
});

// ---------------------------------------------------------------- guns the wiki does not list as child ports
import { pilotGunSlots, turretGunSlots } from '../sc-builder.js';
const cutlass = fx('cutlass-slim.json');

test('the Cutlass Black\'s pilot gimbal mounts and manned turret become gun slots', () => {
  const ship = slimShip(cutlass);
  const guns = ship.slots.filter((s) => s.type === 'WeaponGun');
  assert.equal(guns.length, 6);
  const pilot = guns.filter((s) => /Weapon$/.test(s.id));
  assert.deepEqual(pilot.map((s) => s.id), ['hardpoint_Left_Body_Weapon', 'hardpoint_Right_Body_Weapon', 'hardpoint_Left_Wing_Weapon', 'hardpoint_Right_Wing_Weapon']);
  assert.deepEqual(pilot.map((s) => s.stockName), ['Mantis GT-220 Gatling', 'Mantis GT-220 Gatling', 'CF-337 Panther Repeater', 'CF-337 Panther Repeater']);
  assert.ok(pilot.every((s) => s.min === 3 && s.max === 3));
  const turret = guns.filter((s) => s.id.startsWith('hardpoint_turret/'));
  assert.deepEqual(turret.map((s) => s.id), ['hardpoint_turret/hardpoint_weapon_right', 'hardpoint_turret/hardpoint_weapon_left']);
  assert.ok(turret.every((s) => s.stock === 'bd13235d-1261-4b71-b32f-aed1a8beb526' && s.max === 3));
  // The tractor turret and the countermeasure launchers are not guns.
  assert.ok(!ship.slots.some((s) => /tractor|cm_launcher/.test(s.id)));
});

test('missile racks are swappable slots', () => {
  const ship = slimShip(cutlass);
  const racks = ship.slots.filter((s) => s.type === 'MissileLauncher');
  assert.equal(racks.length, 6);
  assert.ok(racks.every((s) => s.min === 4 && s.max === 4 && s.stock));
});

test('a ship whose turret guns are already ports is not given them twice', () => {
  const ship = slimShip(carrack);
  assert.equal(ship.slots.filter((s) => s.type === 'WeaponGun').length, 8);
  assert.deepEqual(turretGunSlots(carrack.turrets, ship.slots), []);
});

test('pilot guns are only named when there is exactly one name per mount', () => {
  const ports = cutlass.ports;
  const names = cutlass.weaponry.fixed_weapons.weapons;
  assert.equal(pilotGunSlots(ports, names)[0].stockName, 'Mantis GT-220 Gatling');
  assert.equal('stockName' in pilotGunSlots(ports, names.slice(1))[0], false);
  assert.equal(pilotGunSlots(ports, null).length, 4);
});

test('buildSnapshot finds a named stock gun in the catalogue by name and size', () => {
  const ship = slimShip(cutlass);
  const mantis = { id: 'mantis-id', name: 'Mantis GT-220 Gatling', type: 'WeaponGun', size: 3, wpn: { burst: 853.3, sustained: 629.1, alpha: 32 } };
  const wrong = { id: 'mantis-s4', name: 'Mantis GT-220 Gatling', type: 'WeaponGun', size: 4 };
  const cf = { id: 'cf-id', name: 'CF-337 Panther Repeater', type: 'WeaponGun', size: 3, wpn: { burst: 545.6, sustained: 278.9, alpha: 43.7 } };
  const snap = buildSnapshot('4.10.2', [ship], [wrong, mantis, cf]);
  const slots = snap.ships[0].slots;
  assert.equal(slots.find((s) => s.id === 'hardpoint_Left_Body_Weapon').stock, 'mantis-id');
  assert.equal(slots.find((s) => s.id === 'hardpoint_Right_Wing_Weapon').stock, 'cf-id');
  assert.ok(slots.every((s) => !('stockName' in s)));
  // A gun the catalogue does not have leaves the stock empty rather than guessing.
  const snap2 = buildSnapshot('4.10.2', [ship], []);
  assert.equal(snap2.ships[0].slots.find((s) => s.id === 'hardpoint_Left_Body_Weapon').stock, null);
});

test('the Cutlass\'s stock burst damage adds up to the wiki\'s own 2,797.8 for the pilot guns', () => {
  const ship = slimShip(cutlass);
  const mantis = { id: 'mantis-id', name: 'Mantis GT-220 Gatling', type: 'WeaponGun', size: 3, wpn: { burst: 853.3, sustained: 629.1, alpha: 32 } };
  const cf = { id: 'cf-id', name: 'CF-337 Panther Repeater', type: 'WeaponGun', size: 3, wpn: { burst: 545.6, sustained: 278.9, alpha: 43.7 } };
  const snap = buildSnapshot('4.10.2', [ship], [mantis, cf, { ...cf, id: 'bd13235d-1261-4b71-b32f-aed1a8beb526' }]);
  const s = snap.ships[0];
  const split = damageSplit(s, indexParts(snap.parts), {});
  assert.equal(split.pilot.guns, 4);
  assert.equal(Math.round(split.pilot.burst * 10) / 10, 2797.8);
  assert.equal(split.turret.guns, 2);
  assert.equal(Math.round(split.turret.burst * 10) / 10, 1091.2);
});
