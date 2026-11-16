import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLocations, handleLocations } from '../sc-locations.js';

test('cleanLocations keeps well-formed places and drops everything else', () => {
  const out = cleanLocations({ build: '4.10.2', places: [
    { n: 'Gamma City', s: 'Stanton', b: 'Beta Moon', k: 'City', j: 'Hurston', f: 'Head Hunters', svc: ['hangar', 'hangar-xl', 'Bad Key!', 5] },
    { n: '', s: 'Stanton', svc: ['pad'] }, { n: 'No services', s: 'Stanton', svc: [] }, null, 'x',
  ] });
  assert.equal(out.v, 1); assert.equal(out.build, '4.10.2');
  assert.equal(out.places.length, 1);
  assert.deepEqual(out.places[0].svc, ['hangar', 'hangar-xl']);
  assert.equal(out.places[0].f, 'Head Hunters');
});

test('cleanLocations survives junk input', () => {
  assert.deepEqual(cleanLocations(null).places, []);
  assert.deepEqual(cleanLocations({ places: 'x' }).places, []);
});

test('the shipped file loads, and every place in it is clean', () => {
  const { status, body } = handleLocations();
  assert.equal(status, 200); assert.equal(body.v, 1); assert.ok(Array.isArray(body.places));
  for (const p of body.places) { assert.ok(p.n && p.s && p.svc.length); }
});
