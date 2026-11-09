import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { damageClass, weaponType, weaponTypes, fpsRow, rankFps, shipEhp, shipDamageClass, shipGunRow, rankShipGuns, topOverall, topByGroup, topByClass } from '../../site/bureau/rsi1/companion/rank-core.js';
import { slimWeapons, handleWeapons } from '../sc-weapons.js';
import { indexParts } from '../../site/bureau/rsi1/companion/builder-core.js';

const gun = (id, name, wpn, sub = 'Rifle') => ({ id, name, mfr: 'M', sub, wpn: { pellets: 1, mag: 30, mode: 'AUTO', burst: null, cooldown: null, ...wpn } });

test('damage class follows the damage type a hit mostly carries', () => {
  assert.equal(damageClass(0, 18), 'Energy');
  assert.equal(damageClass(10, 0), 'Physical');
  assert.equal(damageClass(5, 5), 'Mixed');
  assert.equal(damageClass(2, 8), 'Energy');
  assert.equal(damageClass(0, 0), 'Unknown');
  assert.equal(weaponType({ sub: 'SMG' }), 'SMG');
  assert.equal(weaponType({ kind: 'Pistol' }), 'Pistol');
  assert.equal(weaponType({}), 'Other');
});

test('FPS time to kill uses the matrix maths: armor, rate of fire and a supplied reload time', () => {
  const w = gun('a', 'Alpha', { phys: 20, energy: 0, rpm: 600, mag: 10 });
  const none = fpsRow(w, { hp: 100, armor: { phys: 1, energy: 1 } });
  assert.equal(none.shots, 5);
  assert.equal(none.ttk, 0.4); // four gaps of 0.1 s
  const heavy = fpsRow(w, { hp: 100, armor: { phys: 0.5, energy: 0.5 } });
  assert.equal(heavy.shots, 10);
  assert.ok(heavy.ttk > none.ttk);
  // 10 shots fit one magazine; an 11th shot would need a reload of 3 s
  const tank = fpsRow(w, { hp: 105, armor: { phys: 0.5, energy: 0.5 } }, { reload: 3 });
  assert.equal(tank.shots, 11);
  assert.equal(tank.reloads, 1);
  assert.ok(Math.abs(tank.ttk - (1.0 + 3)) < 1e-9);
  assert.ok(Math.abs(tank.ttkBurst - 1.0) < 1e-9);
});

test('burst-fire weapons lose time to their cooldown in sustained TTK but not in burst TTK', () => {
  const w = gun('b', 'Burster', { phys: 25, energy: 0, rpm: 600, mode: 'BURST', burst: 3, cooldown: 0.5 });
  const r = fpsRow(w, { hp: 100, armor: { phys: 1, energy: 1 } });
  assert.equal(r.shots, 4);
  assert.ok(r.ttk > r.ttkBurst);
});

test('rankFps orders fastest first and counts weapons it cannot score', () => {
  const list = [gun('1', 'Slow', { phys: 10, rpm: 300 }), gun('2', 'Fast', { phys: 30, rpm: 900 }), gun('3', 'NoRate', { phys: 30 }), { id: '4', name: 'NoStats' }];
  const { rows, skipped } = rankFps(list, { hp: 100, armor: { phys: 1, energy: 1 } });
  assert.deepEqual(rows.map((r) => r.name), ['Fast', 'Slow']);
  assert.equal(skipped, 2);
});

const ship = { id: 's1', stats: { hull: 3000 }, slots: [{ id: 'sh', type: 'Shield', min: 1, max: 1, stock: 'shield1' }] };
const shield = { id: 'shield1', type: 'Shield', shield: { hp: 1500 } };
const sg = (id, name, size, burst, sustained, range, x = {}) => ({ id, name, mfr: 'M', type: 'WeaponGun', size, wpn: { burst, sustained, alpha: 10, range }, x });

test('reference ship health is hull plus the shields it carries', () => {
  assert.deepEqual(shipEhp(ship, indexParts([shield])), { hull: 3000, shield: 1500, ehp: 4500 });
  assert.equal(shipEhp({ stats: {} }, new Map()), null);
});

test('ship damage class reads the per-type figures in the data sheet', () => {
  assert.equal(shipDamageClass(sg('a', 'A', 3, 1, 1, 1, { 'vehicle_weapon.damage.physical': 100 })), 'Physical');
  assert.equal(shipDamageClass(sg('a', 'A', 3, 1, 1, 1, { 'vehicle_weapon.damage.energy': 100, 'vehicle_weapon.damage.physical': 5 })), 'Energy');
  assert.equal(shipDamageClass(sg('a', 'A', 3, 1, 1, 1, { 'vehicle_weapon.damage.distortion': 100 })), 'Distortion');
  assert.equal(shipDamageClass(sg('a', 'A', 3, 1, 1, 1, {})), 'Unknown');
});

test('ship gun time to kill is health over sustained damage, with burst beside it', () => {
  const r = shipGunRow(sg('a', 'A', 3, 1000, 750, 1800), 4500);
  assert.equal(r.ttk, 6);
  assert.equal(r.ttkBurst, 4.5);
  assert.equal(shipGunRow(sg('a', 'A', 3, 0, 0, 1800), 4500), null);
  assert.equal(shipGunRow({ id: 'x', name: 'x' }, 4500), null);
});

