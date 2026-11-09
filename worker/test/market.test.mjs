import test from 'node:test';
import assert from 'node:assert/strict';
import { riskOf, worst } from '../../site/bureau/rsi1/companion/risk.js';
import { freshRows, systemsIn, bestRuns, areaBoard } from '../../site/bureau/rsi1/companion/market.js';

const row = (commodity, terminal, system, place, buy, sell, at = null) => ({ commodity, terminal, system, place, buy, sell, at });
const rows = [
  row('Agricium', 'Admin - Lorville', 'Stanton', 'Lorville', 20, null), row('Agricium', 'Trade - Area 18', 'Stanton', 'Area 18', null, 30),
  row('Hides', 'Shop - Levski', 'Nyx', 'Levski', 10, 12), row('Hides', 'Rat\'s Nest', 'Pyro', 'Rat\'s Nest', null, 40),
  row('Beans', 'Outpost X', 'Pyro', 'Outpost X', 5, null), row('Beans', 'Checkmate Bar', 'Pyro', 'Checkmate Station', null, 15),
  row('Old', 'Admin - Lorville', 'Stanton', 'Lorville', 1, 99, 1000)
];

test('risk rules: armistice cities low, Pyro lawless high, Levski and Nyx medium, unknown systems unknown', () => {
  assert.equal(riskOf('Stanton', 'Admin - Lorville').level, 'low');
  assert.equal(riskOf('Stanton', 'Shepherd Outpost').level, 'med');
  assert.equal(riskOf('Pyro', 'Rustville').level, 'high');
  assert.equal(riskOf('Pyro', 'Checkmate Station').level, 'high');
  assert.equal(riskOf('Nyx', 'Levski').level, 'med');
  assert.equal(riskOf('Stanton', 'ARC-L1 Wide Forest Station').level, 'low');
  assert.equal(riskOf('Terra', 'Somewhere').level, 'unknown');
  assert.equal(worst(riskOf('Stanton', 'Lorville'), riskOf('Pyro', 'x')).level, 'high');
});

test('old rows are dropped and systems come in Stanton, Pyro, Nyx order', () => {
  const f = freshRows(rows, Date.now());
  assert.ok(!f.some((r) => r.commodity === 'Old'));
  assert.deepEqual(systemsIn(f), ['Stanton', 'Pyro', 'Nyx']);
});

test('bestRuns stays inside a system when asked, flags cross-system runs and can skip high-risk places', () => {
  const f = freshRows(rows);
  const all = bestRuns(f);
  assert.equal(all.find((r) => r.commodity === 'Hides').cross, true);
  assert.equal(all.find((r) => r.commodity === 'Hides').margin, 30);
  assert.deepEqual(bestRuns(f, { system: 'Stanton' }).map((r) => r.commodity), ['Agricium']);
  assert.deepEqual(bestRuns(f, { system: 'Pyro' }).map((r) => r.commodity), ['Beans']);
  assert.equal(bestRuns(f, { system: 'Pyro', avoidHigh: true }).length, 0);
  assert.equal(bestRuns(f, { q: 'agri' }).length, 1);
});

test('areaBoard ranks the areas of one system by the best run from or to them', () => {
  const f = freshRows(rows);
  const s = areaBoard(f, 'Stanton');
  assert.deepEqual(s.map((a) => a.name), ['Area 18', 'Lorville']);
  assert.equal(s[1].out[0].commodity, 'Agricium'); assert.equal(s[1].out[0].margin, 10);
  assert.equal(s[0].in[0].margin, 10);
  assert.equal(s[0].risk.level, 'low');
  const p = areaBoard(f, 'Pyro');
  assert.equal(p[0].risk.level, 'high');
  assert.deepEqual(areaBoard(f, 'Nyx').map((a) => a.name), ['Levski']);
});

test('areaBoard keeps the best run that leaves the system apart from the ranking', () => {
  const lev = areaBoard(freshRows(rows), 'Nyx')[0];
  assert.equal(lev.score, 0);
  assert.equal(lev.jump.otherSystem, 'Pyro'); assert.equal(lev.jump.margin, 30);
});
