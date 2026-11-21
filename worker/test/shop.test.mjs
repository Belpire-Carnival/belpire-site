import test from 'node:test';
import assert from 'node:assert/strict';
import { shopMap, norm } from '../sc-shop.js';

const vehicles = [{ id: 52, name: 'Cutlass Black', name_full: 'Drake Cutlass Black' }, { id: 7, name: 'Mole', name_full: 'Argo Mole' }];
const buys = [
  { id_vehicle: 52, price_buy: 1800000, terminal_name: 'Astro Armada - Area 18', city_name: 'Area 18', planet_name: 'ArcCorp', star_system_name: 'Stanton', date_modified: 1791663553 },
  { id_vehicle: 52, price_buy: 1600000, terminal_name: 'Teach\'s Ship Shop - Lorville', city_name: 'Lorville', planet_name: 'Hurston', star_system_name: 'Stanton', date_modified: 1791663553 },
  { id_vehicle: 52, price_buy: 1600000, terminal_name: 'Teach\'s Ship Shop - Lorville', city_name: 'Lorville' },
  { id_vehicle: 99, price_buy: 5, terminal_name: 'x' }, { id_vehicle: 7, price_buy: 0, terminal_name: 'y' }
];
const rents = [{ id_vehicle: 52, price_rent: 37485, terminal_name: 'Regal Luxury Rentals - New Babbage', city_name: 'New Babbage', planet_name: 'MicroTech', star_system_name: 'Stanton' }];

test('shop map: joins by name, cheapest first, one row per terminal', () => {
  const m = shopMap(vehicles, buys, rents);
  const e = m[norm('Cutlass Black')];
  assert.deepEqual(e.buy.map((r) => r.p), [1600000, 1800000]);
  assert.equal(e.buy[0].where, 'Lorville');
  assert.equal(e.rent[0].p, 37485);
  assert.equal(e.rent[0].near, 'MicroTech');
  assert.ok(m[norm('Drake Cutlass Black')]);
});
test('shop map: unknown ships and zero prices are dropped', () => {
  const m = shopMap(vehicles, buys, rents);
  assert.equal(m[norm('Mole')], undefined);
  assert.deepEqual(shopMap(null, null, null), {});
});
