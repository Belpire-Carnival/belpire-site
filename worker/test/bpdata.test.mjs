import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasGameBlueprints, handleGameList, handleGameOne } from '../sc-bpdata.js';
import data from '../sc-blueprints-game.json' with { type: 'json' };

test('the shipped blueprint file has the shapes the Blueprints pane and the Fabricator read', () => {
  if (!hasGameBlueprints()) return; // an empty placeholder is allowed: the Worker then falls back to the wiki
  const { body } = handleGameList();
  assert.equal(body.ready, true); assert.ok(body.blueprints.length > 500);
  for (const b of body.blueprints.slice(0, 200)) {
    assert.match(b.id, /^[0-9a-f-]{36}$/); assert.ok(b.name); assert.ok(Array.isArray(b.ing)); assert.equal(typeof b.sec, 'number'); assert.equal(typeof b.miss, 'number');
  }
  const one = handleGameOne(new URL('https://x/api/sc-blueprint?id=' + body.blueprints[0].id));
  assert.equal(one.status, 200); assert.ok(Array.isArray(one.body.blueprint.groups));
  for (const g of one.body.blueprint.groups) { assert.ok(g.key && g.name); for (const m of g.mods) { assert.ok(['higher', 'lower'].includes(m.better)); assert.ok(['linear', 'piecewise'].includes(m.curve)); assert.ok(Number.isFinite(m.lo) && Number.isFinite(m.hi)); } }
});

test('an unknown or malformed id is refused', () => {
  assert.equal(handleGameOne(new URL('https://x/?id=nope')).status, 400);
  assert.equal(handleGameOne(new URL('https://x/?id=00000000-0000-0000-0000-000000000000')).status, hasGameBlueprints() ? 404 : 404);
  assert.equal(handleGameOne(new URL('https://x/?id=__proto__')).status, 400);
});

test('list and detail agree: every listed blueprint has a detail', () => {
  for (const b of (data.list || []).slice(0, 300)) assert.ok(data.detail[b.id], b.id);
});
