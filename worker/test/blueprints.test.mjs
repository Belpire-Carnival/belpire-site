import test from 'node:test';
import assert from 'node:assert/strict';
import { slimBlueprint, slimList, slimDetail, handleBlueprints, handleBlueprint } from '../sc-blueprints.js';

const ID = '280f47b7-8434-410c-b854-380768fdccec';
// Trimmed from a real api.star-citizen.wiki /api/blueprints record (4.10.2-LIVE).
const rec = (over = {}) => ({
  uuid: ID, key: 'BP_CRAFT_AMRS_LaserCannon_S1', output_name: 'Omnisky III Cannon', output_class: 'amrs_lasercannon_s1', craft_time_seconds: 540,
  is_available_by_default: false, game_version: '4.10.2-LIVE.12881860', unlocking_missions_count: 1,
  ingredients: [{ name: 'Agricium', kind: 'resource', quantity_scu: 0.36, quantity: null }, { name: 'Hadanite', kind: 'item', quantity_scu: null, quantity: 7 }],
  output: { type: 'WeaponGun', type_label: 'Weapon Gun', sub_type: 'Gun', grade: '1' }, ...over
});
const detail = () => rec({
  requirement_groups: [
    { key: 'FRAME', name: 'Frame', kind: 'group', required_count: 1, modifiers: [{ property_key: 'health_maxhealth', label: 'Integrity', better_when: 'higher', quality_range: { min: 0, max: 1000 }, modifier_range: { at_min_quality: 0.9, at_max_quality: 1.1 }, value_range_type: 'linear', value_segments: null }], children: [{ kind: 'resource', name: 'Agricium', quantity_scu: 0.36, min_quality: 1 }] },
    { key: 'EMITTER', name: 'Emitter', required_count: 1, modifiers: [], children: [{ kind: 'item', name: 'Hadanite', quantity: 7, min_quality: 1 }] }
  ],
  unlocking_missions_grouped: [{ label: 'Guaranteed', chance: 1, missions: [{ title: 'Tactical Strike Group Needed', reward_scope: 'Assassination', count: 1 }] }],
  dismantle: { time_seconds: 15, efficiency: 0.5 }
});

test('a list record keeps the name, output kind, craft time, starting-set flag and recipe', () => {
  const s = slimBlueprint(rec());
  assert.equal(s.name, 'Omnisky III Cannon'); assert.equal(s.type, 'Weapon Gun'); assert.equal(s.sec, 540); assert.equal(s.def, false); assert.equal(s.miss, 1);
  assert.deepEqual(s.ing, [{ n: 'Agricium', k: 'resource', scu: 0.36, q: null }, { n: 'Hadanite', k: 'item', scu: null, q: 7 }]);
  assert.equal(slimBlueprint({ uuid: 'nope', output_name: 'x' }), null);
  assert.equal(slimBlueprint(rec({ output_name: '' })), null);
});

test('the list drops duplicates and sorts by name', () => {
  const l = slimList([rec(), rec(), rec({ uuid: '11111111-1111-4111-8111-111111111111', output_name: 'Aardvark' }), null, 5]);
  assert.deepEqual(l.map((x) => x.name), ['Aardvark', 'Omnisky III Cannon']);
});

test('the detail carries quality ranges per slot, unlock missions and dismantle efficiency', () => {
  const d = slimDetail(detail());
  assert.equal(d.groups.length, 2);
  assert.deepEqual(d.groups[0].mods[0], { key: 'health_maxhealth', label: 'Integrity', better: 'higher', qmin: 0, qmax: 1000, lo: 0.9, hi: 1.1, curve: 'linear', segs: null });
  assert.equal(d.groups[0].kids[0].minq, 1); assert.equal(d.groups[1].kids[0].qty, 7);
  assert.equal(d.missions[0].label, 'Guaranteed'); assert.equal(d.missions[0].list[0].title, 'Tactical Strike Group Needed');
  assert.deepEqual(d.dismantle, { sec: 15, eff: 0.5 });
});

const reply = (rows, next) => ({ ok: true, json: async () => ({ data: rows, links: { next: next || null } }) });
test('the list handler follows same-host pages and flags a partial list', async () => {
  const real = globalThis.fetch; const urls = [];
  try {
    globalThis.fetch = async (u) => { urls.push(String(u)); return urls.length === 1 ? reply([rec()], 'https://api.star-citizen.wiki/api/blueprints?page%5Bnumber%5D=2') : reply([rec({ uuid: '22222222-2222-4222-8222-222222222222', output_name: 'Zeta' })]); };
    const ok = await handleBlueprints({}, {});
    assert.equal(ok.status, 200); assert.equal(ok.body.blueprints.length, 2); assert.equal(ok.body.complete, true); assert.equal(ok.body.version, '4.10.2-LIVE.12881860');
    assert.match(urls[0], /page%5Bsize%5D=100/);
    // a next link to another host is refused, and what was read so far is still served, marked incomplete
    let n = 0;
    globalThis.fetch = async () => (++n === 1 ? reply([rec()], 'https://evil.example/api/blueprints?page=2') : reply([]));
    const part = await handleBlueprints({}, {});
    assert.equal(part.status, 206); assert.equal(part.body.complete, false); assert.equal(part.body.blueprints.length, 1);
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    assert.equal((await handleBlueprints({}, {})).status, 502);
  } finally { globalThis.fetch = real; }
});

test('the detail handler only accepts a uuid and only talks to the wiki host', async () => {
  const real = globalThis.fetch; const urls = [];
  try {
    globalThis.fetch = async (u) => { urls.push(String(u)); return { ok: true, json: async () => ({ data: detail() }) }; };
    assert.equal((await handleBlueprint(new URL('https://x/api/sc-blueprint?id=../../etc'), {}, {})).status, 400);
    assert.equal((await handleBlueprint(new URL('https://x/api/sc-blueprint'), {}, {})).status, 400);
    const ok = await handleBlueprint(new URL(`https://x/api/sc-blueprint?id=${ID.toUpperCase()}`), {}, {});
    assert.equal(ok.status, 200); assert.equal(ok.body.blueprint.groups.length, 2);
    assert.equal(urls[0], `https://api.star-citizen.wiki/api/blueprints/${ID}`);
  } finally { globalThis.fetch = real; }
});
