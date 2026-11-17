import test from 'node:test';
import assert from 'node:assert/strict';
import { slimShip, buildSnapshot, needsDetail, stepWork, collectSlots, WEAPON_TYPE } from '../sc-builder.js';

const part = (uuid, name, size, type = WEAPON_TYPE) => ({ uuid, name, size, type, class: 'Ship' });
const port = (name, type, o = {}) => ({ name, type, editable: false, sizes: { min: o.max ?? 1, max: o.max ?? 1 }, ports: [], ...o });
const gimbal = (name, size, gun, ed = true) => port(name, 'Turret', { max: size, editable: ed, compatible_types: [{ type: WEAPON_TYPE }], equipped_item: part('gb' + size, `VariPuck S${size} Gimbal Mount`, size, 'Turret'), ports: gun ? [gun] : [] });
const gunPort = (g) => port('hardpoint_class_2', WEAPON_TYPE, { max: g.size, equipped_item_uuid: g.uuid, equipped_item: g });

const MK2 = part('mk2', 'Tarantula GT-870 Mark 2 Cannon', 2), MK3 = part('mk3', 'Tarantula GT-870 Mark 3 Cannon', 3);
const PAN = part('pan', 'CF-337 Panther Repeater', 3), BAD = part('bad', 'CF-227 Badger Repeater', 2);

// F8C Lightning, as the ship's own record lists it (diag): every gimbal carries its gun; the turret holds two Badgers.
const f8cDetail = () => ({
  uuid: 'f8c', slug: 'anvl-lightning-f8c', name: 'F8C Lightning', is_spaceship: true,
  weaponry: { fixed_weapons: { weapons: [MK2, MK3, MK2, MK3, PAN, PAN, BAD, BAD].map((g) => ({ name: g.name })) } },
  ports: [
    gimbal('hardpoint_weapon_left_wing_outer', 2, gunPort(MK2)),
    gimbal('hardpoint_weapon_left_wing_inner', 3, gunPort(MK3)),
    gimbal('hardpoint_weapon_right_wing_outer', 2, gunPort(MK2)),
    gimbal('hardpoint_weapon_right_wing_inner', 3, gunPort(MK3)),
    gimbal('hardpoint_weapon_right_nose', 3, gunPort(PAN)),
    gimbal('hardpoint_weapon_left_nose', 3, gunPort(PAN)),
    port('hardpoint_weapon_turret', 'Turret', { max: 3, equipped_item: part('t', 'Anvil Lightning F8C Turret', 3, 'Turret'), ports: [
      port('hardpoint_weapon_01', WEAPON_TYPE, { max: 2, equipped_item_uuid: 'bad', equipped_item: BAD }),
      port('hardpoint_weapon_02', WEAPON_TYPE, { max: 2, equipped_item_uuid: 'bad', equipped_item: BAD })
    ] })
  ]
});
// The same ship in the list: the gimbals come with no child ports.
const f8cList = () => { const v = f8cDetail(); v.ports = v.ports.map((p) => ({ ...p, ports: [] })); return v; };

test('a ship record with guns inside its mounts gives each mount its own gun', () => {
  const s = slimShip(f8cDetail());
  const guns = s.slots.filter((x) => x.type === WEAPON_TYPE);
  assert.equal(guns.length, 8);
  const by = (id) => guns.find((g) => g.id === id)?.stock;
  assert.equal(by('hardpoint_weapon_left_wing_outer/hardpoint_class_2'), 'mk2');
  assert.equal(by('hardpoint_weapon_left_wing_inner/hardpoint_class_2'), 'mk3');
  assert.equal(by('hardpoint_weapon_right_nose/hardpoint_class_2'), 'pan');
  assert.equal(by('hardpoint_weapon_turret/hardpoint_weapon_01'), 'bad');
  assert.ok(guns.every((g) => g.stock), 'no gun left unknown');
});

test('the gun inside a swappable gimbal is swappable; inside a locked mount it is fixed', () => {
  const free = collectSlots([gimbal('a', 3, gunPort(PAN), true)]);
  const fixed = collectSlots([gimbal('a', 3, gunPort(PAN), false)]);
  assert.equal(free[0].locked, undefined);
  assert.equal(fixed[0].locked, true);
});

test('the list record of the F8C is exactly what needs a second look', () => {
  const list = slimShip(f8cList());
  const stock = [MK2, MK3, PAN, BAD].map((g) => ({ id: g.uuid, name: g.name, type: WEAPON_TYPE, size: g.size }));
  const need = needsDetail([list], [], stock);
  assert.deepEqual(need, [{ kind: 'detail', id: 'f8c', slug: 'anvl-lightning-f8c' }]);
  const done = needsDetail([slimShip(f8cDetail())], [], stock);
  assert.deepEqual(done, []);
});

const withFetch = async (impl, fn) => { const real = globalThis.fetch; globalThis.fetch = impl; try { return await fn(); } finally { globalThis.fetch = real; } };

test('stepWork swaps in the ship\'s own record and keeps its stock parts', async () => {
  const list = slimShip(f8cList());
  const work = { pages: 0, jobs: [{ kind: 'detail', id: 'f8c', slug: 'anvl-lightning-f8c' }], ships: [{ ...list, img: 'a/b/pic.png' }], parts: [], stock: [] };
  await withFetch(async (url) => { assert.match(String(url), /\/vehicles\/anvl-lightning-f8c$/); return { ok: true, json: async () => ({ data: f8cDetail() }) }; },
    () => stepWork({ SC_WIKI_API: 'https://x/api' }, work));
  assert.equal(work.jobs.length, 0);
  assert.equal(work.ships[0].slots.filter((s) => s.type === WEAPON_TYPE && s.stock).length, 8);
  assert.equal(work.ships[0].img, 'a/b/pic.png', 'the picture from the list is kept');
  assert.ok(work.stock.some((p) => p.id === 'mk3'));
});

test('stepWork: a ship whose own record cannot be fetched keeps the list data and does not stop the rebuild', async () => {
  const list = slimShip(f8cList());
  const work = { pages: 0, jobs: [{ kind: 'detail', id: 'f8c', slug: 'anvl-lightning-f8c' }], ships: [list], parts: [], stock: [] };
  await withFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }), () => stepWork({ SC_WIKI_API: 'https://x/api' }, work));
  assert.equal(work.jobs.length, 0);
  assert.equal(work.ships[0].slots.length, list.slots.length);
});

test('an empty mount is not given a leftover gun', () => {
  const v = {
    uuid: 'au', slug: 'au', name: 'Aurora', is_spaceship: true,
    weaponry: { fixed_weapons: { weapons: [{ name: 'CF-117 Bulldog Repeater' }, { name: 'CF-117 Bulldog Repeater' }] } },
    ports: [
      gimbal('nose_r', 1, gunPort(part('bd', 'CF-117 Bulldog Repeater', 1))), gimbal('nose_l', 1, gunPort(part('bd', 'CF-117 Bulldog Repeater', 1))),
      gimbal('wing_r', 1, port('hardpoint_class_1', WEAPON_TYPE, { max: 1, editable: true })), gimbal('wing_l', 1, port('hardpoint_class_1', WEAPON_TYPE, { max: 1, editable: true }))
    ]
  };
  const s = slimShip(v);
  const empties = s.slots.filter((x) => x.empty);
  assert.equal(empties.length, 2);
  assert.ok(empties.every((x) => !x.stockName && !x.stock));
});
