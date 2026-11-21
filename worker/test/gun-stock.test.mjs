import test from 'node:test';
import assert from 'node:assert/strict';
import { slimShip, buildSnapshot, gunByName, nameLeftoverGuns, collectSlots, stockParts, WEAPON_TYPE } from '../sc-builder.js';

const gun = (id, name, size) => ({ id, name, type: WEAPON_TYPE, size });
const port = (name, type, o = {}) => ({ name, type, editable: false, sizes: { min: o.min ?? o.max ?? 1, max: o.max ?? 1 }, ports: [], ...o });
const item = (uuid, name, size) => ({ uuid, name, size, type: WEAPON_TYPE, class: 'Ship' });

test('gunByName: a gun inside the slot range wins', () => {
  const guns = [gun('a', 'Badger', 1), gun('b', 'Badger', 2)];
  assert.equal(gunByName(guns, 'Badger', { min: 2, max: 2 }).id, 'b');
});

test('gunByName: the wiki lists the mount size, so a unique name still resolves outside the range', () => {
  const guns = [gun('m5', 'M5A Cannon', 3)];
  assert.equal(gunByName(guns, 'M5A Cannon', { min: 5, max: 5 }).id, 'm5'); // gimbal S5, gun S3
  assert.equal(gunByName(guns, 'M5A Cannon', { min: 1, max: 1 }).id, 'm5'); // mount listed smaller than the gun
});

test('gunByName: a name shared by different sizes is not guessed', () => {
  const guns = [gun('a', 'Revenant Gatling', 3), gun('b', 'Revenant Gatling', 4), gun('c', 'Revenant Gatling', 6)];
  assert.equal(gunByName(guns, 'Revenant Gatling', { min: 5, max: 5 }), null);
  assert.equal(gunByName(guns, 'Revenant Gatling', { min: 4, max: 4 }).id, 'b');
});

test('gunByName: unknown name', () => {
  assert.equal(gunByName([gun('a', 'X', 1)], 'Y', { min: 1, max: 1 }), null);
});

test('nameLeftoverGuns: one model, as many guns left as open slots', () => {
  const slots = [
    { id: 'l', type: WEAPON_TYPE, min: 1, max: 1, stock: null },
    { id: 'r', type: WEAPON_TYPE, min: 1, max: 1, stock: null },
    { id: 'sh', type: 'Shield', min: 1, max: 1, stock: 'x' }
  ];
  nameLeftoverGuns(slots, [{ name: 'CF-227 Badger Repeater' }, { name: 'CF-227 Badger Repeater' }]);
  assert.equal(slots[0].stockName, 'CF-227 Badger Repeater');
  assert.equal(slots[1].stockName, 'CF-227 Badger Repeater');
  assert.equal(slots[2].stockName, undefined);
});

test('nameLeftoverGuns: fewer guns than slots, or mixed models, stay unnamed', () => {
  const mk = () => [{ id: 'a', type: WEAPON_TYPE, min: 1, max: 1, stock: null }, { id: 'b', type: WEAPON_TYPE, min: 1, max: 1, stock: null }, { id: 'c', type: WEAPON_TYPE, min: 1, max: 1, stock: null }, { id: 'd', type: WEAPON_TYPE, min: 1, max: 1, stock: null }];
  const few = mk(); nameLeftoverGuns(few, [{ name: 'Bulldog' }, { name: 'Bulldog' }]); // Aurora: 4 mounts, 2 guns listed
  assert.ok(few.every((s) => !s.stockName));
  const mixed = mk(); nameLeftoverGuns(mixed, [{ name: 'A' }, { name: 'A' }, { name: 'B' }, { name: 'B' }]);
  assert.ok(mixed.every((s) => !s.stockName));
});

