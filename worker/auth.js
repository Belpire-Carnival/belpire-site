// "Log in with Discord" for belpire.com.
//
// Flow (OAuth2 authorization code grant, confidential client):
//   GET  /auth/login     → sets a short-lived encrypted state cookie, redirects to Discord
//   GET  /auth/callback  → checks state, exchanges the code, asks Discord whether this user is a
//                          member of the Belpire Carnival server (and has a required role, if set),
//                          then sets an encrypted 30-day session cookie
//   POST /auth/logout    → revokes the Discord grant and clears the session
//
// Scopes: identify + guilds.members.read (only *this* server's membership; no email, no server list).
// Sessions are AES-GCM encrypted cookies (no server-side session store). Each holds the user's
// Discord refresh token so membership can be re-checked every 24 hours; leavers lose access within a day.
//
// Config (wrangler.jsonc vars):  DISCORD_CLIENT_ID, DISCORD_GUILD_ID, DISCORD_REQUIRED_ROLE_IDS (optional, comma-separated)
// Secrets (Cloudflare dashboard): DISCORD_CLIENT_SECRET, SESSION_SECRET (32+ random characters)

const DISCORD_API = 'https://discord.com/api';
const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const SCOPES = 'identify guilds.members.read';

export const SESSION_COOKIE = '__Host-belpire_session';
export const STATE_COOKIE = '__Host-belpire_oauth';
const SESSION_TTL = 30 * 24 * 3600; // seconds
const RECHECK_AFTER = 24 * 3600;
const STATE_TTL = 600;

const enc = new TextEncoder();
const dec = new TextDecoder();
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- config

const SNOWFLAKE = /^\d{17,20}$/;

export function authConfig(env) {
  const roles = String(env.DISCORD_REQUIRED_ROLE_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const problems = [];
  if (!SNOWFLAKE.test(String(env.DISCORD_CLIENT_ID || ''))) problems.push('DISCORD_CLIENT_ID');
  if (!SNOWFLAKE.test(String(env.DISCORD_GUILD_ID || ''))) problems.push('DISCORD_GUILD_ID');
  if (!env.DISCORD_CLIENT_SECRET) problems.push('DISCORD_CLIENT_SECRET');
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 32) problems.push('SESSION_SECRET');
  if (roles.some((r) => !SNOWFLAKE.test(r))) problems.push('DISCORD_REQUIRED_ROLE_IDS');
  return { ok: problems.length === 0, problems, roles };
}

// ---------------------------------------------------------------- crypto helpers

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const keyCache = new Map();
async function aesKey(secret) {
  if (!keyCache.has(secret)) {
    const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
    keyCache.set(secret, crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }
  return keyCache.get(secret);
}

// purpose is bound in as additional data, so a state cookie can never be replayed as a session.
export async function seal(obj, secret, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, await aesKey(secret), enc.encode(JSON.stringify(obj)));
  return `${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function unseal(token, secret, purpose) {
  try {
    const [iv, ct] = String(token).split('.');
    if (!iv || !ct) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv), additionalData: enc.encode(purpose) }, await aesKey(secret), unb64url(ct));
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- cookies & responses

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
export const clearCookie = (name) => setCookie(name, '', 0);

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

// Only same-site paths are allowed after login (no open redirects).
export function safeReturn(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.length > 200) return '/members/';
  try {
    const u = new URL(path, 'https://belpire.invalid');
    return u.origin === 'https://belpire.invalid' ? u.pathname + u.search : '/members/';
  } catch {
    return '/members/';
  }
}

// ---------------------------------------------------------------- Discord calls

function basicAuth(env) {
  return 'Basic ' + btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`);
}

async function tokenRequest(env, params) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(env) },
    body: new URLSearchParams(params)
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, tokens: await res.json() };
}

