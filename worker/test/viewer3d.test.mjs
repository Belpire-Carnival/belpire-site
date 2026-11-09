import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGlb, edgesOf, mul, orbit } from '../../site/bureau/rsi1/companion/viewer3d.js';
import { normalize, partsFor, SWATCHES } from '../../site/bureau/rsi1/companion/outfits.js';

const glb = (f) => { const b = readFileSync(new URL(`../../site/bureau/rsi1/companion/models/${f}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

test('both mannequins parse into the named parts', () => {
  for (const f of ['male.glb', 'female.glb']) {
    const p = parseGlb(glb(f));
    for (const n of ['Torso', 'Head', 'Neck', 'ArmL', 'ArmR', 'HandL', 'HandR', 'LegL', 'LegR', 'FootL', 'FootR']) assert.ok(p[n]?.pos.length > 0 && p[n].idx.length % 3 === 0, `${f} ${n}`);
    const e = edgesOf(p.Torso.idx);
    assert.ok(e.length > 0 && e.length % 2 === 0 && Math.max(...e) < p.Torso.pos.length / 3);
  }
  assert.throws(() => parseGlb(new ArrayBuffer(32)));
});

test('matrices compose', () => {
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.deepEqual(mul(I, orbit(0, 0, 3, [0, 0, 0])).map((x) => +x.toFixed(6)), orbit(0, 0, 3, [0, 0, 0]).map((x) => +x.toFixed(6)));
});

test('filled slots light the right parts and dyes stay in the swatch set', () => {
  assert.deepEqual(partsFor({ helmet: 'x', boots: 'y' }).sort(), ['FootL', 'FootR', 'Head', 'Neck']);
  const o = normalize({ sex: 'female', tints: { helmet: '#123456', core: SWATCHES[5][1] } });
  assert.equal(o.sex, 'female');
  assert.equal(o.tints.helmet, o.colors[2]);
  assert.ok(SWATCHES.some((s) => s[1] === o.tints.helmet));
  assert.equal(normalize({ sex: 'x' }).sex, 'male');
});
