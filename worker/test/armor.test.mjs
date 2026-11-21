import test from 'node:test';
import assert from 'node:assert/strict';
import { armorClasses } from '../sc-armor.js';
import { weaponStats } from '../sc-img.js';

test('armorClasses takes the middle torso multipliers per class', () => {
  const mk = (sub_type, p, e) => ({ sub_type, suit_armor: { damage_resistance_map: { physical: p, energy: e } } });
  const c = armorClasses([mk('Light', 0.8, 0.8), mk('Light', 0.7, 0.8), mk('Light', 0.8, 0.8), mk('Heavy', 0.6, 0.6), mk('Heavy', 0.6, 0.6), { sub_type: 'Medium' }, mk('Odd', 0.1, 0.1)]);
  assert.deepEqual(c, { Light: { phys: 0.8, energy: 0.8, n: 3 }, Heavy: { phys: 0.6, energy: 0.6, n: 2 } });
  assert.deepEqual(armorClasses(null), {});
});

test('weaponStats borrows another mode\'s RPM when the default mode has none', () => {
  const w = weaponStats({ personal_weapon: { capacity: 80, fire_mode: 'Beam', damages: [{ name: 'energy', damage: 13 }], modes: [{ mode: 'Beam', type: 'beam' }, { mode: 'Rapid', type: 'rapid', rpm: 600 }] } });
  assert.equal(w.rpm, 600); assert.equal(w.rpmFrom, 'Rapid');
});
