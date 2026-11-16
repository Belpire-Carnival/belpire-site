import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanShipPlan, cleanPlan, planFor, setRole, setStatus, addCrew, removeCrew, addBuild, removeBuild, setActiveBuild, activeBuild, pruneFor, overview, totals,
  parseBuildCode, encodeFleet, decodeFleet, mergeMember, removeMember, groupOverview, cleanGroup, MAX_CREW, MAX_BUILDS, MAX_MEMBERS, CODE_PREFIX } from '../../site/bureau/rsi1/companion/fleet-core.js';

const fleet = [
  { name: 'Hammerhead', stats: { burst: 9000, hull: 20000, shieldHp: 8000, cargo: 0, crew: 7 } },
  { name: 'Caterpillar', stats: { cargo: 576, hull: 14000, crew: 4 } },
  { name: 'Hand-added' }
];

test('ship plans are cleaned: unknown roles and statuses reset, crew and builds bounded', () => {
  const p = cleanShipPlan({ role: 'Pirate', status: 'Gone', crew: Array.from({ length: 40 }, (_, i) => ({ name: `p${i}` })).concat([{ name: ' ' }, null]), builds: [{ code: 'bad code!' }, { code: 'abc_DEF-1', label: 'PvP' }], active: 9 });
  assert.equal(p.role, ''); assert.equal(p.status, 'Active'); assert.equal(p.crew.length, MAX_CREW);
  assert.equal(p.builds.length, 1); assert.equal(p.active, 0);
  assert.deepEqual(cleanPlan('junk'), {}); assert.deepEqual(cleanPlan([1]), {});
});

test('roles, status and crew edits are keyed by ship name and do not duplicate', () => {
  let p = setRole({}, 'Hammerhead', 'Combat');
  p = setStatus(p, 'hammer-head', 'Standby');
  assert.equal(planFor(p, 'HAMMERHEAD').role, 'Combat'); assert.equal(planFor(p, 'Hammerhead').status, 'Standby');
  p = addCrew(p, 'Hammerhead', 'Ana', 'Pilot'); p = addCrew(p, 'Hammerhead', 'ana', 'pilot'); p = addCrew(p, 'Hammerhead', 'Bo', 'Gunner');
  assert.equal(planFor(p, 'Hammerhead').crew.length, 2);
  p = removeCrew(p, 'Hammerhead', 0);
  assert.equal(planFor(p, 'Hammerhead').crew[0].name, 'Bo');
  assert.equal(addCrew(p, 'Hammerhead', '  ').constructor, Object);
});

test('saved builds take a bare code or a whole link, and the newest becomes active', () => {
  assert.equal(parseBuildCode('https://bureau.belpire.com/rsi1/companion/#calc?b=abc_123-X'), 'abc_123-X');
  assert.equal(parseBuildCode('abc123'), 'abc123'); assert.equal(parseBuildCode('not a code'), '');
  let p = addBuild({}, 'Hammerhead', 'PvP', 'aaa'); p = addBuild(p, 'Hammerhead', 'Bounty', '#calc?b=bbb');
  assert.equal(activeBuild(p, 'Hammerhead').label, 'Bounty');
  p = addBuild(p, 'Hammerhead', 'Again', 'aaa');
  assert.equal(planFor(p, 'Hammerhead').builds.length, 2);
  p = setActiveBuild(p, 'Hammerhead', 0);
  p = removeBuild(p, 'Hammerhead', 0);
  assert.equal(planFor(p, 'Hammerhead').builds.length, 1); assert.equal(planFor(p, 'Hammerhead').active, 0);
  assert.equal(addBuild({}, 'X', 'y', '???').X, undefined);
  let q = {}; for (let i = 0; i < 10; i++) q = addBuild(q, 'Z', `b${i}`, `code${i}`);
  assert.equal(planFor(q, 'Z').builds.length, MAX_BUILDS);
});

test('plans for ships that left the hangar are pruned', () => {
  const p = pruneFor(setRole(setRole({}, 'Hammerhead', 'Combat'), 'Gone', 'Mining'), fleet);
  assert.deepEqual(Object.keys(p), ['hammerhead']);
});