async function revoke(env, token) {
  try {
    await fetch(`${DISCORD_API}/oauth2/token/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(env) },
      body: new URLSearchParams({ token, token_type_hint: 'refresh_token' })
    });
  } catch {
    /* best effort */
  }
}

// → { status: 'member', member } | { status: 'not-member' } | { status: 'missing-role' } | { status: 'error' }
async function checkMembership(env, accessToken, roles) {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (res.status === 404 || res.status === 403) return { status: 'not-member' };
  if (!res.ok) return { status: 'error' };
  const member = await res.json();
  if (member.pending) return { status: 'missing-role' }; // hasn't passed membership screening yet
  if (roles.length && !(member.roles || []).some((r) => roles.includes(r))) return { status: 'missing-role' };
  return { status: 'member', member };
}

function profile(env, member) {
  const user = member.user || {};
  const uid = String(user.id || '');
  const name = String(member.nick || user.global_name || user.username || 'Carnival-goer').slice(0, 64);
  let avatar;
  if (member.avatar) avatar = `https://cdn.discordapp.com/guilds/${env.DISCORD_GUILD_ID}/users/${uid}/avatars/${member.avatar}.png?size=64`;
  else if (user.avatar) avatar = `https://cdn.discordapp.com/avatars/${uid}/${user.avatar}.png?size=64`;
  else avatar = `https://cdn.discordapp.com/embed/avatars/${SNOWFLAKE.test(uid) ? Number((BigInt(uid) >> 22n) % 6n) : 0}.png`;
  return { uid, name, avatar };
}

// ---------------------------------------------------------------- handlers

const notConfigured = () => redirect('/denied/?reason=setup');

export async function handleLogin(request, env) {
  const cfg = authConfig(env);
  if (!cfg.ok) {
    console.warn('Discord login not configured:', cfg.problems.join(', '));
    return notConfigured();
  }
  const url = new URL(request.url);
  const state = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const returnTo = safeReturn(url.searchParams.get('return'));
  const cookie = await seal({ state, returnTo, exp: now() + STATE_TTL }, env.SESSION_SECRET, 'oauth-state');
  const authorize = new URL(AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: env.DISCORD_CLIENT_ID,
    scope: SCOPES,
    state,
    redirect_uri: `${url.origin}/auth/callback`,
    prompt: 'none'
  }).toString();
  return redirect(authorize.toString(), [setCookie(STATE_COOKIE, cookie, STATE_TTL)]);
}

export async function handleCallback(request, env) {
  const cfg = authConfig(env);
  if (!cfg.ok) return notConfigured();
  const url = new URL(request.url);
  const clearState = clearCookie(STATE_COOKIE);

  if (url.searchParams.get('error')) return redirect('/?login=cancelled', [clearState]);
  const stored = await unseal(readCookie(request, STATE_COOKIE), env.SESSION_SECRET, 'oauth-state');
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!stored || !state || !code || stored.exp < now() || !safeEqual(stored.state, state)) {
    return redirect('/denied/?reason=expired', [clearState]);
  }

  const exchange = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/auth/callback` });
  if (!exchange.ok) {
    console.warn(`Discord token exchange failed: HTTP ${exchange.status}`);
    return redirect('/denied/?reason=error', [clearState]);
  }
  const { access_token: accessToken, refresh_token: refreshToken } = exchange.tokens;
  const result = await checkMembership(env, accessToken, cfg.roles);
  if (result.status !== 'member') {
    await revoke(env, refreshToken);
    const reason = result.status === 'error' ? 'error' : result.status === 'missing-role' ? 'role' : 'member';
    return redirect(`/denied/?reason=${reason}`, [clearState]);
  }

  const t = now();
  const session = { ...profile(env, result.member), rt: refreshToken, iat: t, exp: t + SESSION_TTL, chk: t };
  const sealed = await seal(session, env.SESSION_SECRET, 'session');
  return redirect(stored.returnTo, [clearState, setCookie(SESSION_COOKIE, sealed, SESSION_TTL)]);
}

export async function handleLogout(request, env, ctx) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
  const session = env.SESSION_SECRET ? await unseal(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, 'session') : null;
  if (session?.rt && authConfig(env).ok) ctx.waitUntil(revoke(env, session.rt));
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': clearCookie(SESSION_COOKIE), 'Cache-Control': 'no-store' }
  });
}

// Read the session without contacting Discord (used for /api/me and nav state).
export async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const s = await unseal(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, 'session');
  return s && s.exp > now() ? s : null;
}

// Gate for members-only pages. Returns { ok: true, session, cookies } or { ok: false, response }.
export async function requireMember(request, env) {
  const url = new URL(request.url);
  const toLogin = () => ({ ok: false, response: redirect(`/auth/login?return=${encodeURIComponent(url.pathname + url.search)}`, [clearCookie(SESSION_COOKIE)]) });
  const cfg = authConfig(env);
  if (!cfg.ok) return { ok: false, response: notConfigured() };

  const session = await readSession(request, env);
  if (!session) return toLogin();
  if (now() - session.chk < RECHECK_AFTER) return { ok: true, session, cookies: [] };

  // Daily re-check: refresh the Discord grant and ask again whether they're still in the server.
  const refreshed = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: session.rt });
  if (!refreshed.ok) {
    if (refreshed.status >= 500) return { ok: true, session, cookies: [] }; // Discord hiccup: don't lock people out
    return toLogin(); // grant revoked or expired
  }
  const result = await checkMembership(env, refreshed.tokens.access_token, cfg.roles);
  if (result.status === 'error') return { ok: true, session, cookies: [] };
  if (result.status !== 'member') {
    await revoke(env, refreshed.tokens.refresh_token);
    return { ok: false, response: redirect(`/denied/?reason=${result.status === 'missing-role' ? 'role' : 'member'}`, [clearCookie(SESSION_COOKIE)]) };
  }
  const updated = { ...session, ...profile(env, result.member), rt: refreshed.tokens.refresh_token || session.rt, chk: now() };
  const sealed = await seal(updated, env.SESSION_SECRET, 'session');
  return { ok: true, session: updated, cookies: [setCookie(SESSION_COOKIE, sealed, Math.max(0, updated.exp - now()))] };
}
