// Objectives for the Plan hub: things you are working towards. Two kinds:
//   unlock  - get a blueprint (done when an Item Fabricator scan shows you own it, or when you tick it)
//   gather  - collect the materials for a craft (a list of items, each with how many you need and how many you have)
// Pure functions, no page access, so they can be tested. Stored under arsenal.plan.obj by plan-ui.js.
import { keyOf } from './plan-core.js';

export const MAX_OBJ = 60;
export const MAX_ITEMS = 40;
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null; };
const r3 = (n) => Math.round(n * 1000) / 1000;
const uid = (now) => `o-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function cleanItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clip(raw.name, 80); if (!name) return null;
  const need = num(raw.need, 0.001, 100000);
  return { name, group: clip(raw.group, 60), unit: raw.unit === 'SCU' ? 'SCU' : 'units', need: need == null ? 1 : r3(need), have: r3(num(raw.have, 0, 100000) ?? 0), minq: num(raw.minq, 0, 1000) };
}

export function cleanObjective(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'gather' ? 'gather' : raw.kind === 'unlock' ? 'unlock' : null;
  const name = clip(raw.name, 80); if (!kind || !name) return null;
  const o = { id: clip(raw.id, 40) || uid(Date.now()), kind, name, bpId: clip(raw.bpId, 60), crafts: Math.max(1, Math.min(999, Math.floor(Number(raw.crafts)) || 1)),
    done: !!raw.done, note: clip(raw.note, 200), at: Number.isFinite(raw.at) ? raw.at : null, items: [] };
  if (kind === 'gather') o.items = (Array.isArray(raw.items) ? raw.items : []).map(cleanItem).filter(Boolean).slice(0, MAX_ITEMS);
  return o;
}
export const cleanObjectives = (list) => (Array.isArray(list) ? list.map(cleanObjective).filter(Boolean).slice(0, MAX_OBJ) : []);

export function addUnlock(list, { name, bpId = '', note = '' }, now = Date.now()) {
  const cur = cleanObjectives(list);
  const o = cleanObjective({ kind: 'unlock', name, bpId, note, at: now, id: uid(now) });
  if (!o || cur.some((x) => x.kind === 'unlock' && keyOf(x.name) === keyOf(o.name))) return cur;
  return [...cur, o].slice(0, MAX_OBJ);
}

// The Fabricator's shopping list becomes a gather objective. The same blueprint replaces its earlier one, keeping what you had collected.
export function addGather(list, { bp, crafts = 1, materials = [] }, now = Date.now()) {
  const cur = cleanObjectives(list);
  const items = (Array.isArray(materials) ? materials : []).map((m) => cleanItem({ name: m.name, group: m.group, unit: m.scu != null ? 'SCU' : 'units', need: m.scu ?? m.qty ?? 1, minq: m.minq })).filter(Boolean);
  const o = cleanObjective({ kind: 'gather', name: bp?.name, bpId: bp?.id, crafts, items, at: now, id: uid(now) });
  if (!o || !o.items.length) return cur;
  const prev = cur.find((x) => x.kind === 'gather' && x.bpId && x.bpId === o.bpId);
  if (prev) { for (const it of o.items) { const old = prev.items.find((p) => keyOf(p.name) === keyOf(it.name)); if (old) it.have = Math.min(old.have, it.need); } o.id = prev.id; o.at = prev.at ?? now; }
  return [...cur.filter((x) => x !== prev), o].slice(0, MAX_OBJ);
}

export const setHave = (list, id, idx, value) => cleanObjectives(list).map((o) => (o.id !== id || !o.items[idx] ? o
  : { ...o, done: false, items: o.items.map((it, i) => (i === idx ? { ...it, have: r3(num(value, 0, 100000) ?? 0) } : it)) }));
export const setDone = (list, id, done) => cleanObjectives(list).map((o) => (o.id === id ? { ...o, done: !!done } : o));
export const removeObjective = (list, id) => cleanObjectives(list).filter((o) => o.id !== id);

// Progress as 0..1, whether it is done, and a short label. `bp` is the stored owned-blueprint state (plan-core cleanBp).
export function progress(o, bp) {
  if (o.kind === 'unlock') {
    const owned = !!(bp && bp.owned && bp.owned[keyOf(o.name)]);
    const done = o.done || owned;
    return { frac: done ? 1 : 0, done, label: owned ? 'Owned (seen in your scan)' : o.done ? 'Done' : 'Not unlocked yet' };
  }
  const items = o.items;
  if (!items.length) return { frac: o.done ? 1 : 0, done: o.done, label: o.done ? 'Done' : 'No materials listed' };
  const frac = items.reduce((s, it) => s + Math.min(1, it.have / it.need), 0) / items.length;
  const full = items.filter((it) => it.have >= it.need).length;
  return { frac: o.done ? 1 : frac, done: o.done || full === items.length, label: `${full} of ${items.length} materials ready` };
}

// Open objectives first, closest to done first, then oldest. Finished ones go last.
export function sortObjectives(list, bp) {
  return cleanObjectives(list).map((o) => ({ o, p: progress(o, bp) }))
    .sort((a, b) => a.p.done - b.p.done || b.p.frac - a.p.frac || (a.o.at || 0) - (b.o.at || 0)).map((x) => x.o);
}
export function nextObjective(list, bp) {
  const o = sortObjectives(list, bp).find((x) => !progress(x, bp).done);
  return o ? { objective: o, ...progress(o, bp) } : null;
}
export const openCount = (list, bp) => cleanObjectives(list).filter((o) => !progress(o, bp).done).length;