test('overview adds up ships with stat sheets and flags active ships with no crew', () => {
  let p = setRole({}, 'Hammerhead', 'Combat'); p = setRole(p, 'Caterpillar', 'Cargo / hauling'); p = addCrew(p, 'Caterpillar', 'Ana', 'Pilot'); p = setStatus(p, 'Hand-added', 'Stored');
  const o = overview(fleet, p);
  assert.equal(o.ships, 3); assert.equal(o.detailed, 2); assert.equal(o.cargo, 576); assert.equal(o.dps, 9000); assert.equal(o.hull, 34000); assert.equal(o.crewMax, 11);
  assert.equal(o.byStatus.Stored, 1); assert.equal(o.byStatus.Active, 2); assert.equal(o.unassigned, 1); assert.equal(o.crewAssigned, 1); assert.equal(o.people, 1);
  assert.deepEqual(o.noCrew, ['Hammerhead']); assert.deepEqual(o.byRole.Combat, ['Hammerhead']);
  assert.equal(totals(null).ships, 0);
});

test('a fleet code round-trips and carries no crew, notes or pictures', () => {
  let p = setRole({}, 'Hammerhead', 'Combat'); p = addCrew(p, 'Hammerhead', 'Secret Person'); p = { ...p, hammerhead: { ...p.hammerhead, note: 'private note' } };
  const code = encodeFleet(fleet.map((s) => ({ ...s, img: 'x.jpg' })), p, 'Ana', 5);
  assert.ok(code.startsWith(CODE_PREFIX));
  const m = decodeFleet(code);
  assert.equal(m.who, 'Ana'); assert.equal(m.ships.length, 3); assert.equal(m.ships[0].role, 'Combat'); assert.equal(m.ships[0].stats.hull, 20000);
  assert.ok(!code.includes('Secret') && !JSON.stringify(m).includes('Secret') && !JSON.stringify(m).includes('private') && !JSON.stringify(m).includes('x.jpg'));
  assert.equal(encodeFleet(fleet, p, '  '), '');
});

test('bad or oversized fleet codes are rejected', () => {
  assert.equal(decodeFleet('hello'), null); assert.equal(decodeFleet(CODE_PREFIX + '!!!'), null); assert.equal(decodeFleet(CODE_PREFIX + 'A'.repeat(30000)), null);
  assert.equal(decodeFleet(CODE_PREFIX + Buffer.from('{"who":"","ships":[]}').toString('base64url')), null);
  const evil = decodeFleet(CODE_PREFIX + Buffer.from(JSON.stringify({ who: 'E', ships: [{ name: 'S', role: '<b>x</b>', stats: { hull: 'NaN', bogus: 5, cargo: 12 } }] })).toString('base64url'));
  assert.equal(evil.ships[0].role, ''); assert.deepEqual(evil.ships[0].stats, { cargo: 12 });
});

test('group fleet: a name replaces its earlier list, members cap, totals combine', () => {
  const a = decodeFleet(encodeFleet(fleet, {}, 'Ana')), b = decodeFleet(encodeFleet([fleet[1]], setRole({}, 'Caterpillar', 'Cargo / hauling'), 'Bo'));
  let g = mergeMember([], a); g = mergeMember(g, b); g = mergeMember(g, { ...a, ships: [a.ships[0]] });
  assert.equal(g.length, 2); assert.equal(g.find((m) => m.who === 'Ana').ships.length, 1);
  const o = groupOverview(g, { who: 'Me', ships: [{ name: 'Aurora', role: 'Racing', stats: { cargo: 3 } }] });
  assert.equal(o.members, 3); assert.equal(o.ships, 3); assert.equal(o.cargo, 579); assert.equal(o.byMember.Bo, 1); assert.equal(o.byRole['Cargo / hauling'], 1);
  assert.equal(removeMember(g, 'ana').length, 1);
  let big = []; for (let i = 0; i < 30; i++) big = mergeMember(big, { who: `p${i}`, ships: [] });
  assert.equal(big.length, MAX_MEMBERS); assert.deepEqual(cleanGroup('x'), []);
});

test('the Fleet Manager is a pane in the Hangar hub with its own view, icon and art', () => {
  const dir = new URL('../../site/bureau/rsi1/companion/', import.meta.url);
  const app = readFileSync(new URL('app.js', dir), 'utf8'), html = readFileSync(new URL('index.html', dir), 'utf8');
  assert.match(app, /\['fleetmgr', 'Fleet Manager'\]/); assert.match(html, /id="v-fleetmgr"/); assert.match(html, /id="h-fleetmgr"/);
  assert.match(readFileSync(new URL('viz.js', dir), 'utf8'), /^\s{2}fleetmgr:\s*\[/m); assert.match(readFileSync(new URL('art.js', dir), 'utf8'), /^\s{2}fleetmgr:/m);
});
