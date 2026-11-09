import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  viewOf, racksOf, ordnanceTotals, encodeBuild, decodeBuild, indexParts, columnsFor, sortParts, detailGroups, fmtVal, MSL_KEY, changedSlots, totals
} from '../../site/bureau/rsi1/companion/builder-core.js';
import { tidyShips, armamentGaps } from '../../site/bureau/rsi1/companion/builder.js';

const rackPart = { id: 'r1', name: 'Rack 4xS2', type: 'MissileLauncher', size: 2, rack: { count: 4, size: 2 } };
const m1 = { id: 'm1', name: 'Dominator II', type: 'Missile', size: 2, msl: { dmg: 1400, lock: 2.5, speed: 900, rmax: 4000, sig: 'IR' } };
const m2 = { id: 'm2', name: 'Pioneer', type: 'Missile', size: 2, msl: { dmg: 3100, lock: 3.5, speed: 700, rmax: 5000, sig: 'CS' } };
const m3 = { id: 'm3', name: 'Big', type: 'Missile', size: 5, msl: { dmg: 9000 } };
const ship = { id: 's1', name: 'Test', slots: [{ id: 'rackA', type: 'MissileLauncher', min: 2, max: 2, stock: 'r1', locked: true }, { id: 'gun1', type: 'WeaponGun', min: 1, max: 1, stock: null }] };
const parts = indexParts([rackPart, m1, m2, m3]);

test('views: spaceships are ships, ground and grav vehicles are vehicles', () => {
  assert.equal(viewOf({ kind: 'ship' }), 'ship');
  assert.equal(viewOf({}), 'ship');
  assert.equal(viewOf({ kind: 'ground' }), 'vehicle');
  assert.equal(viewOf({ kind: 'gravlev' }), 'vehicle');
});

test('racks list their tubes and size, and the chosen missile counts toward the load', () => {
  const none = racksOf(ship, parts, {});
  assert.equal(none.length, 1);
  assert.equal(none[0].tubes, 4);
  assert.equal(none[0].size, 2);
  assert.equal(none[0].missile, null);
  assert.deepEqual(ordnanceTotals(ship, parts, {}), { tubes: 4, chosen: 0, damage: 0 });
  const ov = { [MSL_KEY + 'rackA']: 'm2' };
  assert.deepEqual(ordnanceTotals(ship, parts, ov), { tubes: 4, chosen: 4, damage: 12400 });
  assert.equal(racksOf(ship, parts, ov)[0].pseudo.max, 2);
});

test('a missile choice is not a part swap, and travels in the share link only when it fits a rack', () => {
  const ov = { [MSL_KEY + 'rackA']: 'm2' };
  assert.equal(changedSlots(ship, ov).length, 0);
  assert.deepEqual(totals(ship, parts, ov), totals(ship, parts, {}));
  const back = decodeBuild(encodeBuild(ship, ov), [ship], parts);
  assert.deepEqual(back.overrides, ov);
  const bad = decodeBuild(encodeBuild(ship, { [MSL_KEY + 'rackA']: 'r1', [MSL_KEY + 'nope']: 'm1' }), [ship], parts);
  assert.deepEqual(bad.overrides, {});
});

test('swap table columns sort both ways and keep parts with no figure last', () => {
  const cols = columnsFor('Missile');
  const dmg = cols.find((c) => c.id === 'dmg');
  assert.deepEqual(sortParts([m1, m3, m2], dmg, -1).map((p) => p.id), ['m3', 'm2', 'm1']);
  assert.deepEqual(sortParts([m1, m3, m2], dmg, 1).map((p) => p.id), ['m1', 'm2', 'm3']);
  const none = { id: 'x', name: 'A', type: 'Missile' };
  assert.equal(sortParts([none, m1], dmg, 1).at(-1).id, 'x');
  assert.equal(sortParts([none, m1], dmg, -1).at(-1).id, 'x');
  assert.ok(columnsFor('Shield').some((c) => c.id === 'shp'));
  assert.ok(columnsFor('Unknown').length > 0);
});

test('the data sheet groups every stored figure with readable labels and numbers', () => {
  const g = detailGroups({ x: { 'vehicle_weapon.damage.dps.physical': 1583.3, 'durability.resistance.physical': 0.6, 'vehicle_weapon.ammunition.speed': 1100, 'quantum_drive.fuel_rate': 6.1e-9, 'power_plant.flag': true } });
  const w = g.find((x) => x.title === 'Weapon');
  assert.deepEqual(w.rows[0], ['damage › dps › physical', '1,583.3']);
  assert.ok(g.some((x) => x.title === 'Durability'));
  assert.equal(fmtVal(6.1e-9), '6.10e-9');
  assert.equal(fmtVal(true), 'yes');
  assert.equal(fmtVal(12345.6), '12,346');
  assert.deepEqual(detailGroups({}), []);
});

test('vehicles are kept without hardpoints and left out of the gun audit', () => {
  const v = { id: 'v1', name: 'Cyclone', mfr: 'Tumbril', kind: 'ground', scm: 40, stats: { hull: 500 }, slots: [], img: '' };
  const s = { id: 's2', name: 'Ship', mfr: 'RSI', kind: 'ship', scm: 200, stats: { hull: 1000 }, slots: [{ id: 'a', type: 'Shield' }], img: '' };
  const t = tidyShips([v, s]);
  assert.deepEqual(t.ships.map((x) => x.id).sort(), ['s2', 'v1']);
  const gaps = armamentGaps(t.ships);
  assert.deepEqual([...gaps.placed, ...gaps.listed, ...gaps.none], ['Ship']);
});

test('the pop-ups and the new panels follow the page rules', () => {
  const src = ['builder-holo.js', 'builder.js', 'builder-core.js', 'art.js'].map((f) => readFileSync(new URL(`../../site/bureau/rsi1/companion/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|setAttribute\(\s*['"]style['"]|\.style\./);
  assert.doesNotMatch(readFileSync(new URL('../../site/bureau/rsi1/companion/builder-holo.js', import.meta.url), 'utf8'), /fetch\(|https?:\/\//);
});
