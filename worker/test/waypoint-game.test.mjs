import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaces, rank, authoritiesOf, CATEGORIES, SERVICE_LABEL } from '../../site/bureau/rsi1/companion/near-core.js';

const rows = [{ system: 'Stanton', place: 'Gamma City', body: 'Beta Moon', kind: 'City', terminal: 'Gamma TDD', commodity: 'Gold', buy: 0, sell: 5 }];
const game = [
  { n: 'Gamma City', s: 'Stanton', b: 'Beta Moon', k: 'City', svc: ['hangar', 'hangar-xl', 'pad', 'pad-m', 'garage'] },
  { n: 'Delta Station', s: 'Stanton', b: 'Beta Moon', k: 'Space station', svc: ['pad', 'pad-l', 'docking'] },
  { n: 'Port Epsilon Gateway', s: 'Pyro', b: '', k: 'Space station', svc: ['hangar', 'hangar-l'] },
];

test('game places merge into a matching UEX place by name and add their services', () => {
  const p = buildPlaces(rows, [], game).find((x) => x.name === 'Gamma City');
  assert.deepEqual(p.svc, ['garage', 'hangar', 'hangar-xl', 'pad', 'pad-m']);
  assert.equal(p.terminals.length, 1, 'the trade terminal is kept');
});

test('a game place with no UEX match becomes a place of its own, in the right system and body', () => {
  const places = buildPlaces(rows, [], game);
  const d = places.find((x) => x.name === 'Delta Station');
  assert.equal(d.system, 'Stanton'); assert.equal(d.body, 'Beta Moon'); assert.equal(d.kind, 'Space station'); assert.equal(d.terminals.length, 0);
  assert.equal(places.length, 3);
});

test('a name that only differs by extra words matches when it is unambiguous', () => {
  const p = buildPlaces([{ system: 'Pyro', place: 'Epsilon Gateway', terminal: 'T', commodity: 'Gold', buy: 1, sell: 0 }], [], game);
  assert.equal(p.filter((x) => x.system === 'Pyro').length, 1);
  assert.ok(p.find((x) => x.system === 'Pyro').svc.includes('hangar-l'));
});

test('the new filters work through rank()', () => {
  const places = buildPlaces(rows, [], game), has = (id) => CATEGORIES.find((c) => c.id === id)?.has;
  for (const id of ['hangars', 'pads', 'sretrieve', 'vretrieve', 'docking']) assert.ok(has(id), `${id} is switched on`);
  assert.deepEqual(rank(places, null, { cats: ['hangars'] }).map((r) => r.place.name).sort(), ['Gamma City', 'Port Epsilon Gateway']);
  assert.deepEqual(rank(places, null, { cats: ['pads'] }).map((r) => r.place.name).sort(), ['Delta Station', 'Gamma City']);
  assert.deepEqual(rank(places, null, { service: 'hangar-xl' }).map((r) => r.place.name), ['Gamma City']);
  assert.deepEqual(rank(places, null, { cats: ['hangars', 'pads'] }).map((r) => r.place.name), ['Gamma City']);
});

test('every game service key has a label, so chips never show a raw key', () => {
  for (const k of ['hangar', 'hangar-s', 'hangar-m', 'hangar-l', 'hangar-xl', 'pad', 'pad-s', 'pad-m', 'pad-l', 'pad-xl', 'garage', 'vehsvc', 'docking', 'shipitems']) assert.ok(SERVICE_LABEL[k], k);
});

test('buildPlaces still works with no game data', () => {
  assert.equal(buildPlaces(rows).length, 1);
  assert.equal(buildPlaces(rows, [], null).length, 1);
});

test('jurisdiction and faction ride along and filter through rank()', () => {
  const g = [
    { n: 'Gamma City', s: 'Stanton', b: 'Beta Moon', k: 'City', j: 'Hurston Dynamics', svc: ['hangar'] },
    { n: 'Outlaw Rock', s: 'Pyro', b: '', k: 'Outpost', j: '', f: 'Head Hunters', svc: ['pad'] },
  ];
  const places = buildPlaces(rows, [], g);
  assert.deepEqual(authoritiesOf(places), ['Head Hunters', 'Hurston Dynamics']);
  assert.deepEqual(rank(places, null, { auth: 'Hurston Dynamics' }).map((r) => r.place.name), ['Gamma City']);
  assert.deepEqual(rank(places, null, { auth: 'Head Hunters' }).map((r) => r.place.name), ['Outlaw Rock']);
  assert.equal(rank(places, null, { auth: 'Nobody' }).length, 0);
});