test('nameLeftoverGuns: guns already given to named slots are not handed out twice', () => {
  const slots = [
    { id: 'a', type: WEAPON_TYPE, min: 3, max: 3, stock: null, stockName: 'Mk3' },
    { id: 'b', type: WEAPON_TYPE, min: 3, max: 3, stock: null }
  ];
  nameLeftoverGuns(slots, [{ name: 'Mk3' }, { name: 'Badger' }]);
  assert.equal(slots[1].stockName, 'Badger');
});

// Ares Star Fighter Ion, as the wiki lists it: the ion cannon is a fixed WeaponGun port, not an editable one.
const ares = () => ({
  uuid: 'ares', name: 'Ares Star Fighter Ion', is_spaceship: true,
  weaponry: { fixed_weapons: { weapons: [{ name: 'SF7E Cannon' }] } },
  ports: [
    port('hardpoint_weapon_s7', WEAPON_TYPE, { max: 7, equipped_item_uuid: 'sf7e', equipped_item: item('sf7e', 'SF7E Cannon', 7) }),
    port('hardpoint_shield_generator_A', 'Shield', { max: 2, editable: true, equipped_item_uuid: 'sh1', equipped_item: { uuid: 'sh1', name: 'FullStop', size: 2, type: 'Shield' } })
  ]
});

test('a gun bolted to the hull becomes a locked gun slot with its stock part', () => {
  const s = slimShip(ares());
  const g = s.slots.find((x) => x.type === WEAPON_TYPE);
  assert.ok(g, 'the Ares has a gun slot');
  assert.equal(g.locked, true);
  assert.equal(g.stock, 'sf7e');
  const stock = stockParts(ares().ports, new Map());
  assert.ok(stock.has('sf7e'), 'the stock gun is kept even when the catalogue lacks it');
});

test('a gun inside a hardware-locked mount is listed as a fixed gun, not a swappable one', () => {
  const slots = collectSlots([port('turret', 'TurretBase', { max: 5, ports: [port('gun', WEAPON_TYPE, { max: 3, equipped_item_uuid: 'g1', equipped_item: item('g1', 'Gun', 3) })] })]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].locked, true);
  assert.equal(slots[0].stock, 'g1');
});

test('an editable gun port is still swappable (not locked)', () => {
  const slots = collectSlots([port('hp', WEAPON_TYPE, { max: 3, editable: true, equipped_item_uuid: 'g1', equipped_item: item('g1', 'Gun', 3) })]);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].locked, undefined);
});

// Freelancer-style: gimbal listed as S5, gun is an S3 M5A. Stock must resolve, and not be left as Unknown.
test('buildSnapshot resolves a stock gun whose size differs from its mount', () => {
  const ship = { id: 's', name: 'Test', slots: [{ id: 'g', type: WEAPON_TYPE, min: 5, max: 5, stock: null, group: '', stockName: 'M5A Cannon' }] };
  const snap = buildSnapshot('t', [ship], [gun('m5', 'M5A Cannon', 3)], []);
  assert.equal(snap.ships[0].slots[0].stock, 'm5');
  assert.equal(snap.ships[0].slots[0].stockName, undefined);
});

test('buildSnapshot keeps an ambiguous name unknown rather than guessing', () => {
  const ship = { id: 's', name: 'Test', slots: [{ id: 'g', type: WEAPON_TYPE, min: 5, max: 5, stock: null, group: '', stockName: 'Revenant Gatling' }] };
  const snap = buildSnapshot('t', [ship], [gun('a', 'Revenant Gatling', 3), gun('b', 'Revenant Gatling', 4)], []);
  assert.equal(snap.ships[0].slots[0].stock, null);
});

test('a ship with only a bolted gun is kept (it has a slot now)', () => {
  const s = slimShip(ares());
  const snap = buildSnapshot('t', [s], [], [...stockParts(ares().ports).values()]);
  assert.equal(snap.ships.length, 1);
  assert.equal(snap.ships[0].slots.find((x) => x.type === WEAPON_TYPE).stock, 'sf7e');
});
