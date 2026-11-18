// OmniGlass Desktop events → what the page keeps (pure, no DOM). The desktop app reads the game's own log and sends short
// events to the signed-in person's inbox; this turns them into owned blueprints and a short "recent from the game" feed.
// Nothing here trusts the event beyond plain text and numbers: names are clipped and run through the same cleaners the
// Blueprints pane uses.

import { cleanBp, addOwned, keyOf } from './plan-core.js';
import { cleanRanks, mergeRank } from './rep-core.js';

export const MAX_FEED = 100;

const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const evKey = (e) => `${e.dev}:${e.id}`;

const firstText = (d, names) => { for (const n of names) { const t = clip(d && d[n], 80); if (t) return t; } return ''; };

// One line of plain text for the feed, or '' for something the page has no wording for.
export function describeEvent(e) {
  const d = e && e.data && typeof e.data === 'object' ? e.data : {};
  switch (e && e.kind) {
    case 'blueprint': { const n = clip(d.name, 80); return n ? `Blueprint received: ${n}` : ''; }
    case 'contract_accepted': { const t = firstText(d, ['title', 'name']); return `Contract accepted${t ? `: ${t}` : ''}${d.bp === true ? ' (blueprint reward)' : ''}`; }
    case 'mission_end': {
      const t = firstText(d, ['title', 'name']), c = clip(d.completion, 30);
      const head = c === 'Complete' ? 'Contract completed' : c ? `Contract ended (${c})` : 'Mission ended';
      return `${head}${t ? `: ${t}` : ''}`;
    }
    case 'vehicle_destroyed': { const v = firstText(d, ['vehicle', 'ship', 'name']); return `${d.ownShip === true ? 'Your ship was destroyed' : d.ownKill === true ? 'You destroyed a ship' : 'Ship destroyed'}${v ? `: ${v}` : ''}`; }
    case 'incapacitated': return 'You were incapacitated';
    case 'rank_set': { const r = clip(d.rank, 60); return r ? `Rank set in the app: ${r}` : 'Rank cleared in the app'; }
    case 'owned_set': return ''; // a sync batch: the toast says how many were new
    default: return '';
  }
}

// events: what GET /api/companion/inbox returned ({ dev, id, kind, at, data }).
// → { bp, feed, added, keys }: the new blueprint state, the new feed (newest first, capped), how many blueprints were new
// to the list, and every event key to acknowledge (including ones the page has no wording for, so they do not pile up).
export function applyInbox(events, bpRaw, feedRaw, now = Date.now(), contractsRaw = [], ranksRaw = {}) {
  let bp = cleanBp(bpRaw);
  let ranks = cleanRanks(ranksRaw);
  const seen = new Set();
  const feed = [];
  for (const f of Array.isArray(feedRaw) ? feedRaw : []) {
    if (!f || typeof f.k !== 'string' || seen.has(f.k)) continue;
    seen.add(f.k);
    feed.push({ k: f.k, kind: clip(f.kind, 30), at: Number.isFinite(f.at) ? f.at : 0, text: clip(f.text, 200) });
  }
  const keys = [];
  let added = 0;
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e.dev !== 'string' || typeof e.id !== 'string') continue;
    const k = evKey(e);
    keys.push(k);
    if (seen.has(k)) continue;
    const at = Number.isFinite(e.at) ? e.at : now;
    if (e.kind === 'blueprint') {
      const name = clip(e.data && e.data.name, 80);
      if (!name) continue;
      // A blueprint you already own is left exactly as it is (its category and tier came from a fabricator scan).
      if (!bp.owned[keyOf(name)]) { added++; bp = addOwned(bp, name, null, at); }
    }
    // two-way sync from the app: owned names (add-only, never removes) and a rank chosen there (the newer choice wins)
    if (e.kind === 'owned_set') for (const n of Array.isArray(e.data && e.data.names) ? e.data.names.slice(0, 100) : []) {
      const name = clip(n, 80);
      if (name && !bp.owned[keyOf(name)]) { added++; bp = addOwned(bp, name, null, at); }
    }
    if (e.kind === 'rank_set' && e.data) ranks = mergeRank(ranks, e.data.ladder, e.data.rank, Number.isFinite(e.data.at) ? e.data.at : at);
    const text = describeEvent(e);
    if (!text) continue;
    seen.add(k);
    feed.push({ k, kind: clip(e.kind, 30), at, text });
  }
  feed.sort((a, b) => b.at - a.at);
  return { bp, feed: feed.slice(0, MAX_FEED), added, keys, contracts: applyContracts(events, contractsRaw, now), ranks };
}

// ---- Contract history: each contract the app saw, accepted and (once finished) its result. The app sends a mission id
// (`mid`) with both events, so the two are paired; an event without one is kept on its own.
export const MAX_CONTRACTS = 300;
const RESULT = { Complete: 'completed', Fail: 'failed', Failed: 'failed', Abandon: 'abandoned', Abandoned: 'abandoned', Withdraw: 'abandoned' };
export const resultOf = (completion) => { const c = clip(completion, 30); return c ? (RESULT[c] || c.toLowerCase()) : ''; };

export function cleanContracts(raw) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c !== 'object') continue;
    const k = clip(c.k, 80); if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ k, title: clip(c.title, 120), bp: c.bp === true, rep: clip(c.rep, 40), acceptedAt: Number.isFinite(c.acceptedAt) ? c.acceptedAt : null, endedAt: Number.isFinite(c.endedAt) ? c.endedAt : null, result: clip(c.result, 30) });
  }
  return out;
}

export function applyContracts(events, raw, now = Date.now()) {
  const list = cleanContracts(raw);
  const byKey = new Map(list.map((c) => [c.k, c]));
  const sorted = (Array.isArray(events) ? events : []).filter((e) => e && (e.kind === 'contract_accepted' || e.kind === 'mission_end') && typeof e.dev === 'string' && typeof e.id === 'string')
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0));
  for (const e of sorted) {
    const d = e.data && typeof e.data === 'object' ? e.data : {};
    const mid = clip(d.mid, 60);
    const k = mid ? `m:${mid}` : `e:${evKey(e)}`;
    const at = Number.isFinite(e.at) ? e.at : now;
    let c = byKey.get(k);
    if (!c) { c = { k, title: '', bp: false, rep: '', acceptedAt: null, endedAt: null, result: '' }; byKey.set(k, c); list.push(c); }
    const title = firstText(d, ['title', 'name']);
    if (title && !c.title) c.title = title;
    if (e.kind === 'contract_accepted') { if (c.acceptedAt == null) c.acceptedAt = at; if (d.bp === true) c.bp = true; if (!c.rep) c.rep = clip(d.rep, 40); }
    else { c.endedAt = at; c.result = resultOf(d.completion) || 'ended'; }
  }
  const when = (c) => c.endedAt ?? c.acceptedAt ?? 0;
  return list.sort((a, b) => when(b) - when(a)).slice(0, MAX_CONTRACTS);
}

// Counts for the card: completed today and in the last 7 days (local time), and still open.
export function contractStats(list, now = Date.now()) {
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  const today = day.getTime(), week = now - 7 * 86400000;
  let doneToday = 0, doneWeek = 0, done = 0, open = 0;
  for (const c of cleanContracts(list)) {
    if (c.result === 'completed') { done++; if (c.endedAt >= today) doneToday++; if (c.endedAt >= week) doneWeek++; }
    else if (!c.result) open++;
  }
  return { doneToday, doneWeek, done, open };
}

// "3 minutes ago" for the device list and the feed.
export function ago(ms, now = Date.now()) {
  if (!Number.isFinite(ms) || ms <= 0) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
