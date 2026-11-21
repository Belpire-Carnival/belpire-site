// Citizen Arsenal companion accounts (bureau.belpire.com): "Sign in with Discord" and one saved profile per person.
//
//   GET  /auth/login               → state cookie, redirect to Discord (scope: identify only)
//   GET  /auth/callback            → check state, read the Discord user, revoke the grant, set a session cookie
//   POST /auth/logout              → clear the session (204)
//   GET    /api/companion/profile  → { signedIn, name, saved, updatedAt, data }
//   PUT    /api/companion/profile  → { data, base } save; 409 when another device saved first
//   DELETE /api/companion/profile  → forget the saved profile
//
// This is deliberately separate from the belpire.com sign-in (worker/auth.js): its own cookie name and its own
// sealing purpose, so a companion session can never pass for a belpire.com one (that one unlocks the Discord
// invite and member-only pages). Only the Discord ID and display name are kept, plus the data the person saves.
// Sign-in runs as the Adjutant's own Discord application, not the Usher's (that one serves belpire.com).
// Runtime secrets: COMPANION_DISCORD_CLIENT_ID and COMPANION_DISCORD_CLIENT_SECRET (the Adjutant application's
// OAuth2 credentials) and the existing SESSION_SECRET. The Adjutant application needs
// https://bureau.belpire.com/auth/callback as a redirect URI. No bot token is used: OAuth only reads who is signing in.

import { seal, unseal, readCookie, setCookie, clearCookie, b64url } from './auth.js';

const DISCORD_API = 'https://discord.com/api';
const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const COMPANION_COOKIE = '__Host-bureau_session';
const STATE_COOKIE = '__Host-bureau_oauth';
const SESSION_PURPOSE = 'bureau-session';
const STATE_PURPOSE = 'bureau-oauth-state';
const SESSION_TTL = 30 * 24 * 3600;
const STATE_TTL = 600;
const PAGE = '/rsi1/companion/';
const SNOWFLAKE = /^\d{17,20}$/;
export const MAX_PROFILE_BYTES = 1_000_000;
const MAX_KEYS = 60;
const KEY = /^arsenal\.(?!__)[A-Za-z0-9._-]{1,40}$/;
const now = () => Math.floor(Date.now() / 1000);

const enc = new TextEncoder();

export function companionConfig(env) {
  const problems = [];
  if (!SNOWFLAKE.test(String(env.COMPANION_DISCORD_CLIENT_ID || ''))) problems.push('COMPANION_DISCORD_CLIENT_ID');
  if (!env.COMPANION_DISCORD_CLIENT_SECRET) problems.push('COMPANION_DISCORD_CLIENT_SECRET');
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 32) problems.push('SESSION_SECRET');
  return { ok: problems.length === 0, problems };
}

const redirect = (location, cookies = [], status = 302) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status, headers });
};
const back = (status, cookies) => redirect(`${PAGE}?signin=${status}`, cookies);

function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const basicAuth = (env) => 'Basic ' + btoa(`${env.COMPANION_DISCORD_CLIENT_ID}:${env.COMPANION_DISCORD_CLIENT_SECRET}`);
const displayName = (user) => String(user.global_name || user.username || 'Pilot').slice(0, 64);

// ---------------------------------------------------------------- sign-in

async function handleLogin(request, env) {
  if (!companionConfig(env).ok) return back('setup');
  const url = new URL(request.url);
  const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const cookie = await seal({ state, exp: now() + STATE_TTL }, env.SESSION_SECRET, STATE_PURPOSE);
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.COMPANION_DISCORD_CLIENT_ID,
    scope: 'identify',
    state,
    redirect_uri: `${url.origin}/auth/callback`,
    prompt: 'none'
  }).toString();
  return redirect(authorize.toString(), [setCookie(STATE_COOKIE, cookie, STATE_TTL)]);
}

