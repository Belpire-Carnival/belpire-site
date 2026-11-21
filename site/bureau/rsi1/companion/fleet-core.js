// Fleet manager for the Hangar hub: a role, crew and saved builds for each ship you own, a fleet overview, and a group fleet
// you build by pasting share codes from other players. Pure functions, no page access, so they can be tested.
// The ships themselves live in the Hangar (arsenal.fleet); this plan sits beside them under arsenal.fleet.plan, and the
// group fleet under arsenal.fleet.group. Both ride the profile sync like every other "arsenal.*" key.
import { STAT_KEYS } from './builder-core.js';

export const ROLES = ['Combat', 'Cargo / hauling', 'Mining', 'Salvage', 'Exploration', 'Medical', 'Refuel / repair', 'Transport', 'Racing', 'Support'];
export const STATUSES = ['Active', 'Standby', 'Stored'];
export const MAX_CREW = 16;
export const MAX_BUILDS = 6;
export const MAX_SHIPS = 60;
export const MAX_MEMBERS = 12;
export const CODE_PREFIX = 'SCF1.';
export const MAX_CODE = 24000;

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export const keyOf = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const CODE_RE = /^[A-Za-z0-9_-]{1,3000}$/;

// A build code can be pasted bare, or as a whole Hangar link that carries ?b=<code>.
export function parseBuildCode(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/[?&]b=([A-Za-z0-9_-]{1,3000})/);
  const code = m ? m[1] : s;
  return CODE_RE.test(code) ? code : '';
}

export function cleanShipPlan(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const crew = (Array.isArray(r.crew) ? r.crew : []).map((c) => (c && typeof c === 'object' ? { name: clip(c.name, 40), seat: clip(c.seat, 30) } : null)).filter((c) => c && c.name).slice(0, MAX_CREW);
  const builds = (Array.isArray(r.builds) ? r.builds : []).map((b) => (b && typeof b === 'object' && CODE_RE.test(String(b.code)) ? { label: clip(b.label, 40) || 'Build', code: String(b.code) } : null)).filter(Boolean).slice(0, MAX_BUILDS);
  const active = Number.isInteger(r.active) && r.active >= 0 && r.active < builds.length ? r.active : 0;
  return { role: ROLES.includes(r.role) ? r.role : '', status: STATUSES.includes(r.status) ? r.status : 'Active', crew, builds, active, note: clip(r.note, 200) };
}

// The whole plan: ship name key -> plan. Unknown shapes become an empty plan.
export function cleanPlan(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = keyOf(k); if (!key || Object.keys(out).length >= MAX_SHIPS * 2) continue;
    out[key] = cleanShipPlan(v);
  }
  return out;
}

export const planFor = (plan, name) => cleanShipPlan((plan || {})[keyOf(name)]);
const put = (plan, name, patch) => ({ ...cleanPlan(plan), [keyOf(name)]: cleanShipPlan({ ...planFor(plan, name), ...patch }) });

export const setRole = (plan, name, role) => put(plan, name, { role });
export const setStatus = (plan, name, status) => put(plan, name, { status });
export const setNote = (plan, name, note) => put(plan, name, { note });
export function addCrew(plan, name, person, seat = '') {
  const cur = planFor(plan, name); const who = clip(person, 40); if (!who) return cleanPlan(plan);
  if (cur.crew.some((c) => keyOf(c.name) === keyOf(who) && keyOf(c.seat) === keyOf(seat))) return cleanPlan(plan);
  return put(plan, name, { crew: [...cur.crew, { name: who, seat }] });
}
export const removeCrew = (plan, name, i) => put(plan, name, { crew: planFor(plan, name).crew.filter((_, j) => j !== i) });
export function addBuild(plan, name, label, codeText) {
  const code = parseBuildCode(codeText); if (!code) return cleanPlan(plan);
  const cur = planFor(plan, name);
  const builds = [...cur.builds.filter((b) => b.code !== code), { label: clip(label, 40) || 'Build', code }].slice(-MAX_BUILDS);
  return put(plan, name, { builds, active: builds.length - 1 });
}
export function removeBuild(plan, name, i) {
  const cur = planFor(plan, name); const builds = cur.builds.filter((_, j) => j !== i);
  return put(plan, name, { builds, active: Math.min(cur.active, Math.max(0, builds.length - 1)) });
}
export const setActiveBuild = (plan, name, i) => put(plan, name, { active: i });
export const activeBuild = (plan, name) => { const p = planFor(plan, name); return p.builds[p.active] || null; };

// Drop plans for ships that left the hangar.
export const pruneFor = (plan, fleet) => {
  const keep = new Set((fleet || []).map((s) => keyOf(s.name)));
  return Object.fromEntries(Object.entries(cleanPlan(plan)).filter(([k]) => keep.has(k)));
};

