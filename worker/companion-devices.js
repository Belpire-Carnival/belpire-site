// OmniGlass Desktop pairing and event inbox (bureau.belpire.com).
//
// The desktop app never writes the saved profile. The browser stays the only writer of that (compare-and-swap in
// companion.js), so the app cannot overwrite a newer save. Instead the app drops small events into an inbox that belongs
// to the signed-in person; the page picks them up when it loads, applies them to its own saved data, and acknowledges them.
//
//   POST   /api/companion/pair/new   (signed-in page)   → { code, expiresIn }       a one-time pairing code, 10 minutes
//   POST   /api/companion/pair       (desktop app)      { code, name } → { token, deviceId }
//   GET    /api/companion/devices    (signed-in page)   → { devices: [...] }
//   DELETE /api/companion/devices?id=…  (signed-in page) revoke a device and drop its waiting events
//   POST   /api/companion/inbox      (desktop app, Bearer token) { events: [...] } → { accepted }
//   POST   /api/companion/wishlist   (desktop app, Bearer token) → { wishlist: [{ n, prio }], at }   only the names of Blueprint wishlist items not yet received
//   POST   /api/companion/state      (desktop app, Bearer token) → { owned: [names], ranks: { ladderId: { rank, at } }, wishlist, at }   for two-way sync
//   GET    /api/companion/inbox      (signed-in page)   → { events: [...] }
//   POST   /api/companion/inbox/ack  (signed-in page)   { keys: ["dev:eid", ...] }
//
// Only a hash of each device token is stored. A token can add events to its own owner's inbox and read ONE thing back: the
// names of the owner's Blueprint wishlist items that are not received yet (no notes, no other profile data). Event kinds are a short allow-list and every value is trimmed to plain, short text or numbers.

import { readCompanionSession, profileStore } from './companion.js';

const PAIR_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_CODES = 5;
const MAX_DEVICES = 8;
const MAX_INBOX = 2000;
const MAX_BATCH = 100;
const MAX_BODY = 64 * 1024;
// Crockford base32: exactly 32 symbols (so a 5-bit mask picks one with no bias), without I, L, O or U.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const EVENT_KINDS = new Set(['blueprint', 'contract_accepted', 'mission_end', 'vehicle_destroyed', 'incapacitated', 'owned_set', 'rank_set']);
export const MAX_OWNED_SET = 100; // names in one owned_set event
const TOKEN_PREFIX = 'ogd_';

const enc = new TextEncoder();
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const sameOrigin = (request) => request.headers.get('Origin') === new URL(request.url).origin;

async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b & 31];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
// Typed codes: any case, any dashes or spaces; O reads as 0 and I or L as 1, the way Crockford base32 does.
export const normalCode = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
export const newToken = () => TOKEN_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(32)));

