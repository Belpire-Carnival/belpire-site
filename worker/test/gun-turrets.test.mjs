import test from 'node:test';
import assert from 'node:assert/strict';
import { slimShip, buildSnapshot, turretGunSlots, WEAPON_TYPE } from '../sc-builder.js';

const gunMount = (hp, size) => ({ hardpoint_name: hp, size, weapon_sizes: [size], payload_types: ['WeaponGun.Gun'], payload_sizes: [size] });

// Cyclone MT as the wiki lists it: one gun and two missile racks on one turret, one gun in the list.
test('a turret that also carries missile racks pairs its gun list with the gun mounts only', () => {
  const turrets = { manned: [{ hardpoint_name: 'hardpoint_module_attach', mounts: [
    gunMount('turret_weapon', 1),
    { hardpoint_name: 'hardpoint_missilerack_left', size: 3, payload_types: ['GroundVehicleMissileLauncher.GroundVehicleMissileRack'], payload_sizes: [3] },
    { hardpoint_name: 'hardpoint_missilerack_right', size: 3, payload_types: ['GroundVehicleMissileLauncher.GroundVehicleMissileRack'], payload_sizes: [3] }
  ], weapons: [{ name: '9-Series Longsword Cannon', uuid: 'ls9' }] }] };
  const out = turretGunSlots(turrets, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].stock, 'ls9');
});

// Constellation Taurus lower turret: one mount holds a tractor beam, the other a gun, and the wiki lists no guns.
test('an empty gun list leaves the slot without a stock gun instead of guessing', () => {
  const turrets = { manned: [{ hardpoint_name: 'hardpoint_turret_base_lower', mounts: [
    { hardpoint_name: 'hardpoint_weapon_left', size: 2, payload_types: ['TractorBeam.UNDEFINED'], payload_sizes: [2] },
    gunMount('hardpoint_weapon_right', 2)
  ], weapons: [] }] };
  const out = turretGunSlots(turrets, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].stock, null);
});

// Mauler Destroyer: sixteen point-defence turrets carry the game's placeholder instead of a gun.
test('placeholder guns do not become slots', () => {
  const turrets = { pdc: [{ hardpoint_name: 'hardpoint_pdc_top_001', mounts: [gunMount('hardpoint_turret_weapon', 1)], weapons: [{ name: '<= PLACEHOLDER =>', uuid: 'ph' }] }] };
  assert.deepEqual(turretGunSlots(turrets, []), []);
});

// HM6 Spartan: the remote turret is a childless Turret port and also a turrets-list entry with two real guns.
test('a turret described gun by gun is not also counted as a pilot mount', () => {
  const v = {
    uuid: 'sp', name: 'HM6 Spartan', is_vehicle: true,
    ports: [{ name: 'hardpoint_turret', type: 'Turret', editable: false, sizes: { min: 4, max: 4 }, ports: [], compatible_types: [{ type: WEAPON_TYPE }] }],
    turrets: { remote: [{ hardpoint_name: 'hardpoint_turret', mounts: [gunMount('hardpoint_gunmount_left', 2), gunMount('hardpoint_gunmount_right', 2)], weapons: [{ name: 'Scorpion GT-215 Gatling', uuid: 'sc1' }, { name: 'Scorpion GT-215 Gatling', uuid: 'sc1' }] }] }
  };
  const s = slimShip(v);
  const guns = s.slots.filter((x) => x.type === WEAPON_TYPE);
  assert.equal(guns.length, 2);
  assert.ok(guns.every((x) => x.stock === 'sc1'));
});

// A turret gun whose uuid is not in the part list still resolves by its name.
test('buildSnapshot falls back to the gun name when the uuid is unknown', () => {
  const ship = { id: 's', name: 'T', slots: [{ id: 'a/b', type: WEAPON_TYPE, min: 5, max: 5, stock: 'missing-uuid', group: 'a', stockName: 'CF-557 Galdereen Repeater' }] };
  const snap = buildSnapshot('t', [ship], [{ id: 'g', name: 'CF-557 Galdereen Repeater', type: WEAPON_TYPE, size: 5 }], []);
  assert.equal(snap.ships[0].slots[0].stock, 'g');
});

test('a known uuid is kept as is', () => {
  const ship = { id: 's', name: 'T', slots: [{ id: 'a/b', type: WEAPON_TYPE, min: 5, max: 5, stock: 'g1', group: 'a', stockName: 'Other' }] };
  const snap = buildSnapshot('t', [ship], [{ id: 'g1', name: 'Real', type: WEAPON_TYPE, size: 5 }], []);
  assert.equal(snap.ships[0].slots[0].stock, 'g1');
});
