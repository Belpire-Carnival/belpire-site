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
//   GET    /api/companion/inbox      (signed-in page)   → { events: [...] }
//   POST   /api/companion/inbox/ack  (signed-in page)   { keys: ["dev:eid", ...] }
//
// Only a hash of each device token is stored. A token can only add events to its own owner's inbox; it cannot read the
// profile or anything else. Event kinds are a short allow-list and every value is trimmed to plain, short text or numbers.

import { readCompanionSession } from './companion.js';

const PAIR_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_CODES = 5;
const MAX_DEVICES = 8;
const MAX_INBOX = 2000;
const MAX_BATCH = 100;
const MAX_BODY = 64 * 1024;
// Crockford base32: exactly 32 symbols (so a 5-bit mask picks one with no bias), without I, L, O or U.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const EVENT_KINDS = new Set(['blueprint', 'contract_accepted', 'mission_end', 'vehicle_destroyed', 'incapacitated']);
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