// ------------------------------------------------------------ store

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS companion_pair (code_hash TEXT PRIMARY KEY, uid TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS companion_devices (id TEXT PRIMARY KEY, uid TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, last_seen INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS companion_inbox (uid TEXT NOT NULL, dev TEXT NOT NULL, eid TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (uid, dev, eid))`
];
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, Promise.all(SCHEMA.map((s) => db.prepare(s).run())));
  await ready.get(db);
}

export function deviceStore(db) {
  const q = async (sql, ...args) => { await ensure(db); return db.prepare(sql).bind(...args); };
  return {
    async addCode(uid, codeHash, expires, now) {
      await (await q('DELETE FROM companion_pair WHERE expires < ?', now)).run();
      const n = await (await q('SELECT COUNT(*) AS n FROM companion_pair WHERE uid = ?', uid)).first();
      if ((n?.n || 0) >= MAX_PENDING_CODES) return false;
      await (await q('INSERT INTO companion_pair (code_hash, uid, expires) VALUES (?, ?, ?)', codeHash, uid, expires)).run();
      return true;
    },
    // Single use: look the code up, then delete it; only one caller can win the delete.
    async takeCode(codeHash, now) {
      const row = await (await q('SELECT uid, expires FROM companion_pair WHERE code_hash = ?', codeHash)).first();
      if (!row) return null;
      const r = await (await q('DELETE FROM companion_pair WHERE code_hash = ?', codeHash)).run();
      return r.meta.changes > 0 && row.expires >= now ? row.uid : null;
    },
    async countDevices(uid) {
      return (await (await q('SELECT COUNT(*) AS n FROM companion_devices WHERE uid = ?', uid)).first())?.n || 0;
    },
    async addDevice(id, uid, name, tokenHash, now) {
      await (await q('INSERT INTO companion_devices (id, uid, name, token_hash, created, last_seen) VALUES (?, ?, ?, ?, ?, ?)', id, uid, name, tokenHash, now, now)).run();
    },
    async byToken(tokenHash) {
      return (await q('SELECT id, uid, name FROM companion_devices WHERE token_hash = ?', tokenHash)).first();
    },
    async touch(id, now) {
      await (await q('UPDATE companion_devices SET last_seen = ? WHERE id = ?', now, id)).run();
    },
    async list(uid) {
      const stmt = await q(
        `SELECT d.id, d.name, d.created, d.last_seen, (SELECT COUNT(*) FROM companion_inbox i WHERE i.uid = d.uid AND i.dev = d.id) AS waiting
         FROM companion_devices d WHERE d.uid = ? ORDER BY d.created`, uid);
      return (await stmt.all()).results;
    },
    async revoke(uid, id) {
      const r = await (await q('DELETE FROM companion_devices WHERE uid = ? AND id = ?', uid, id)).run();
      if (r.meta.changes > 0) await (await q('DELETE FROM companion_inbox WHERE uid = ? AND dev = ?', uid, id)).run();
      return r.meta.changes > 0;
    },
    async inboxSize(uid) {
      return (await (await q('SELECT COUNT(*) AS n FROM companion_inbox WHERE uid = ?', uid)).first())?.n || 0;
    },
    async addEvent(uid, dev, eid, kind, data, at) {
      const r = await (await q('INSERT INTO companion_inbox (uid, dev, eid, kind, data, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (uid, dev, eid) DO NOTHING', uid, dev, eid, kind, data, at)).run();
      return r.meta.changes > 0;
    },
    async events(uid, limit) {
      const stmt = await q('SELECT dev, eid, kind, data, at FROM companion_inbox WHERE uid = ? ORDER BY at, dev, eid LIMIT ?', uid, limit);
      return (await stmt.all()).results;
    },
    async ack(uid, dev, eid) {
      await (await q('DELETE FROM companion_inbox WHERE uid = ? AND dev = ? AND eid = ?', uid, dev, eid)).run();
    }
  };
}

// ------------------------------------------------------------ cleaning

const clipText = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const ID = /^[A-Za-z0-9._:-]{1,64}$/;

// One event as the app sent it → { eid, kind, at, data } or null. Values are short text, numbers or booleans only.
export function cleanEvent(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const eid = String(raw.id ?? '');
  if (!ID.test(eid) || !EVENT_KINDS.has(raw.kind)) return null;
  const data = {};
  const src = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
  for (const [k, v] of Object.entries(src).slice(0, 12)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(k)) continue;
    if (typeof v === 'string') data[k] = clipText(v, 120);
    else if (typeof v === 'number' && Number.isFinite(v)) data[k] = v;
    else if (typeof v === 'boolean') data[k] = v;
  }
  if (raw.kind === 'blueprint' && !clipText(data.name, 80)) return null;
  // owned_set: a batch of blueprint names the app knows you own (from the log, older logs, imports). The only list a value may be.
  if (raw.kind === 'owned_set') {
    const names = [];
    for (const n of Array.isArray(src.names) ? src.names.slice(0, MAX_OWNED_SET) : []) { const c = typeof n === 'string' ? clipText(n, 80) : ''; if (c && !names.includes(c)) names.push(c); }
    if (!names.length) return null;
    for (const k of Object.keys(data)) delete data[k];
    data.names = names;
  }
  // rank_set: the rank chosen on one reputation ladder (an empty rank means "not set"), and when it was chosen.
  if (raw.kind === 'rank_set' && (!/^[A-Za-z0-9_.|-]{1,120}$/.test(String(data.ladder || '')) || typeof data.rank !== 'string')) return null;
  const at = Number.isFinite(raw.at) ? Math.min(Math.max(raw.at, 0), now + 86_400_000) : now;
  return { eid, kind: raw.kind, at, data };
}

async function readJson(request, max) {
  if (Number(request.headers.get('Content-Length')) > max) return { error: 'too_large' };
  try {
    const text = await request.text();
    if (enc.encode(text).length > max) return { error: 'too_large' };
    return { body: JSON.parse(text) };
  } catch {
    return { error: 'bad_request' };
  }
}

// The blueprint names on a saved profile's wishlist (the page keeps them under "arsenal.plan.wish"): not received yet,
// most wanted first (priority 1 is highest), plain short text only. Everything else in the profile stays unreadable to the app.
export const MAX_WISHLIST = 50;
export function wishlistFrom(data) {
  let list; try { list = JSON.parse(data && data['arsenal.plan.wish']); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const w of list) {
    if (!w || typeof w !== 'object' || w.kind !== 'Blueprint' || w.got === true || typeof w.name !== 'string') continue;
    const n = w.name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
    if (n) out.push({ n, prio: [1, 2, 3].includes(Number(w.prio)) ? Number(w.prio) : 2 });
  }
  return out.sort((a, b) => a.prio - b.prio || a.n.localeCompare(b.n)).slice(0, MAX_WISHLIST);
}

// What the app may read back for two-way sync, besides the wishlist: the names of blueprints you own and the rank you chose on
// each reputation ladder. Nothing else in the profile is readable with an app token.
export const MAX_OWNED_READ = 1500;
const parseKey = (data, key) => { try { return JSON.parse(data && data[key]); } catch { return null; } };
export function ownedFrom(data) {
  const bp = parseKey(data, 'arsenal.plan.bp');
  const out = [];
  for (const v of Object.values(bp && typeof bp.owned === 'object' && bp.owned ? bp.owned : {})) {
    const n = v && typeof v.name === 'string' ? clipText(v.name, 80) : '';
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= MAX_OWNED_READ) break;
  }
  return out.sort((a, b) => a.localeCompare(b));
}
export function ranksFrom(data) {
  const r = parseKey(data, 'arsenal.rep.ranks');
  const out = {};
  for (const [id, v] of Object.entries(r && typeof r === 'object' && !Array.isArray(r) ? r : {}).slice(0, 200)) {
    if (!/^[A-Za-z0-9_.|-]{1,120}$/.test(id) || !v || typeof v !== 'object') continue;
    out[id] = { rank: typeof v.rank === 'string' ? clipText(v.rank, 60) : '', at: Number.isFinite(v.at) ? v.at : 0 };
  }
  return out;
}

const bearer = (request) => {
  const m = /^Bearer (ogd_[A-Za-z0-9_-]{20,80})$/.exec(request.headers.get('Authorization') || '');
  return m ? m[1] : null;
};

// ------------------------------------------------------------ routes

export async function handleDevices(request, env) {
  if (!env.DB || !env.SESSION_SECRET) return json({ error: 'unavailable' }, 503);
  const url = new URL(request.url);
  const path = url.pathname;
  const m = request.method;
  const store = deviceStore(env.DB);
  const now = Date.now();

  // ---- the desktop app: trade a pairing code for a token
  if (path === '/api/companion/pair') {
    if (m !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
    const { body, error } = await readJson(request, 2048);
    if (error) return json({ error }, error === 'too_large' ? 413 : 400);
    const code = normalCode(body && body.code);
    if (code.length !== 8) return json({ error: 'bad_code' }, 400);
    const uid = await store.takeCode(await sha256Hex(code), now);
    if (!uid) return json({ error: 'bad_code' }, 400);
    if ((await store.countDevices(uid)) >= MAX_DEVICES) return json({ error: 'too_many_devices' }, 409);
    const token = newToken();
    const id = b64url(crypto.getRandomValues(new Uint8Array(9)));
    await store.addDevice(id, uid, clipText(body.name, 40) || 'OmniGlass Desktop', await sha256Hex(token), now);
    return json({ token, deviceId: id });
  }

  // ---- the desktop app: drop events into the owner's inbox
  if (path === '/api/companion/inbox' && m === 'POST') {
    const token = bearer(request);
    const dev = token ? await store.byToken(await sha256Hex(token)) : null;
    if (!dev) return json({ error: 'unauthorized' }, 401);
    const { body, error } = await readJson(request, MAX_BODY);
    if (error) return json({ error }, error === 'too_large' ? 413 : 400);
    const list = Array.isArray(body && body.events) ? body.events.slice(0, MAX_BATCH) : null;
    if (!list) return json({ error: 'bad_request' }, 400);
    let size = await store.inboxSize(dev.uid);
    let accepted = 0, rejected = 0;
    for (const raw of list) {
      const ev = cleanEvent(raw, now);
      if (!ev) { rejected++; continue; }
      if (size >= MAX_INBOX) return json({ error: 'inbox_full', accepted, rejected }, 429);
      if (await store.addEvent(dev.uid, dev.id, ev.eid, ev.kind, JSON.stringify(ev.data), ev.at)) { accepted++; size++; }
    }
    await store.touch(dev.id, now);
    return json({ accepted, rejected });
  }

  // ---- the desktop app: read back its owner's blueprint wishlist (names only)
  if (path === '/api/companion/wishlist') {
    if (m !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
    const token = bearer(request);
    const dev = token ? await store.byToken(await sha256Hex(token)) : null;
    if (!dev) return json({ error: 'unauthorized' }, 401);
    const row = await profileStore(env.DB).get(dev.uid);
    await store.touch(dev.id, now);
    let data = null; try { data = row ? JSON.parse(row.data) : null; } catch { /* a damaged profile has no wishlist */ }
    return json({ wishlist: wishlistFrom(data), at: row ? row.updated_at : 0 });
  }

  // ---- the desktop app: read back what two-way sync needs (owned blueprint names, chosen ranks, wishlist names)
  if (path === '/api/companion/state') {
    if (m !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
    const token = bearer(request);
    const dev = token ? await store.byToken(await sha256Hex(token)) : null;
    if (!dev) return json({ error: 'unauthorized' }, 401);
    const row = await profileStore(env.DB).get(dev.uid);
    await store.touch(dev.id, now);
    let data = null; try { data = row ? JSON.parse(row.data) : null; } catch { /* a damaged profile reads as empty */ }
    return json({ owned: ownedFrom(data), ranks: ranksFrom(data), wishlist: wishlistFrom(data), at: row ? row.updated_at : 0 });
  }

  // ---- everything below is the signed-in page
  const session = await readCompanionSession(request, env);
  if (!session) return json({ signedIn: false }, 401);
  const mutating = m !== 'GET' && m !== 'HEAD';
  if (mutating && !sameOrigin(request)) return json({ error: 'forbidden' }, 403);

  if (path === '/api/companion/pair/new') {
    if (m !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
    if ((await store.countDevices(session.uid)) >= MAX_DEVICES) return json({ error: 'too_many_devices' }, 409);
    const code = newCode();
    const ok = await store.addCode(session.uid, await sha256Hex(normalCode(code)), now + PAIR_TTL_MS, now);
    return ok ? json({ code, expiresIn: PAIR_TTL_MS / 1000 }) : json({ error: 'too_many_codes' }, 429);
  }

  if (path === '/api/companion/devices') {
    if (m === 'GET' || m === 'HEAD') {
      const rows = await store.list(session.uid);
      return json({ devices: rows.map((r) => ({ id: r.id, name: r.name, created: r.created, lastSeen: r.last_seen, waiting: r.waiting })) });
    }
    if (m === 'DELETE') {
      const id = url.searchParams.get('id') || '';
      if (!ID.test(id)) return json({ error: 'bad_request' }, 400);
      return (await store.revoke(session.uid, id)) ? json({ ok: true }) : json({ error: 'not_found' }, 404);
    }
    return json({ error: 'method not allowed' }, 405, { Allow: 'GET, HEAD, DELETE' });
  }

  if (path === '/api/companion/inbox' && (m === 'GET' || m === 'HEAD')) {
    const rows = await store.events(session.uid, 500);
    return json({ events: rows.map((r) => ({ dev: r.dev, id: r.eid, kind: r.kind, at: r.at, data: JSON.parse(r.data) })) });
  }
  if (path === '/api/companion/inbox') return json({ error: 'method not allowed' }, 405, { Allow: 'GET, HEAD, POST' });

  if (path === '/api/companion/inbox/ack') {
    if (m !== 'POST') return json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
    const { body, error } = await readJson(request, MAX_BODY);
    if (error) return json({ error }, error === 'too_large' ? 413 : 400);
    const keys = Array.isArray(body && body.keys) ? body.keys.slice(0, 500) : null;
    if (!keys) return json({ error: 'bad_request' }, 400);
    let n = 0;
    for (const k of keys) {
      const i = String(k).indexOf(':');
      const dev = String(k).slice(0, i), eid = String(k).slice(i + 1);
      if (i < 1 || !ID.test(dev) || !ID.test(eid)) continue;
      await store.ack(session.uid, dev, eid);
      n++;
    }
    return json({ ok: true, acked: n });
  }

  return json({ error: 'not found' }, 404);
}
