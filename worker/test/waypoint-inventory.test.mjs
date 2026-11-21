import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATEGORIES, LOCATION_KINDS, SERVICES, buildPlaces, systemsOf, bodiesOf, findHere, rank, tierOf, tierCounts, TIERS } from '../../site/bureau/rsi1/companion/near-core.js';
import { cleanItem, cleanInv, addItem, setQty, removeItem, importRows, search, places, whereIs, MAX_ITEMS } from '../../site/bureau/rsi1/companion/inv-core.js';

const rows = [
  { commodity: 'Laranite', terminal: 'TDD - Lorville', system: 'Stanton', place: 'Lorville', body: 'Hurston', buy: 28, sell: null, scuBuy: 500 },
  { commodity: 'Gold', terminal: 'TDD - Lorville', system: 'Stanton', place: 'Lorville', body: 'Hurston', buy: null, sell: 6000 },
  { commodity: 'Laranite', terminal: 'Everus Harbor', system: 'Stanton', place: 'Everus Harbor', body: 'Hurston', buy: null, sell: 30 },
  { commodity: 'Laranite', terminal: 'Port Olisar', system: 'Stanton', place: 'Port Olisar', body: 'Crusader', buy: 27, sell: 31 },
  { commodity: 'Laranite', terminal: 'Checkmate', system: 'Pyro', place: 'Checkmate', body: 'Pyro IV', buy: null, sell: 40 },
  { commodity: 'Gold', terminal: 'Checkmate', system: 'Pyro', place: 'Checkmate', body: 'Pyro IV', buy: null, sell: 6500 },
  { commodity: 'Bad', system: 'Stanton' }, null
];

test('places group terminals and the rows that have none are dropped', () => {
  const p = buildPlaces(rows);
  assert.equal(p.length, 4); assert.deepEqual(systemsOf(p), ['Pyro', 'Stanton']); assert.deepEqual(bodiesOf(p, 'Stanton'), ['Crusader', 'Hurston']);
  const l = p.find((x) => x.name === 'Lorville'); assert.equal(l.terminals.length, 1); assert.equal(l.terminals[0].buys[0].price, 28); assert.equal(l.terminals[0].sells[0].commodity, 'Gold');
  assert.deepEqual(buildPlaces('x'), []);
});

test('closeness is a tier: here, same body, same system, other system', () => {
  const p = buildPlaces(rows), here = p.find((x) => x.name === 'Lorville');
  assert.deepEqual(p.map((x) => tierOf(x, here)).sort(), [0, 1, 2, 3]);
  assert.equal(tierOf(p[0], null), 2);
  const r = rank(p, here, { mode: 'sell', q: 'laranite' });
  assert.deepEqual(r.map((x) => x.place.name), ['Everus Harbor', 'Port Olisar', 'Checkmate']);
  assert.deepEqual(r.map((x) => x.tier), [1, 2, 3]); assert.deepEqual(tierCounts(r), [0, 1, 1, 1]); assert.equal(TIERS.length, 4);
});

test('rank orders by price inside a tier and filters by mode and search', () => {
  const p = buildPlaces(rows), here = p.find((x) => x.name === 'Port Olisar');
  assert.deepEqual(rank(p, here, { mode: 'buy', q: 'laranite' }).map((x) => x.place.name), ['Port Olisar', 'Lorville']);
  const gold = rank(p, here, { mode: 'sell', q: 'gold' }); assert.equal(gold[0].place.name, 'Lorville'); assert.equal(gold[1].tier, 3);
  assert.equal(rank(p, here, { q: 'nothing like this' }).length, 0);
  assert.equal(rank(p, here, { mode: 'any', q: 'Everus' })[0].place.name, 'Everus Harbor');
});

test('a pasted line finds the longest known place name in it', () => {
  const p = buildPlaces(rows);
  assert.equal(findHere('Location: Stanton > Hurston > Everus Harbor Hangar', p).name, 'Everus Harbor');
  assert.equal(findHere('x: 123 y: 4 z: 5', p), null); assert.equal(findHere('', p), null);
});

test('inventory items are cleaned and merge by name and place', () => {
  assert.equal(cleanItem({ name: 'x' }), null); assert.equal(cleanItem({ place: 'p' }), null);
  assert.equal(cleanItem({ name: 'A', place: 'P', cat: 'Nonsense', qty: 'x' }).cat, 'Other');
  let inv = addItem([], { name: 'Gallant Rifle', place: 'Lorville', qty: 2, cat: 'Weapon' }, 1000);
  inv = addItem(inv, { name: 'gallant rifle', place: 'LORVILLE', qty: 1 }, 2000);
  assert.equal(inv.length, 1); assert.equal(inv[0].qty, 3); assert.equal(inv[0].cat, 'Weapon'); assert.equal(inv[0].at, 2000);
  inv = setQty(inv, 'Gallant Rifle', 'Lorville', 5, 3000); assert.equal(inv[0].qty, 5);
  assert.equal(setQty(inv, 'Gallant Rifle', 'Lorville', 0).length, 0);
  assert.equal(removeItem(inv, 'Gallant Rifle', 'Lorville').length, 0);
  assert.equal(cleanInv(Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({ name: `i${i}`, place: 'p' }))).length, MAX_ITEMS);
});

