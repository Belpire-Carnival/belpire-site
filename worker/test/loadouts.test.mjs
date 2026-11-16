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

import { encodeOutfit, decodeOutfit, wardrobeFile, parseWardrobe, mergeWardrobe } from '../../site/bureau/rsi1/companion/outfits.js';

test('share codes round-trip the look and drop identity, worn flag and loadout link', () => {
  const o = outfit({ id: 'keep', name: 'Nuit ✦ Ops', style: 'Stealth', sex: 'female', worn: true, loadout: 'L1', pieces: { helmet: 'Hood', boots: 'Boots' }, tints: { helmet: '#27415f' }, notes: 'dye: navy' });
  const code = encodeOutfit(o);
  assert.match(code, /^SCW1\.[A-Za-z0-9_-]+$/);
  const back = decodeOutfit(`  ${code.slice(0, 20)}\n${code.slice(20)} `);
  assert.equal(back.name, 'Nuit ✦ Ops'); assert.equal(back.sex, 'female'); assert.equal(back.style, 'Stealth');
  assert.equal(back.pieces.helmet, 'Hood'); assert.equal(back.tints.helmet, '#27415f'); assert.equal(back.notes, 'dye: navy');
  assert.notEqual(back.id, 'keep'); assert.equal(back.worn, false); assert.equal(back.loadout, '');
});

test('bad share codes are rejected, not trusted', () => {
  for (const bad of ['', 'hello', 'SCW1.', 'SCW1.@@@', `SCW1.${'A'.repeat(20000)}`, 'SCW2.e30']) assert.equal(decodeOutfit(bad), null, bad.slice(0, 12));
  const evil = 'SCW1.' + btoa(JSON.stringify({ n: '<img src=x onerror=1>', t: { helmet: 'url(javascript:1)' }, i: { helmet: '../../etc/passwd' }, p: { helmet: 'H' } })).replace(/=+$/, '');
  const o = decodeOutfit(evil);
  assert.equal(o.imgs.helmet, ''); assert.ok(SWATCHES.some((s) => s[1] === o.tints.helmet));
});

test('wardrobe file parses, rejects other files, and merges without a second worn outfit', () => {
  const a = outfit({ id: 'a', name: 'A', worn: true, at: 1 }), b = outfit({ id: 'b', name: 'B', worn: true, at: 2 });
  const file = wardrobeFile([a, b]);
  assert.equal(parseWardrobe(file).length, 2);
  assert.equal(parseWardrobe(JSON.stringify([{ name: 'bare' }])).length, 1);
  for (const bad of ['', 'nope', '{"app":"other","outfits":[]}', '{"app":"belpire-wardrobe"}', 'x'.repeat(1_600_000)]) assert.equal(parseWardrobe(bad), null);
  const merged = mergeWardrobe([a], [b, outfit({ id: 'a', name: 'A2', worn: true, at: 5 })]);
  assert.equal(merged.length, 2); assert.equal(merged.find((x) => x.id === 'a').name, 'A2');
  assert.equal(merged.filter((x) => x.worn).length, 1);
});