test('ship guns filter by size and by engagement range, and count guns with no range', () => {
  const parts = [sg('1', 'Near', 3, 1000, 800, 900), sg('2', 'Far', 3, 900, 700, 2400), sg('3', 'NoRng', 3, 2000, 1900, null), sg('4', 'Big', 4, 3000, 2500, 2000), { id: 'p', type: 'Shield' }];
  assert.deepEqual(rankShipGuns(parts, 4500).rows.map((r) => r.name), ['Big', 'NoRng', 'Near', 'Far']);
  const far = rankShipGuns(parts, 4500, { minRange: 1500 });
  assert.deepEqual(far.rows.map((r) => r.name), ['Big', 'Far']);
  assert.equal(far.noRange, 1);
  assert.deepEqual(rankShipGuns(parts, 4500, { size: 3 }).rows.map((r) => r.name), ['NoRng', 'Near', 'Far']);
});

test('lists: top overall, top per group in best-first order, split by damage class', () => {
  const rows = [
    { name: 'a', ttk: 1, type: 'Rifle', cls: 'Physical' }, { name: 'b', ttk: 2, type: 'Pistol', cls: 'Energy' },
    { name: 'c', ttk: 3, type: 'Rifle', cls: 'Energy' }, { name: 'd', ttk: 4, type: 'Rifle', cls: 'Physical' }, { name: 'e', ttk: 5, type: 'Pistol', cls: 'Mixed' }
  ];
  assert.deepEqual(topOverall(rows, 2).map((r) => r.name), ['a', 'b']);
  const g = topByGroup(rows, (r) => r.type, 2);
  assert.deepEqual(g.map((x) => x.key), ['Rifle', 'Pistol']);
  assert.deepEqual(g[0].rows.map((r) => r.name), ['a', 'c']);
  const c = topByClass(rows, 5);
  assert.deepEqual(c.map((x) => x.key), ['Physical', 'Energy', 'Mixed']);
  assert.deepEqual(c[0].rows.map((r) => r.name), ['a', 'd']);
});

const rec = (uuid, name, mfr, extra = {}) => ({ uuid, name, type: 'WeaponPersonal', manufacturer: { name: mfr }, sub_type: 'Rifle', personal_weapon: { capacity: 30, rpm: 600, fire_mode: 'Auto', modes: [{ mode: 'Auto', type: 'auto', rpm: 600 }] }, damage: { alpha: { physical: 20, energy: 0 } }, ...extra });

test('slimWeapons keeps scored weapons once each, sorted by name', () => {
  const list = slimWeapons([rec('1', 'Zed', 'A'), rec('2', 'Ace', 'A'), rec('3', 'Ace', 'A'), { uuid: '4', name: 'Grip', type: 'WeaponAttachment' }, null]);
  assert.deepEqual(list.map((w) => w.name), ['Ace', 'Zed']);
  assert.equal(list[0].wpn.rpm, 600);
  assert.equal(list[0].sub, 'Rifle');
  assert.equal('info' in list[0], false);
});

test('the weapons endpoint pages through the wiki, only follows its own host, and fails cleanly', async () => {
  const real = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      if (seen.length === 1) return new Response(JSON.stringify({ data: [rec('1', 'One', 'A')], links: { next: 'https://api.star-citizen.wiki/api/items?page=2' } }));
      if (seen.length === 2) return new Response(JSON.stringify({ data: [rec('2', 'Two', 'B')], links: { next: 'https://evil.example/steal' } }));
      throw new Error('no third page expected');
    };
    const ok = await handleWeapons({}, null);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.weapons.map((w) => w.name), ['One', 'Two']);
    assert.equal(seen.length, 2);
    assert.match(seen[0], /filter%5Btype%5D=WeaponPersonal/);
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    const bad = await handleWeapons({}, null);
    assert.equal(bad.status, 502);
    assert.equal(bad.body.ready, false);
  } finally { globalThis.fetch = real; }
});

test('the rankings page script only reads our own /api paths and builds with text', () => {
  const ui = readFileSync(new URL('../../site/bureau/rsi1/companion/rank-ui.js', import.meta.url), 'utf8');
  const urls = [...ui.matchAll(/(?:fetch\(|API[A-Z_]* = )\s*(['"`])(\/[^'"`]+)\1/g)].map((m) => m[2]);
  assert.ok(urls.length >= 3, urls.join());
  for (const u of urls) assert.match(u, /^\/api\//, u);
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|setAttribute\(\s*['"]style['"]|\.style\./);
  assert.doesNotMatch(ui, /https?:\/\//);
});

test('weapon type is the name a player would use, even when the wiki only says Small, Medium or Large', () => {
  assert.equal(weaponType({ name: 'Scourge "Desert Shadow" Railgun', sub: 'Large' }), 'Railgun');
  assert.equal(weaponType({ name: 'Boomtube Rocket Launcher', sub: 'Large' }), 'Rocket Launcher');
  assert.equal(weaponType({ name: 'Arrowhead Grenade Launcher', sub: 'Medium' }), 'Grenade Launcher');
  assert.equal(weaponType({ name: 'Mystery Launcher', sub: 'Large' }), 'Launcher');
  assert.equal(weaponType({ name: 'Coda', sub: 'Pistol' }), 'Pistol');
  assert.equal(weaponType({ name: 'Salvo Shotgun', sub: 'Small' }), 'Shotgun');
  assert.equal(weaponType({ name: 'Zenith', sub: 'Large' }), 'Other');
  assert.equal(weaponType({ name: 'Zenith' }), 'Other');
  assert.deepEqual(weaponTypes([{ name: 'a', sub: 'Rifle' }, { name: 'b', sub: 'Large' }, { name: 'c Railgun', sub: 'Large' }, { name: 'd', sub: 'Pistol' }, { name: 'e', sub: 'Rifle' }]), ['Pistol', 'Railgun', 'Rifle', 'Other']);
});