test('a scan replaces a place or only adds to it, and places remember their last update', () => {
  let inv = importRows([], 'Lorville', [{ name: 'Rifle', qty: 2 }, { name: 'Medpen', qty: 10, cat: 'Gadget / medical' }], {}, 1000);
  inv = importRows(inv, 'Port Olisar', [{ name: 'Rifle', qty: 1 }], {}, 1500);
  inv = importRows(inv, 'Lorville', [{ name: 'Rifle', qty: 1 }, { name: 'Helmet', qty: 1 }], { replace: true }, 2000);
  assert.deepEqual(search(inv, '', 'Lorville').map((x) => x.name), ['Helmet', 'Rifle']);
  assert.equal(search(inv, '', 'Lorville').find((x) => x.name === 'Rifle').qty, 1);
  const p = places(inv); assert.equal(p.find((x) => x.place === 'Lorville').at, 2000); assert.equal(p.find((x) => x.place === 'Port Olisar').at, 1500);
  assert.equal(whereIs(inv, 'rifle').total, 2); assert.equal(whereIs(inv, '').total, 0);
  const add = importRows(inv, 'Lorville', [{ name: 'Rifle', qty: 4 }], {}, 3000); assert.equal(search(add, 'rifle', 'Lorville')[0].qty, 4);
  assert.deepEqual(importRows(inv, '  ', [{ name: 'x' }]), inv);
});

test('Waypoint and Inventory are panes with their own views, icons and art', () => {
  const dir = new URL('../../site/bureau/rsi1/companion/', import.meta.url);
  const app = readFileSync(new URL('app.js', dir), 'utf8'), html = readFileSync(new URL('index.html', dir), 'utf8');
  for (const [id, label] of [['waypoint', 'Waypoint'], ['inventory', 'Inventory']]) {
    assert.match(app, new RegExp(`\\['${id}', '${label}'\\]`)); assert.match(html, new RegExp(`id="v-${id}"`)); assert.match(html, new RegExp(`id="h-${id}"`));
    assert.match(readFileSync(new URL('viz.js', dir), 'utf8'), new RegExp(`^\\s{2}${id}:\\s*\\[`, 'm')); assert.match(readFileSync(new URL('art.js', dir), 'utf8'), new RegExp(`^\\s{2}${id}:`, 'm'));
  }
});

test('services add places and filter results, with prices still searchable beside them', () => {
  const services = [{ name: 'Admin Refinery', place: 'Area18', system: 'Stanton', body: 'ArcCorp', svc: ['refinery', 'dock'] }, { name: 'Far Dock', place: 'Ruin Station', system: 'Pyro', body: 'Pyro IV', svc: ['refuel'] }];
  const p = buildPlaces([...rows.filter(Boolean)], services);
  assert.equal(p.length, 6); assert.deepEqual(p.find((x) => x.name === 'Area18').svc, ['dock', 'refinery']);
  const here = p.find((x) => x.name === 'Lorville');
  const r = rank(p, here, { service: 'refinery' });
  assert.deepEqual(r.map((x) => x.place.name), ['Area18']); assert.equal(r[0].tier, 2); assert.deepEqual(rank(p, here, { service: 'refuel' }).map((x) => x.tier), [3]);
  assert.equal(rank(p, here, { service: 'medical' }).length, 0); assert.ok(SERVICES.length >= 10);
  assert.ok(rank(p, here, { service: 'refinery', q: 'laranite' }).length === 0);
});

test('the category filters combine, and a search can be shared through the address', async () => {
  const services = [{ name: 'Admin Refinery', place: 'Area18', system: 'Stanton', body: 'ArcCorp', kind: 'City', svc: ['refinery', 'dock'] }, { name: 'Everus Harbor', place: 'Everus Harbor', system: 'Stanton', body: 'Hurston', kind: 'Space station', svc: ['refinery'] }];
  const p = buildPlaces(rows.filter(Boolean).map((r) => (r.place === 'Everus Harbor' ? { ...r, kind: 'Space station' } : r)), services);
  const names = (o) => rank(p, null, o).map((x) => x.place.name).sort();
  assert.deepEqual(names({ cats: ['refinery'] }), ['Area18', 'Everus Harbor']); assert.deepEqual(names({ cats: ['refinery', 'dock'] }), ['Area18']);
  assert.deepEqual(names({ cats: ['refinery'], planet: 'Hurston' }), ['Everus Harbor']); assert.deepEqual(names({ kind: 'City' }), ['Area18']);
  assert.deepEqual(names({ cats: ['trade'], planet: 'Hurston' }), ['Everus Harbor', 'Lorville']); assert.deepEqual(names({ cats: ['storage'] }), names({}));
  assert.ok(CATEGORIES.filter((c) => !c.has).length >= 8 && LOCATION_KINDS.includes('City'));
  const { readHash, writeHash } = await import('../../site/bureau/rsi1/companion/near-ui.js');
  const st = { cats: ['refinery', 'dock'], planet: 'Hurston', kind: 'City', q: 'ore', auth: 'ArcCorp', mode: 'sell' };
  assert.deepEqual(readHash(writeHash(st)), st); assert.deepEqual(readHash('#waypoint?cat=evil,refinery&kind=Nope'), { cats: ['refinery'], planet: '', kind: '', q: '', auth: '', mode: 'any' });
  assert.equal(writeHash({ cats: [], planet: '', kind: '', q: '', auth: '', mode: 'any' }), '#waypoint');
});
