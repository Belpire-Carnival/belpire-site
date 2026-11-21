import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanGear } from '../sc-mining-gear.js';
import { adjust, needed, evaluate, headPower, shipHeads } from '../../site/bureau/rsi1/companion/mining-calc.js';

const gear = cleanGear(JSON.parse(readFileSync(new URL('../sc-mining-gear.json', import.meta.url), 'utf8')));
const L = new Map(gear.lasers.map((l) => [l.key, l]));
const byName = (a, n) => a.find((x) => x.name === n);

test('the formula reproduces the worked examples of two public calculators', () => {
  assert.equal(Math.round(needed(8500, 28) * 10) / 10, 2361.1);
  assert.equal(Math.round(needed(50000, 31.25) * 100) / 100, 14545.45);
});

test('modifiers multiply: -30% and two -15% give about -49.4%, as a public calculator shows', () => {
  assert.equal(Math.round((1 - adjust(100, [-30, -15, -15]) / 100) * 1000) / 10, 49.4);
});

test('a resistance at or past 100% can never be broken', () => {
  assert.equal(needed(1000, 100), Infinity);
  const hof = byName(gear.lasers, 'Hofstede-S2 Mining Laser');
  assert.equal(evaluate({ mass: 1000, resist: 200, instab: 10 }, [{ laser: hof, modules: [] }]).verdict, 'never');
});

test('shipped data carries the game laser power and module multipliers', () => {
  const hof = byName(gear.lasers, 'Hofstede-S2 Mining Laser');
  assert.equal(hof.power, 4060);
  assert.equal(hof.tmin, 0.1);
  const surge = byName(gear.modules, 'Surge');
  assert.equal(surge.power, 1.5);
  assert.equal(Math.round(headPower(hof, [surge])), 6090);
  assert.ok(gear.gadgets.some((g) => g.name === 'BoreMax' && g.fx.instability === -70));
});

test('a Prospector at stock breaks a small rock and not a huge one', () => {
  const ship = gear.ships.find((s) => /Prospector$/.test(s.name));
  const heads = shipHeads(ship, L).map((h) => ({ laser: h.laser, modules: [] }));
  assert.equal(evaluate({ mass: 6000, resist: 30, instab: 20 }, heads).verdict, 'breaks');
  assert.equal(evaluate({ mass: 400000, resist: 60, instab: 20 }, heads).verdict, 'short');
});

test('three MOLE heads add their power', () => {
  const ship = gear.ships.find((s) => s.name === 'Argo MOLE');
  const heads = shipHeads(ship, L);
  assert.equal(heads.length, 3);
  const r = evaluate({ mass: 1000, resist: 0, instab: 0 }, heads.map((h) => ({ laser: h.laser, modules: [] })));
  assert.equal(r.available, r.perHead.reduce((a, b) => a + b, 0));
  assert.equal(r.perHead.length, 3);
});
