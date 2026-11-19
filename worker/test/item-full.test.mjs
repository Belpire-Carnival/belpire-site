import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slimItem } from '../sc-img.js';

test('full item records carry shop prices and recorded stats, plain ones do not', () => {
  const it = { uuid: 'u1', name: 'Test Rifle', type: 'WeaponPersonal', vehicle_weapon: { damage_per_second: 120.5 },
    uex_prices: { purchase: [{ price_buy: 900, terminal_name: 'Shop A', starmap_location: { name: 'Lorville', star_system_name: 'Stanton' } }, { price_buy: 0 }] } };
  const plain = slimItem(it);
  assert.equal(plain.buy, undefined);
  const full = slimItem(it, true);
  assert.equal(full.buy.length, 1);
  assert.equal(full.buy[0].p, 900);
  assert.equal(full.buy[0].where, 'Lorville');
  assert.equal(full.detail['vehicle_weapon.damage_per_second'], 120.5);
});
