import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanObjective, cleanObjectives, addUnlock, addGather, setHave, setDone, removeObjective, progress, sortObjectives, nextObjective, openCount, MAX_OBJ } from '../../site/bureau/rsi1/companion/obj-core.js';
import { cleanBp, addOwned } from '../../site/bureau/rsi1/companion/plan-core.js';

const T0 = 1_700_000_000_000;
const none = cleanBp(null);
const mats = [{ group: 'Frame', name: 'Agricium', scu: 0.72, qty: null, minq: 300 }, { group: 'Emitter', name: 'Hadanite', scu: null, qty: 14, minq: null }];

test('objectives are cleaned: bad kinds and nameless rows drop, numbers are bounded', () => {
  assert.equal(cleanObjective({ kind: 'nope', name: 'x' }), null);
  assert.equal(cleanObjective({ kind: 'unlock', name: '  ' }), null);
  const o = cleanObjective({ kind: 'gather', name: ' Railgun ', crafts: 5000, items: [{ name: 'A', need: -3, have: 'x' }, { name: '' }, null] });
  assert.equal(o.name, 'Railgun'); assert.equal(o.crafts, 999); assert.equal(o.items.length, 1);
  assert.ok(o.items[0].need > 0); assert.equal(o.items[0].have, 0);
  assert.deepEqual(cleanObjectives('junk'), []);
  assert.equal(cleanObjectives(Array.from({ length: 90 }, (_, i) => ({ kind: 'unlock', name: `b${i}` }))).length, MAX_OBJ);
});

test('unlock objectives do not duplicate and finish when a scan shows the blueprint owned', () => {
  let l = addUnlock([], { name: 'Gallant Rifle' }, T0);
  l = addUnlock(l, { name: 'gallant rifle!' }, T0 + 1);
  assert.equal(l.length, 1);
  assert.equal(progress(l[0], none).done, false);
  const bp = addOwned(none, 'Gallant Rifle', 'Weapons', T0);
  const p = progress(l[0], bp);
  assert.equal(p.done, true); assert.equal(p.frac, 1); assert.match(p.label, /Owned/);
  assert.equal(progress(setDone(l, l[0].id, true)[0], none).done, true);
});

test('a craft becomes a gather objective; progress follows what you have collected', () => {
  let l = addGather([], { bp: { id: 'bp1', name: 'Omnisky III' }, crafts: 2, materials: mats }, T0);
  assert.equal(l.length, 1); assert.equal(l[0].items.length, 2);
  assert.deepEqual(l[0].items.map((i) => [i.unit, i.need]), [['SCU', 0.72], ['units', 14]]);
  assert.equal(progress(l[0], none).frac, 0);
  l = setHave(l, l[0].id, 0, 0.72);
  assert.equal(progress(l[0], none).frac, 0.5);
  assert.match(progress(l[0], none).label, /1 of 2/);
  l = setHave(l, l[0].id, 1, 99);
  assert.equal(progress(l[0], none).done, true);
  assert.equal(setHave(l, 'nope', 0, 1).length, 1);
  assert.equal(addGather([], { bp: { id: 'x', name: 'Empty' }, materials: [] }).length, 0);
});

test('sending the same craft again updates the list and keeps what you collected', () => {
  let l = addGather([], { bp: { id: 'bp1', name: 'Omnisky III' }, crafts: 1, materials: mats }, T0);
  const id = l[0].id;
  l = setHave(l, id, 0, 0.3);
  l = addGather(l, { bp: { id: 'bp1', name: 'Omnisky III' }, crafts: 3, materials: [{ ...mats[0], scu: 2.16 }, mats[1]] }, T0 + 5);
  assert.equal(l.length, 1); assert.equal(l[0].id, id); assert.equal(l[0].crafts, 3);
  assert.equal(l[0].items[0].have, 0.3); assert.equal(l[0].items[0].need, 2.16);
});

test('the next objective is the open one closest to done; finished ones sort last', () => {
  let l = addUnlock([], { name: 'Far' }, T0);
  l = addGather(l, { bp: { id: 'g', name: 'Near' }, materials: [{ name: 'A', scu: 1 }] }, T0 + 1);
  l = setHave(l, l.find((o) => o.kind === 'gather').id, 0, 0.9);
  assert.equal(nextObjective(l, none).objective.name, 'Near');
  const bp = addOwned(none, 'Far', 'x', T0);
  assert.equal(sortObjectives(l, bp).at(-1).name, 'Far');
  assert.equal(openCount(l, bp), 1);
  assert.equal(nextObjective(setDone(l, l.find((o) => o.name === 'Near').id, true), bp), null);
  assert.equal(removeObjective(l, l[0].id).length, 1);
});

test('the objectives pane builds from text nodes, stores under arsenal.plan.obj and talks to nobody', () => {
  const ui = readFileSync(new URL('../../site/bureau/rsi1/companion/obj-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(ui, /innerHTML|insertAdjacentHTML|\.style\.|XMLHttpRequest|eval\(|fetch\(/);
  assert.deepEqual([...ui.matchAll(/https?:\/\/[^'"`\s]+/g)], []);
  assert.match(ui, /arsenal\.plan\.obj/);
});
