// Simulations maths for the Calculator: deflection check, penetration facts and quantum travel time. Pure functions,
// no page code. Every number comes from the wiki record of the part or ship; where the record has no figure the
// result says so instead of guessing. A threshold of a million or more is the game's "no limit" placeholder.
export const NO_LIMIT = 1e6;
const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const DAMAGE_TYPES = [['physical', 'Physical', 'phys'], ['energy', 'Energy', 'energy'], ['distortion', 'Distortion', 'dist']];

// Per-shot damage of a gun, by type, from the part's detail sheet (part.x).
export function weaponAlpha(part) {
  const x = part?.x || {};
  const out = {};
  for (const [key] of DAMAGE_TYPES) out[key] = n(x[`vehicle_weapon.damage.alpha.${key}`]);
  const any = Object.values(out).some((v) => v != null);
  if (!any && n(part?.wpn?.alpha) != null) out.physical = part.wpn.alpha;
  return out;
}

// Deflection check: does one shot of each damage type beat the hull armor's deflection threshold?
// status: 'deflected' (shot damage is at or under the threshold), 'passes', 'none' (no limit or no data), 'nodamage'.
export function deflectionCheck(part, armor) {
  const alpha = weaponAlpha(part);
  return DAMAGE_TYPES.map(([key, label, short]) => {
    const dmg = alpha[key];
    const raw = n(armor?.defl?.[short]);
    const limit = raw == null || raw >= NO_LIMIT || raw <= 0 ? null : raw;
    let status = 'none';
    if (dmg == null || dmg <= 0) status = 'nodamage';
    else if (limit != null) status = dmg <= limit ? 'deflected' : 'passes';
    return { key, label, damage: dmg, limit, status };
  });
}

// Penetration: what the records say, without a pass or fail (the wiki has no per-part thickness to compare with).
export function penetrationFacts(part, stats) {
  const x = part?.x || {};
  const a = stats?.armor || {};
  return {
    depth: n(x['vehicle_weapon.ammunition.penetration.base_distance']),
    maxThickness: n(x['vehicle_weapon.ammunition.max_penetration_thickness']),
    nearRadius: n(x['vehicle_weapon.ammunition.penetration.near_radius']),
    farRadius: n(x['vehicle_weapon.ammunition.penetration.far_radius']),
    speed: n(x['vehicle_weapon.ammunition.speed']),
    range: n(x['vehicle_weapon.ammunition.range'] ?? x['vehicle_weapon.range']),
    resist: { phys: n(a.pen?.phys), energy: n(a.pen?.energy), dist: n(a.pen?.dist) },
    mulFuse: n(stats?.penMul?.fuse),
    mulComponents: n(stats?.penMul?.components)
  };
}

// The drive's standard jump figures from its detail sheet.
export function driveOf(part) {
  const x = part?.x || {};
  const g = (k) => n(x[`quantum_drive.standard_jump.${k}`]);
  const drive = { speed: g('drive_speed'), engage: g('engage_speed'), a1: g('stage_one_accel_rate'), a2: g('stage_two_accel_rate'), spool: g('spool_up_time'), cooldown: g('cooldown_time'), wiki10: n(x['quantum_drive.travel_time_10gm.seconds']) };
  return drive.speed && drive.engage && drive.a1 && drive.a2 ? drive : null;
}

// Travel time over `meters`: speed builds at the stage one rate up to the engage speed, then at the stage two rate up
// to the drive speed, holds there, and slows the same way. A short trip never reaches full speed. It is a model of the
// published figures, so the result is shown as an estimate next to the wiki's own 10 Gm time.
export function travelTime(drive, meters) {
  if (!drive || !(meters > 0)) return null;
  const { speed: v, engage: e, a1, a2 } = drive;
  const half = meters / 2;
  const d1 = (e * e) / (2 * a1), t1 = e / a1;
  let accel, peak, dAccel;
  if (half <= d1) { accel = Math.sqrt((2 * half) / a1); peak = a1 * accel; dAccel = half; }
  else {
    const d2full = (v * v - e * e) / (2 * a2);
    if (half - d1 <= d2full) {
      const rem = half - d1;
      const t2 = (-e + Math.sqrt(e * e + 2 * a2 * rem)) / a2;
      accel = t1 + t2; peak = e + a2 * t2; dAccel = half;
    } else { accel = t1 + (v - e) / a2; peak = v; dAccel = d1 + d2full; }
  }
  const cruise = Math.max(0, meters - 2 * dAccel) / v;
  const travel = 2 * accel + cruise;
  return { travel, spool: drive.spool, cooldown: drive.cooldown, total: travel + (drive.spool || 0), peak, reachedMax: peak >= v - 1, cruise };
}

export const fmtTime = (s) => {
  if (s == null || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60), r = Math.round(s - m * 60);
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${Math.round(s * 10) / 10}s`;
};
