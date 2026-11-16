// OmniGlass Desktop events → what the page keeps (pure, no DOM). The desktop app reads the game's own log and sends short
// events to the signed-in person's inbox; this turns them into owned blueprints and a short "recent from the game" feed.
// Nothing here trusts the event beyond plain text and numbers: names are clipped and run through the same cleaners the
// Blueprints pane uses.

import { cleanBp, addOwned, keyOf } from './plan-core.js';

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
    case 'mission_end': { const t = firstText(d, ['title', 'name']); return `Mission ended${t ? `: ${t}` : ''}`; }
    case 'vehicle_destroyed': { const v = firstText(d, ['vehicle', 'ship', 'name']); return `${d.ownShip === true ? 'Your ship was destroyed' : d.ownKill === true ? 'You destroyed a ship' : 'Ship destroyed'}${v ? `: ${v}` : ''}`; }
    case 'incapacitated': return 'You were incapacitated';
    default: return '';
  }
}

// events: what GET /api/companion/inbox returned ({ dev, id, kind, at, data }).
// → { bp, feed, added, keys }: the new blueprint state, the new feed (newest first, capped), how many blueprints were new
// to the list, and every event key to acknowledge (including ones the page has no wording for, so they do not pile up).
export function applyInbox(events, bpRaw, feedRaw, now = Date.now()) {
  let bp = cleanBp(bpRaw);
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
    const text = describeEvent(e);
    if (!text) continue;
    seen.add(k);
    feed.push({ k, kind: clip(e.kind, 30), at, text });
  }
  feed.sort((a, b) => b.at - a.at);
  return { bp, feed: feed.slice(0, MAX_FEED), added, keys };
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
