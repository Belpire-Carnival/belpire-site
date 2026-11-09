import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, gaps, briefing, MISSIONS } from '../../site/bureau/rsi1/companion/loadouts.js';
import { normalize as outfit, SWATCHES, PIECES } from '../../site/bureau/rsi1/companion/outfits.js';

const read = (f) => readFileSync(new URL(`../../site/bureau/rsi1/companion/${f}`, import.meta.url), 'utf8');

test('loadout normalize trims, bounds and defaults', () => {
  const l = normalize({ name: '  Bunker   clear ', mission: 'Nope', threat: 'Extreme', slots: { helmet: 'Pembroke', evil: 'x' }, supplies: { medpens: -4, medgel: '2.9', ammoPrimary: 'abc' } });
  assert.equal(l.name, 'Bunker clear'); assert.equal(l.mission, 'Other'); assert.equal(l.threat, 'Medium');
  assert.equal(l.slots.helmet, 'Pembroke'); assert.equal('evil' in l.slots, false);
  assert.equal(l.supplies.medpens, 0); assert.equal(l.supplies.medgel, 2); assert.equal(l.supplies.ammoPrimary, 0);
  assert.ok(MISSIONS.includes(l.mission));
});

test('gaps flags empty key slots and low supplies; briefing lists filled slots', () => {
  const l = normalize({ name: 'CZ', mission: 'Contested Zone', slots: { primary: 'P4-AR', helmet: 'H', core: 'C', sidearm: 'S' }, supplies: { medpens: 5, medgel: 3, oxypens: 1, ammoPrimary: 6, ammoSidearm: 4 } });
  assert.deepEqual(gaps(l), []);
  assert.match(gaps(normalize({})).join('|'), /Helmet is empty.*Medpens: 0/);
  const b = briefing(l);
  assert.match(b, /\*\*CZ\*\* · Contested Zone/); assert.match(b, /Primary: P4-AR/); assert.match(b, /Medpens 5/); assert.doesNotMatch(b, /Legs:/);
});

test('outfit colours are limited to the swatch set', () => {
  const o = outfit({ name: 'Night', style: 'Stealth', colors: ['#3a3f45', 'javascript:1', '<x>'], pieces: { helmet: 'Hood', zzz: 'q' }, worn: 1 });
  assert.equal(o.colors[0], '#3a3f45');
  for (const c of o.colors) assert.ok(SWATCHES.some((s) => s[1] === c));
  assert.equal(o.pieces.helmet, 'Hood'); assert.equal('zzz' in o.pieces, false); assert.equal(o.worn, true);
  assert.equal(Object.keys(o.pieces).length, PIECES.length);
});

test('new modules follow the page rules', () => {
  const src = read('loadouts.js') + read('outfits.js');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|eval\(|new Function|setAttribute\(\s*['"]style['"]|\.style\.|fetch\(|https?:\/\//);
  assert.match(read('index.html'), /id="groundLoadouts"/); assert.match(read('index.html'), /id="wardrobe"/);
});