async function handleCallback(request, env, ctx) {
  if (!companionConfig(env).ok) return back('setup');
  const url = new URL(request.url);
  const clearState = clearCookie(STATE_COOKIE);
  if (url.searchParams.get('error')) return back('cancelled', [clearState]);
  const stored = await unseal(readCookie(request, STATE_COOKIE), env.SESSION_SECRET, STATE_PURPOSE);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!stored || !state || !code || stored.exp < now() || !safeEqual(stored.state, state)) return back('expired', [clearState]);

  let tokens;
  try {
    const res = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(env) },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/auth/callback` })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tokens = await res.json();
  } catch (err) {
    console.warn(`Companion sign-in token exchange failed: ${err.message}`);
    return back('error', [clearState]);
  }
  let user = null;
  try {
    const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (res.ok) user = await res.json();
  } catch {
    /* handled below */
  }
  // One look at the account is all we need, so the grant is revoked straight away.
  const revoked = revoke(env, tokens.refresh_token || tokens.access_token, tokens.refresh_token ? 'refresh_token' : 'access_token');
  if (ctx?.waitUntil) ctx.waitUntil(revoked);
  else await revoked;

  if (!user || !SNOWFLAKE.test(String(user.id || '')) || user.bot || user.system) return back('error', [clearState]);
  const t = now();
  const sealed = await seal({ uid: String(user.id), name: displayName(user), iat: t, exp: t + SESSION_TTL }, env.SESSION_SECRET, SESSION_PURPOSE);
  return redirect(`${PAGE}?signin=ok`, [clearState, setCookie(COMPANION_COOKIE, sealed, SESSION_TTL)]);
}

async function revoke(env, token, hint) {
  if (!token) return;
  try {
    await fetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(env) },
      body: new URLSearchParams({ token, token_type_hint: hint })
    });
  } catch {
    /* best effort */
  }
}

export async function readCompanionSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const s = await unseal(readCookie(request, COMPANION_COOKIE), env.SESSION_SECRET, SESSION_PURPOSE);
  return s && s.exp > now() && SNOWFLAKE.test(String(s.uid || '')) ? s : null;
}

const sameOrigin = (request) => request.headers.get('Origin') === new URL(request.url).origin;

export async function handleCompanionAuth(request, env, ctx) {
  const { pathname } = new URL(request.url);
  const isGet = request.method === 'GET' || request.method === 'HEAD';
  if (pathname === '/auth/login') return isGet ? handleLogin(request, env) : new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (pathname === '/auth/callback') return isGet ? handleCallback(request, env, ctx) : new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (pathname === '/auth/logout') {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    if (!sameOrigin(request)) return new Response('Forbidden', { status: 403 });
    return new Response(null, { status: 204, headers: { 'Set-Cookie': clearCookie(COMPANION_COOKIE), 'Cache-Control': 'no-store' } });
  }
  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------- saved profile

const SCHEMA = `CREATE TABLE IF NOT EXISTS companion_profiles (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, db.prepare(SCHEMA).run());
  await ready.get(db);
}

export function profileStore(db) {
  return {
    async get(uid) {
      await ensure(db);
      return db.prepare('SELECT uid, name, data, updated_at FROM companion_profiles WHERE uid = ?').bind(uid).first();
    },
    // Compare-and-swap: only saves when the stored copy is still the one the device last saw (base 0 = none yet).
    async save(uid, name, data, base, at) {
      await ensure(db);
      const r = base
        ? await db.prepare('UPDATE companion_profiles SET name = ?, data = ?, updated_at = ? WHERE uid = ? AND updated_at = ?').bind(name, data, at, uid, base).run()
        : await db.prepare('INSERT INTO companion_profiles (uid, name, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (uid) DO NOTHING').bind(uid, name, data, at).run();
      return r.meta.changes > 0;
    },
    async drop(uid) {
      await ensure(db);
      await db.prepare('DELETE FROM companion_profiles WHERE uid = ?').bind(uid).run();
    }
  };
}

// The saved profile is a flat map of "arsenal.*" browser-storage keys to their stored text. Anything else is dropped.
// → { data } or { error: 'bad_request' | 'too_large' }
export function cleanProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'bad_request' };
  const keys = Object.keys(raw);
  if (keys.length > MAX_KEYS) return { error: 'too_large' };
  const data = {};
  let total = 0;
  for (const k of keys) {
    if (!KEY.test(k) || typeof raw[k] !== 'string') continue;
    try {
      JSON.parse(raw[k]);
    } catch {
      continue;
    }
    total += k.length + raw[k].length;
    data[k] = raw[k];
  }
  return total > MAX_PROFILE_BYTES ? { error: 'too_large' } : { data };
}

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });

export async function handleProfile(request, env) {
  if (!env.DB || !env.SESSION_SECRET) return json({ signedIn: false, error: 'unavailable' }, 503);
  const session = await readCompanionSession(request, env);
  if (!session) return json({ signedIn: false }, 401);
  const store = profileStore(env.DB);
  const m = request.method;

  if (m === 'GET' || m === 'HEAD') {
    const row = await store.get(session.uid);
    return json({ signedIn: true, uid: session.uid, name: session.name, saved: Boolean(row), updatedAt: row ? row.updated_at : 0, data: row ? JSON.parse(row.data) : null });
  }
  if (m !== 'PUT' && m !== 'DELETE') return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD, PUT, DELETE' } });
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);

  if (m === 'DELETE') {
    await store.drop(session.uid);
    return json({ ok: true });
  }

  if (Number(request.headers.get('Content-Length')) > MAX_PROFILE_BYTES + 10_000) return json({ error: 'too_large' }, 413);
  let body;
  try {
    const text = await request.text();
    if (enc.encode(text).length > MAX_PROFILE_BYTES + 10_000) return json({ error: 'too_large' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const cleaned = cleanProfile(body && body.data);
  if (cleaned.error) return json({ error: cleaned.error }, cleaned.error === 'too_large' ? 413 : 400);
  const data = cleaned.data;
  const base = Number.isSafeInteger(body.base) && body.base > 0 ? body.base : 0;
  const at = Math.max(Date.now(), base + 1);
  const ok = await store.save(session.uid, session.name, JSON.stringify(data), base, at);
  if (!ok) {
    const row = await store.get(session.uid);
    return json({ error: 'stale', updatedAt: row ? row.updated_at : 0, data: row ? JSON.parse(row.data) : null }, 409);
  }
  return json({ ok: true, updatedAt: at });
}
