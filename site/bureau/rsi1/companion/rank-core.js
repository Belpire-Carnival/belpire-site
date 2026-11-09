// Weapon rankings by time to kill, for the Ballistics Matrix. Pure maths, no DOM; tested in worker/test/rankings.test.mjs.
// FPS weapons are scored against an armor class with the same ttk() the matrix above uses. Ship guns are scored against a
// reference ship: its hull plus the shields it carries, at each gun's burst and sustained damage per second.
import C from './core.js';
import { totals } from './builder-core.js';

export const ARMOR = ['NONE', 'LIGHT', 'MEDIUM', 'HEAVY'];
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// Physical, Energy or Mixed, by which damage type a hit mostly carries. Beams and the like with only one type are clear-cut.
export function damageClass(phys, energy) {
  const p = num(phys), e = num(energy);
  if (p <= 0 && e <= 0) return 'Unknown';
  if (e > 0 && p <= 0) return 'Energy';
  if (p > 0 && e <= 0) return 'Physical';
  const share = e / (p + e);
  return share >= 0.65 ? 'Energy' : share <= 0.35 ? 'Physical' : 'Mixed';
}

// The weapon type a player would name: Rifle, SMG, Pistol, Shotgun, Sniper, LMG, Railgun, Rocket Launcher, Grenade Launcher...
// The wiki's sub-type is often a size word (Small, Medium, Large) for the heavy weapons, so the weapon's own name decides
// for those; otherwise the wiki's sub-type is used, then a word in the name, then "Other".
const SIZE_WORDS = new Set(['small', 'medium', 'large', 'unknown', 'none', '']);
const NAME_TYPES = [
  [/rail\s*gun/i, 'Railgun'], [/grenade\s*launcher/i, 'Grenade Launcher'], [/(rocket|missile)\s*launcher|boomtube/i, 'Rocket Launcher'],
  [/launcher/i, 'Launcher'], [/shotgun/i, 'Shotgun'], [/sniper/i, 'Sniper'], [/\blmg\b|light machine/i, 'LMG'], [/\bsmg\b|submachine/i, 'SMG'],
  [/pistol|sidearm/i, 'Pistol'], [/rifle/i, 'Rifle']
];
export function weaponType(w) {
  const name = String(w?.name || '');
  const heavy = NAME_TYPES.slice(0, 4).find(([re]) => re.test(name));
  if (heavy) return heavy[1];
  const sub = String(w?.sub || w?.kind || '').trim();
  if (!SIZE_WORDS.has(sub.toLowerCase())) return sub;
  const hit = NAME_TYPES.find(([re]) => re.test(name));
  return hit ? hit[1] : 'Other';
}

// The distinct weapon types in a list, for the drop-down, alphabetical with "Other" last.
export function weaponTypes(weapons) {
  const set = new Set((Array.isArray(weapons) ? weapons : []).map(weaponType));
  return [...set].sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
}

// ------------------------------------------------------------------ FPS weapons
// One weapon against one target { hp, armor: { phys, energy } }. `sustained` counts burst cooldowns and the reload time
// the player supplies (the game data has no reload time); `burst` is raw cyclic fire with neither.
export function fpsRow(w, target, opts = {}) {
  const s = w?.wpn;
  if (!s) return null;
  const hp = num(target?.hp) > 0 ? num(target.hp) : 100;
  const armor = { phys: target?.armor?.phys ?? 1, energy: target?.armor?.energy ?? 1 };
  const zone = num(opts.zone) > 0 ? num(opts.zone) : 1;
  const sustained = C.ttk({ ...s, reload: num(opts.reload) }, hp, armor, zone);
  if (!sustained) return null;
  const burst = C.ttk({ ...s, mode: 'AUTO', cooldown: 0, reload: 0 }, hp, armor, zone);
  return {
    id: w.id, name: w.name, mfr: w.mfr, type: weaponType(w), cls: damageClass(s.phys, s.energy),
    dmg: sustained.dmg, shots: sustained.shots, reloads: sustained.reloads,
    ttk: sustained.ttk, ttkBurst: burst ? burst.ttk : sustained.ttk,
    dps: num(s.rpm) > 0 ? sustained.dmg * num(s.rpm) / 60 : null
  };
}

