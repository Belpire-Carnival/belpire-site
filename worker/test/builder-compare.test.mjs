import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { columnsFor, compareCol, isBuyable, detailGroupsVs, signedVal } from '../../site/bureau/rsi1/companion/builder-core.js';

const gun = (id, burst, price, size = 3) => ({ id, name: id, type: 'WeaponGun', size, pw: 2, wpn: { burst }, buy: price == null ? [] : [{ p: price, at: 'X' }], x: { 'durability.health': burst } });
const col = (type, id) => columnsFor(type).find((c) => c.id === id);

test('higher-is-better columns turn green when up and red when down', () => {
  const ref = gun('a', 1000, 100);
  assert.equal(compareCol(col('WeaponGun', 'burst'), gun('b', 1200, 100), ref).cls, 'better');
  assert.equal(compareCol(col('WeaponGun', 'burst'), gun('c', 900, 100), ref).cls, 'worse');
  assert.equal(compareCol(col('WeaponGun', 'burst'), gun('b', 1200, 100), ref).text, '+200');
});

test('lower-is-better columns (price, power draw) turn green when down', () => {
  const ref = gun('a', 1000, 500);
  assert.equal(compareCol(col('WeaponGun', 'price'), gun('b', 1000, 300), ref).cls, 'better');
  assert.equal(compareCol(col('WeaponGun', 'price'), gun('c', 1000, 800), ref).cls, 'worse');
});

test('size has no better direction: the difference shows but never green or red', () => {
  const ref = gun('a', 1000, 100, 3);
  const r = compareCol(col('WeaponGun', 'size'), gun('b', 1000, 100, 4), ref);
  assert.equal(r.cls, '');
  assert.equal(r.text, '+1');
});

test('nothing to compare: same part, missing figure, equal figure', () => {
  const ref = gun('a', 1000, 100);
  assert.equal(compareCol(col('WeaponGun', 'burst'), ref, ref), null);
  assert.equal(compareCol(col('WeaponGun', 'price'), gun('b', 1000, null), ref), null);
  assert.deepEqual(compareCol(col('WeaponGun', 'burst'), gun('b', 1000, 100), ref), { delta: 0, cls: '', text: '' });
  assert.equal(compareCol(col('WeaponGun', 'burst'), gun('b', 1000, 100), null), null);
});

test('isBuyable is true only when a shop is known', () => {
  assert.equal(isBuyable(gun('a', 1, 100)), true);
  assert.equal(isBuyable(gun('a', 1, null)), false);
  assert.equal(isBuyable({ id: 'z' }), false);
  assert.equal(isBuyable(null), false);
});

test('data sheet rows carry the difference from the fitted part when both have a number', () => {
  const rows = detailGroupsVs(gun('b', 1250, 1), gun('a', 1000, 1)).flatMap((g) => g.rows);
  assert.deepEqual(rows, [['health', '1,250', '+250']]);
  assert.equal(detailGroupsVs(gun('b', 1250, 1), null)[0].rows[0][2], '');
  assert.equal(signedVal(-4.4), '−4.4');
});

test('the swap pop-up locks the page, filters by shop and compares with the fitted part', () => {
  const src = readFileSync(new URL('../../site/bureau/rsi1/companion/builder-holo.js', import.meta.url), 'utf8');
  for (const needle of ["'holo-open'", 'isBuyable', 'compareCol', 'Buyable in game', 'No shop known']) assert.ok(src.includes(needle), needle);
  const css = readFileSync(new URL('../../site/bureau/rsi1/companion/companion.css', import.meta.url), 'utf8');
  assert.ok(css.includes('html.holo-open'));
});