// ---- overview ----
const val = (s, k) => num(s?.stats?.[k] ?? (k === 'max' ? s?.nav : s?.[k]));
const sum = (arr, k) => arr.reduce((t, s) => t + (val(s, k) || 0), 0);

// Totals for a list of ships (each { name, role?, stats? }). Ships with no stat sheet count as ships but add no figures.
export function totals(ships) {
  const list = Array.isArray(ships) ? ships : [];
  const detailed = list.filter((s) => s?.stats && Object.keys(s.stats).length).length;
  return { ships: list.length, detailed, cargo: sum(list, 'cargo'), dps: sum(list, 'burst'), hull: sum(list, 'hull'), shield: sum(list, 'shieldHp'), crewMax: sum(list, 'crew') };
}

export function overview(fleet, plan) {
  const ships = (Array.isArray(fleet) ? fleet : []).map((s) => ({ ...s, plan: planFor(plan, s.name) }));
  const byRole = {}; let unassigned = 0, crewAssigned = 0, understaffed = [];
  const people = new Set();
  for (const s of ships) {
    const r = s.plan.role || ''; if (r) (byRole[r] ||= []).push(s.name); else unassigned++;
    crewAssigned += s.plan.crew.length; for (const c of s.plan.crew) people.add(keyOf(c.name));
    const max = val(s, 'crew');
    if (s.plan.status === 'Active' && max && s.plan.crew.length === 0) understaffed.push(s.name);
  }
  const byStatus = Object.fromEntries(STATUSES.map((t) => [t, ships.filter((s) => s.plan.status === t).length]));
  return { ...totals(ships), byRole, byStatus, unassigned, crewAssigned, people: people.size, noCrew: understaffed };
}

// ---- group fleet (share codes) ----
const toB64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64 = (b64) => { const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); };

function cleanMemberShip(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clip(raw.name, 60); if (!name) return null;
  const s = { name, role: ROLES.includes(raw.role) ? raw.role : '', status: STATUSES.includes(raw.status) ? raw.status : 'Active' };
  if (raw.stats && typeof raw.stats === 'object') { s.stats = {}; for (const k of STAT_KEYS) { const v = num(raw.stats[k]); if (v != null) s.stats[k] = v; } }
  return s;
}
export function cleanMember(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const who = clip(raw.who, 40); if (!who) return null;
  return { who, at: Number.isFinite(raw.at) ? raw.at : null, ships: (Array.isArray(raw.ships) ? raw.ships : []).map(cleanMemberShip).filter(Boolean).slice(0, MAX_SHIPS) };
}
export const cleanGroup = (list) => (Array.isArray(list) ? list.map(cleanMember).filter(Boolean).slice(0, MAX_MEMBERS) : []);

// Your own fleet as a share code. Only names, roles, status and numbers go in; no pictures, crew names or notes.
export function encodeFleet(fleet, plan, who, now = Date.now()) {
  const ships = (Array.isArray(fleet) ? fleet : []).map((s) => { const p = planFor(plan, s.name); return { name: s.name, role: p.role, status: p.status, stats: s.stats }; });
  const m = cleanMember({ who, at: now, ships });
  return m ? CODE_PREFIX + toB64(JSON.stringify(m)) : '';
}
export function decodeFleet(code) {
  const s = String(code ?? '').trim();
  if (!s.startsWith(CODE_PREFIX) || s.length > MAX_CODE) return null;
  try { return cleanMember(JSON.parse(fromB64(s.slice(CODE_PREFIX.length)))); } catch { return null; }
}
// A member with the same name replaces their earlier list.
export const mergeMember = (group, member) => {
  const m = cleanMember(member); if (!m) return cleanGroup(group);
  return [...cleanGroup(group).filter((x) => keyOf(x.who) !== keyOf(m.who)), m].slice(-MAX_MEMBERS);
};
export const removeMember = (group, who) => cleanGroup(group).filter((x) => keyOf(x.who) !== keyOf(who));

export function groupOverview(group, mine = null) {
  const members = cleanGroup(group); const all = members.flatMap((m) => m.ships.map((s) => ({ ...s, owner: m.who })));
  if (mine) all.push(...mine.ships.map((s) => ({ ...s, owner: mine.who })));
  const byRole = {}; for (const s of all) { const r = s.role || 'No role'; byRole[r] = (byRole[r] || 0) + 1; }
  const byMember = {}; for (const s of all) byMember[s.owner] = (byMember[s.owner] || 0) + 1;
  return { ...totals(all), byRole, byMember, members: Object.keys(byMember).length };
}