// Every weapon, fastest kill first. `skipped` counts weapons with no damage or no rate of fire in the data.
export function rankFps(weapons, target, opts = {}) {
  const rows = [];
  let skipped = 0;
  for (const w of Array.isArray(weapons) ? weapons : []) {
    const r = fpsRow(w, target, opts);
    if (r) rows.push(r); else skipped++;
  }
  rows.sort((a, b) => a.ttk - b.ttk || a.name.localeCompare(b.name));
  return { rows, skipped };
}

// ------------------------------------------------------------------ ship guns
// Hull plus the shields the ship carries from the factory. Null when the data has no hull figure for it.
export function shipEhp(ship, partsById) {
  const hull = num(ship?.stats?.hull);
  if (hull <= 0) return null;
  let shield = 0;
  try { shield = num(totals(ship, partsById, {}).shieldHp); } catch { shield = 0; }
  return { hull, shield, ehp: hull + shield };
}

// Damage type of a ship gun, read from the per-type figures in its data sheet (`x`): the keys that name physical, energy
// or distortion damage. "Unknown" when the sheet has none.
export function shipDamageClass(part) {
  const sum = { physical: 0, energy: 0, distortion: 0 };
  for (const [k, v] of Object.entries(part?.x || {})) {
    const key = k.toLowerCase();
    if (!key.includes('damage') || typeof v !== 'number' || !(v > 0)) continue;
    for (const t of Object.keys(sum)) if (key.includes(t)) sum[t] += v;
  }
  const total = sum.physical + sum.energy + sum.distortion;
  if (!total) return 'Unknown';
  if (sum.distortion / total >= 0.5) return 'Distortion';
  return damageClass(sum.physical, sum.energy);
}

export function shipGunRow(part, ehp) {
  const w = part?.wpn;
  if (!w || !(ehp > 0)) return null;
  const sus = num(w.sustained), bur = num(w.burst);
  if (sus <= 0 && bur <= 0) return null;
  return {
    id: part.id, name: part.name, mfr: part.mfr, size: part.size, grade: part.grade,
    cls: shipDamageClass(part), burst: bur || null, sustained: sus || null, alpha: num(w.alpha) || null, range: num(w.range) || null,
    ttk: (sus || bur) > 0 ? ehp / (sus || bur) : null, ttkBurst: bur > 0 ? ehp / bur : null
  };
}

// Every gun that fits the filters, fastest kill first. minRange keeps guns whose range is at least that many metres;
// guns with no range in the data are left out while a minimum is set, and counted in `noRange`.
export function rankShipGuns(parts, ehp, opts = {}) {
  const min = Math.max(0, num(opts.minRange));
  const rows = [];
  let noRange = 0;
  for (const p of Array.isArray(parts) ? parts : []) {
    if (p?.type !== 'WeaponGun') continue;
    const r = shipGunRow(p, ehp);
    if (!r || r.ttk == null) continue;
    if (opts.size != null && opts.size !== '' && r.size !== Number(opts.size)) continue;
    if (min > 0) { if (r.range == null) { noRange++; continue; } if (r.range < min) continue; }
    rows.push(r);
  }
  rows.sort((a, b) => a.ttk - b.ttk || a.name.localeCompare(b.name));
  return { rows, noRange };
}

// ------------------------------------------------------------------ lists
export const topOverall = (rows, n = 20) => rows.slice(0, n);

// The best `n` of each group, groups ordered by their best row. keyFn names the group (weapon type, gun size).
export function topByGroup(rows, keyFn, n = 10) {
  const groups = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!groups.has(k)) groups.set(k, []);
    if (groups.get(k).length < n) groups.get(k).push(r);
  }
  return [...groups].map(([key, list]) => ({ key, rows: list })).sort((a, b) => a.rows[0].ttk - b.rows[0].ttk || String(a.key).localeCompare(String(b.key)));
}

// The best `n` for each damage class that has any rows: Physical and Energy (Mixed and Distortion are shown when present).
export function topByClass(rows, n = 10) {
  const order = ['Physical', 'Energy', 'Mixed', 'Distortion', 'Unknown'];
  return order.map((key) => ({ key, rows: rows.filter((r) => r.cls === key).slice(0, n) })).filter((g) => g.rows.length);
}
