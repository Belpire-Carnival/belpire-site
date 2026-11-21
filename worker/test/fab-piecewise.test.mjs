import { test } from 'node:test';
import assert from 'node:assert/strict';
import { multiplier, qualityFor, statRows, isLinear, isModelled } from '../../site/bureau/rsi1/companion/fab-core.js';

const pw = { curve: 'piecewise', qmin: 0, qmax: 1000, lo: 0.8, hi: 1.2, better: 'higher', ranges: [{ q0: 0, q1: 500, m0: 0.8, m1: 1 }, { q0: 501, q1: 1000, m0: 1, m1: 1.2 }] };

test('piecewise curves are modelled, segment by segment', () => {
  assert.equal(isLinear(pw), false); assert.equal(isModelled(pw), true);
  assert.equal(multiplier(pw, 0), 0.8); assert.equal(multiplier(pw, 250), 0.9); assert.equal(multiplier(pw, 500), 1);
  assert.equal(multiplier(pw, 1000), 1.2); assert.equal(multiplier(pw, 2000), 1.2); assert.equal(multiplier(pw, -5), 0.8);
  assert.ok(Math.abs(multiplier(pw, 750.5) - 1.1) < 0.001);
});
test('quality needed for a target works across segments and refuses out-of-range targets', () => {
  assert.equal(qualityFor(pw, 0.9), 250); assert.equal(qualityFor(pw, 1.2), 1000); assert.equal(qualityFor(pw, 0.5), null); assert.equal(qualityFor(pw, 1.5), null);
});
test('linear behaviour is unchanged, other curves are still not modelled', () => {
  const lin = { curve: 'linear', qmin: 0, qmax: 1000, lo: 0.9, hi: 1.1 };
  assert.equal(multiplier(lin, 500), 1); assert.equal(isModelled(lin), true);
  assert.equal(isModelled({ ...lin, curve: 'bezier' }), false); assert.equal(multiplier({ ...lin, curve: 'bezier' }, 5), null);
  assert.equal(isModelled({ curve: 'piecewise', ranges: [] }), false);
  const rows = statRows([{ key: 's0', name: 'Frame', mods: [pw] }], { s0: 750 });
  assert.equal(rows[0].modelled, true); assert.ok(rows[0].mult > 1);
});
