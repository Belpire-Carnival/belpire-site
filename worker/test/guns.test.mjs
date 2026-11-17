import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGunSlots, slimShip } from '../sc-builder.js';

const turret = (name, size, extra = {}) => ({ name, type: 'Turret', editable: false, sizes: { min: size, max: size }, ports: [], ...extra });
const w = (...names) => names.map((name) => ({ name }));

test('Constellation Mk V: two S3 turret bases and four S5 guns', () => {
  const ports = [turret('hardpoint_turret_upper', 3), turret('hardpoint_turret_lower', 3), turret('hardpoint_gun_s5_body_right', 5), turret('hardpoint_gun_s5_body_left', 5), turret('hardpoint_gun_s5_front_right', 5), turret('hardpoint_gun_s5_front_left', 5)];
  const fixed = w(...Array(8).fill('CF-337 Panther Repeater'), ...Array(4).fill('CF-557 Galdereen Repeater'));
  const slots = runGunSlots(ports, fixed);
  assert.equal(slots.length, 12);
  assert.equal(slots.filter((x) => x.max === 5 && x.stockName === 'CF-557 Galdereen Repeater').length, 4);
  assert.equal(slots.filter((x) => x.max === 3 && x.stockName === 'CF-337 Panther Repeater').length, 8);
  assert.equal(new Set(slots.map((x) => x.id)).size, 12);
});

test('Apollo Medivac: one S3 base with two guns, two S4 gimbals', () => {
  const ports = [turret('hardpoint_turret', 3), turret('hardpoint_weapon_left', 4, { editable: true }), turret('hardpoint_weapon_right', 4, { editable: true })];
  const slots = runGunSlots(ports, w('Mantis GT-220 Gatling', 'Mantis GT-220 Gatling', 'CF-447 Rhino Repeater', 'CF-447 Rhino Repeater'));
  assert.deepEqual(slots.map((x) => [x.id, x.max, x.stockName]), [
    ['hardpoint_turret/mount_1', 3, 'Mantis GT-220 Gatling'], ['hardpoint_turret/mount_2', 3, 'Mantis GT-220 Gatling'],
    ['hardpoint_weapon_left', 4, 'CF-447 Rhino Repeater'], ['hardpoint_weapon_right', 4, 'CF-447 Rhino Repeater']]);
});

test('gives up (null) when runs and size groups do not line up', () => {
  const ports = [turret('a', 3), turret('b', 3), turret('c', 5)];
  assert.equal(runGunSlots(ports, w('X', 'X', 'X')), null);
  assert.equal(runGunSlots(ports, w('X', 'Y', 'Y', 'Y')), null);
  assert.equal(runGunSlots(ports, []), null);
});

test('the tractor beam mount is never a gun slot', () => {
  const ports = [turret('hardpoint_gun', 3), turret('hardpoint_tractor_turret', 4)];
  assert.equal(runGunSlots(ports, w('X'))?.length, 1);
});

test('slimShip uses the runs when pilot mounts cannot be named', () => {
  const gun = (name, size) => turret(name, size, { compatible_types: [{ type: 'WeaponGun' }] });
  const ship = { uuid: 'u1', name: 'Test', ports: [turret('base', 3), gun('left', 4), gun('right', 4)], weaponry: { fixed_weapons: { weapons: w('A', 'A', 'B', 'B') } } };
  const names = slimShip(ship).slots.filter((x) => x.type === 'WeaponGun').map((x) => x.stockName);
  assert.deepEqual(names, ['A', 'A', 'B', 'B']);
});
