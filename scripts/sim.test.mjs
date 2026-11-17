import test from 'node:test';
import assert from 'node:assert/strict';
import { weaponAlpha, deflectionCheck, penetrationFacts, driveOf, travelTime, fmtTime } from '../site/bureau/rsi1/companion/sim-core.js';

const agni = { x: {
  'quantum_drive.standard_jump.drive_speed': 585715600, 'quantum_drive.standard_jump.engage_speed': 190000000,
  'quantum_drive.standard_jump.stage_one_accel_rate': 4685175, 'quantum_drive.standard_jump.stage_two_accel_rate': 5969838,
  'quantum_drive.standard_jump.spool_up_time': 8.5, 'quantum_drive.standard_jump.cooldown_time': 21.6, 'quantum_drive.travel_time_10gm.seconds': 91 } };
const gun = { x: { 'vehicle_weapon.damage.alpha.physical': 72.99, 'vehicle_weapon.damage.alpha.energy': 0, 'vehicle_weapon.ammunition.penetration.base_distance': 1.275, 'vehicle_weapon.ammunition.max_penetration_thickness': 0.5, 'vehicle_weapon.ammunition.speed': 1196 } };

test('weapon alpha by type', () => { assert.equal(weaponAlpha(gun).physical, 72.99); assert.equal(weaponAlpha(gun).energy, 0); assert.equal(weaponAlpha(gun).distortion, null); });
test('weapon alpha falls back to the summary figure', () => assert.equal(weaponAlpha({ wpn: { alpha: 50 } }).physical, 50));

test('deflection: a million is no limit', () => {
  const r = deflectionCheck(gun, { defl: { phys: 1000000, energy: 1000000, dist: 0 } });
  assert.equal(r[0].status, 'none'); assert.equal(r[0].limit, null); assert.equal(r[1].status, 'nodamage');
});
test('deflection: real thresholds decide', () => {
  assert.equal(deflectionCheck(gun, { defl: { phys: 100 } })[0].status, 'deflected');
  assert.equal(deflectionCheck(gun, { defl: { phys: 50 } })[0].status, 'passes');
  assert.equal(deflectionCheck(gun, null)[0].status, 'none');
});
test('penetration facts', () => {
  const f = penetrationFacts(gun, { armor: { pen: { phys: 1 } }, penMul: { fuse: 0.7, components: 1 } });
  assert.equal(f.depth, 1.275); assert.equal(f.maxThickness, 0.5); assert.equal(f.resist.phys, 1); assert.equal(f.mulFuse, 0.7); assert.equal(f.range, null);
});
test('drive needs all four figures', () => { assert.ok(driveOf(agni)); assert.equal(driveOf({ x: {} }), null); });
test('travel time over 10 Gm is within 2% of the wiki figure', () => {
  const d = driveOf(agni), r = travelTime(d, 1e10);
  assert.ok(Math.abs(r.travel - d.wiki10) / d.wiki10 < 0.02, String(r.travel));
  assert.equal(r.reachedMax, false); assert.ok(r.total > r.travel);
});
test('a long trip reaches full speed and cruises', () => {
  const r = travelTime(driveOf(agni), 1e11);
  assert.equal(r.reachedMax, true); assert.ok(r.cruise > 50);
});
test('a short trip is quicker and never exceeds the longer one', () => {
  const d = driveOf(agni);
  assert.ok(travelTime(d, 1e8).travel < travelTime(d, 1e9).travel);
  assert.ok(travelTime(d, 1e8).peak < 190000000);
});
test('bad input gives null', () => { assert.equal(travelTime(null, 1e9), null); assert.equal(travelTime(driveOf(agni), 0), null); });
test('time format', () => { assert.equal(fmtTime(91), '1m 31s'); assert.equal(fmtTime(8.5), '8.5s'); assert.equal(fmtTime(null), '—'); });
