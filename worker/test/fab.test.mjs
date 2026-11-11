import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiplier, qualityFor, pct, verdict, clampQuality, materialList, statRows, isLinear } from '../../site/bureau/rsi1/companion/fab-core.js';

// From the API: Frame -> Integrity x0.90 at quality 0 to x1.10 at 1000.
const integrity = { key: 'health_maxhealth', label: 'Integrity', better: 'higher', qmin: 0, qmax: 1000, lo: 0.9, hi: 1.1, curve: 'linear', segs: null };
const heat = { key: 'heat', label: 'Heat', better: 'lower', qmin: 0, qmax: 1000, lo: 0.8, hi: 1.2, curve: 'linear', segs: null };

test('a linear modifier runs between its low and high multiplier across the quality range', () => {
  assert.equal(multiplier(integrity, 0), 0.9);
  assert.equal(multiplier(integrity, 1000), 1.1);
  assert.ok(Math.abs(multiplier(integrity, 500) - 1) < 1e-9);
  assert.equal(multiplier(integrity, 5000), 1.1); // beyond the range holds at the end
  assert.equal(multiplier({ ...integrity, curve: 'segmented' }, 500), null);
  assert.equal(multiplier(integrity, NaN), null);
  assert.equal(isLinear({ ...integrity, qmax: 0 }), false);
});

test('the quality needed for a wanted multiplier is the inverse, or null out of range', () => {
  assert.equal(qualityFor(integrity, 1.1), 1000);
  assert.equal(qualityFor(integrity, 1.0), 500);
  assert.equal(qualityFor(integrity, 1.05), 750);
  assert.equal(qualityFor(integrity, 1.2), null);
  assert.equal(qualityFor(integrity, 0.8), null);
  assert.equal(qualityFor({ ...integrity, lo: 1, hi: 1 }, 1), null);
});

test('labels and colours follow which direction is better', () => {
  assert.equal(pct(1.1), '+10.0%'); assert.equal(pct(0.95), '-5.0%'); assert.equal(pct(1), '+0.0%'); assert.equal(pct(null), '—');
  assert.equal(verdict(integrity, 1.1), 'good'); assert.equal(verdict(integrity, 0.9), 'bad'); assert.equal(verdict(integrity, 1), 'flat');
  assert.equal(verdict(heat, 1.2), 'bad'); assert.equal(verdict(heat, 0.8), 'good');
  assert.equal(clampQuality(0), 1); assert.equal(clampQuality(2000), 1000); assert.equal(clampQuality('x'), 500);
});

const groups = [
  { key: 'FRAME', name: 'Frame', need: 1, mods: [integrity], kids: [{ kind: 'resource', name: 'Agricium', scu: 0.36, qty: null, minq: 1 }] },
  { key: 'EMITTER', name: 'Emitter', need: 1, mods: [{ ...heat, key: 'w', label: 'Impact Force', better: 'higher', lo: 0.95, hi: 1.05 }, { ...integrity, curve: 'segmented' }], kids: [{ kind: 'item', name: 'Hadanite', scu: null, qty: 7, minq: 1 }, { kind: 'item', name: 'Dolivine', scu: null, qty: 7, minq: 1 }] }
];
test('materials scale with the number of crafts and follow the picked option', () => {
  assert.deepEqual(materialList(groups, {}, 3).map((m) => [m.name, m.scu, m.qty]), [['Agricium', 1.08, null], ['Hadanite', null, 21]]);
  assert.equal(materialList(groups, { EMITTER: 1 }, 1)[1].name, 'Dolivine');
  assert.equal(materialList(groups, { EMITTER: 9 }, 1)[1].name, 'Dolivine'); // out-of-range pick holds at the last option
  assert.equal(materialList(groups, {}, 0)[0].scu, 0.36);
  assert.deepEqual(materialList(null), []);
});

test('stat rows show each modifier at its slot quality and flag curves that are not modelled', () => {
  const rows = statRows(groups, { FRAME: 1000, EMITTER: 0 });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].mult, 1.1);
  assert.equal(rows[1].mult, 0.95);
  assert.equal(rows[2].modelled, false); assert.equal(rows[2].mult, null);
  assert.equal(statRows(groups, {})[0].q, 500);
});
