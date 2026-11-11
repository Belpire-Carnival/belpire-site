import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, applyScan, addOwned, removeOwned, listOwned, categoriesOf, staleDays, staleLabel, addWish, patchWish, removeWish, sortWish, cleanBp, betterTier, cleanWishlist } from '../../site/bureau/rsi1/companion/plan-core.js';

const T0 = Date.UTC(2026, 10, 10);

test('names are matched ignoring case and punctuation', () => { assert.equal(keyOf('  Gallant™  Rifle! '), 'gallant rifle'); });

test('a scan adds owned blueprints, skips locked rows and keeps the better tier', () => {
  const a = applyScan(cleanBp(null), [{ name: 'Gallant Rifle', category: 'Weapons', tier: 'Q2', owned: true }, { name: 'Locked Gun', category: 'Weapons', owned: false }, { name: 'Pyro Helmet', category: 'Armor', tier: null, owned: null }], { now: T0 });
  assert.equal(a.added, 2); assert.equal(Object.keys(a.state.owned).length, 2);
  assert.equal(a.state.owned['locked gun'], undefined);
  const b = applyScan(a.state, [{ name: 'Gallant Rifle', category: 'Weapons', tier: 'Q1', owned: true }], { now: T0 + 1000 });
  assert.equal(b.state.owned['gallant rifle'].tier, 'Q2');
  assert.equal(b.kept, 1);
  assert.equal(betterTier('Q1', 'Q4'), 'Q4'); assert.equal(betterTier(null, 'A'), 'A');
});

test('a re-scan replaces only the categories it covers', () => {
  let s = applyScan(cleanBp(null), [{ name: 'A', category: 'Weapons' }, { name: 'B', category: 'Weapons' }, { name: 'H', category: 'Armor' }], { now: T0 }).state;
  s = applyScan(s, [{ name: 'A', category: 'Weapons' }], { now: T0 + 5 }).state;
  assert.deepEqual(Object.keys(s.owned).sort(), ['a', 'h']);
  s = applyScan(s, [{ name: 'B', category: 'Weapons' }], { replace: false, now: T0 + 6 }).state;
  assert.deepEqual(Object.keys(s.owned).sort(), ['a', 'b', 'h']);
});

test('manual add, remove, filter and categories', () => {
  let s = addOwned(cleanBp(null), 'Gallant Rifle', 'Weapons', T0);
  s = addOwned(s, 'Pyro Helmet', 'Armor', T0);
  assert.deepEqual(categoriesOf(s), ['Armor', 'Weapons']);
  assert.equal(listOwned(s, { q: 'rifle' }).length, 1);
  assert.equal(listOwned(s, { category: 'armor' })[0].name, 'Pyro Helmet');
  assert.equal(Object.keys(removeOwned(s, 'pyro helmet').owned).length, 1);
  assert.equal(Object.keys(addOwned(s, '   ').owned).length, 2);
});

test('stale label says how old the import is', () => {
  assert.equal(staleDays(null), null); assert.equal(staleLabel(null), 'never imported');
  assert.equal(staleLabel(T0, T0 + 3600e3), 'imported today');
  assert.equal(staleLabel(T0, T0 + 86400e3), 'imported yesterday');
  assert.equal(staleLabel(T0, T0 + 9 * 86400e3), 'imported 9 days ago');
});

test('wishlist: add without duplicates, edit, sort and remove', () => {
  let w = addWish([], { kind: 'Ship', name: 'Carrack', prio: 1 }, T0);
  w = addWish(w, { kind: 'Ship', name: 'carrack' }, T0 + 1);
  w = addWish(w, { kind: 'Weapon', name: 'Railgun', prio: 3 }, T0 + 2);
  w = addWish(w, { kind: 'bogus', name: 'Thing' }, T0 + 3);
  assert.equal(w.length, 3); assert.equal(w[2].kind, 'Other'); assert.equal(w[2].prio, 2);
  const id = w[0].id;
  w = patchWish(w, id, { got: true });
  assert.equal(sortWish(w)[2].name, 'Carrack');
  assert.equal(sortWish(w)[0].name, 'Thing');
  assert.equal(removeWish(w, id).length, 2);
  assert.deepEqual(cleanWishlist([{ name: '' }, null, 5]), []);
});

import { readFileSync } from 'node:fs';
test('the plan pane builds its page from text nodes and talks to nobody', () => {
  const ui = readFileSync(new URL('../../site/bureau/rsi1/companion/plan-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|\.style\.|fetch\(|XMLHttpRequest|eval\(|https?:\/\//);
  assert.match(ui, /arsenal\.plan\.bp/); assert.match(ui, /arsenal\.plan\.wish/);
});
