import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findSellPlace, placeLabel } from '../../site/bureau/rsi1/companion/market.js';

const r = (terminal, system, place, sell) => ({ commodity: 'Recycled Material Composite', terminal, system, place, sell, buy: null, at: null });
const sells = [
  r('Seer\'s Canyon', 'Pyro', 'Seer\'s Canyon', 8500), r('Patch City', 'Pyro', 'Patch City', 7700),
  r('TDD - Cloudview Center, Orison', 'Stanton', 'Orison', 7100), r('CBD - Lorville', 'Stanton', 'Lorville', 6800),
  r('TDD - Lorville', 'Stanton', 'Lorville', 6500), r('Dead', 'Stanton', 'Nowhere', 0),
];

test('sell at: an exact terminal or "terminal · system" label is found', () => {
  assert.equal(findSellPlace(sells, 'Patch City').row.terminal, 'Patch City');
  assert.equal(findSellPlace(sells, placeLabel(sells[2])).row.terminal, 'TDD - Cloudview Center, Orison');
  assert.equal(findSellPlace(sells, 'patch city').exact, true);
});
test('sell at: a place or system name matches several terminals and the best payer wins', () => {
  const lorville = findSellPlace(sells, 'Lorville');
  assert.equal(lorville.row.terminal, 'CBD - Lorville'); assert.equal(lorville.matches, 2); assert.equal(lorville.exact, true); // the place name is an exact match for both Lorville terminals
  assert.equal(findSellPlace(sells, 'pyro').row.sell, 8500); assert.equal(findSellPlace(sells, 'pyro').exact, false);
  assert.equal(findSellPlace(sells, 'cloudview orison').row.sell, 7100);
});
test('sell at: nothing found for an unknown place, empty text or a terminal that pays nothing', () => {
  assert.equal(findSellPlace(sells, 'Atlantis'), null);
  assert.equal(findSellPlace(sells, '   '), null);
  assert.equal(findSellPlace(sells, 'Dead'), null);
  assert.equal(findSellPlace(null, 'Lorville'), null);
});
test('the page wires Sell at into Salvage and Mining without inline styles or innerHTML', () => {
  const app = readFileSync(new URL('../../site/bureau/rsi1/companion/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../site/bureau/rsi1/companion/index.html', import.meta.url), 'utf8');
  assert.match(app, /M\.findSellPlace\(all, text\)/); assert.match(app, /M\.findSellPlace\(sellsOf\(\), L\.at\)/); assert.match(app, /M\.findSellPlace\(c\.sells, L\.at\)/);
  assert.match(app, /'rmcAt'/); assert.match(app, /'cmAt'/);
  assert.match(html, /<th>Sell at<\/th>/);
  assert.equal((app.match(/innerHTML/g) || []).length, 1);
});
