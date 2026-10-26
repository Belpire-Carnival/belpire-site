// "Verify with Discord" — gates the Discord invite link behind a verified Discord account.
//
//   GET  /auth/login     → short-lived encrypted state cookie, redirect to Discord
//   GET  /auth/callback  → check state, exchange the code, read the user, require a verified
//                          account, revoke the Discord token right away, set a session cookie
//   POST /auth/logout    → clear the session
//   GET  /api/invite     → { signedIn, name, invite } for a valid session, otherwise 401
//
// Scopes: identify + email. Discord only reports whether an account is verified with the email
// scope; the email address itself is never stored or logged. Server membership is not required.
// Sessions are AES-GCM encrypted cookies holding only the user ID, a display name and timestamps.
//
// Runtime secrets: DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SESSION_SECRET (32+ chars), DISCORD_INVITE.

const DISCORD_API = 'https://discord.com/api';
const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const SCOPES = 'identify email';

export const SESSION_COOKIE = '__Host-belpire_session';
export const STATE_COOKIE = '__Host-belpire_oauth';
const SESSION_TTL = 30 * 24 * 3600; // seconds
const STATE_TTL = 600;
const JOIN_PAGE = '/join/';

const enc = new TextEncoder();
const dec = new TextDecoder();
const now = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------- config

const SNOWFLAKE = /^\d{17,20}$/;
const INVITE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,32}$/;

export function authConfig(env) {
  const problems = [];
  if (!SNOWFLAKE.test(String(env.DISCORD_CLIENT_ID || ''))) problems.push('DISCORD_CLIENT_ID');
  if (!env.DISCORD_CLIENT_SECRET) problems.push('DISCORD_CLIENT_SECRET');
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 32) problems.push('SESSION_SECRET');
  if (!INVITE.test(String(env.DISCORD_INVITE || ''))) problems.push('DISCORD_INVITE');
  return { ok: problems.length === 0, problems };
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

// The purpose is bound in as additional data, so a state cookie can never be replayed as a session.
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

function redirect(location, cookies = [], status = 302) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status, headers });
}

const toJoin = (status, cookies) => redirect(`${JOIN_PAGE}?status=${status}`, cookies);

// Only same-site paths are allowed after login (no open redirects).
export function safeReturn(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.length > 200) return JOIN_PAGE;
  try {
    const u = new URL(path, 'https://belpire.invalid');
    return u.origin === 'https://belpire.invalid' ? u.pathname + u.search : JOIN_PAGE;
  } catch {
    return JOIN_PAGE;
  }
}

// ---------------------------------------------------------------- Discord calls

function basicAuth(env) {
  return 'Basic ' + btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`);
}

async function exchangeCode(env, code, redirectUri) {
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(env) },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, tokens: await res.json() };
}

// We only need one look at the account, so the grant is revoked as soon as we've checked it.
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

async function fetchUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return res.json();
}

// A real person's account whose email Discord has verified.
export function isVerifiedPerson(user) {
  return Boolean(user && SNOWFLAKE.test(String(user.id || '')) && user.verified === true && !user.bot && !user.system);
}

const displayName = (user) => String(user.global_name || user.username || 'Carnival-goer').slice(0, 64);

// ---------------------------------------------------------------- handlers

export async function handleLogin(request, env) {
  const cfg = authConfig(env);
  if (!cfg.ok) {
    console.warn('Discord verification not configured:', cfg.problems.join(', '));
    return toJoin('setup');
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

export async function handleCallback(request, env, ctx) {
  const cfg = authConfig(env);
  if (!cfg.ok) return toJoin('setup');
  const url = new URL(request.url);
  const clearState = clearCookie(STATE_COOKIE);

  if (url.searchParams.get('error')) return toJoin('cancelled', [clearState]);
  const stored = await unseal(readCookie(request, STATE_COOKIE), env.SESSION_SECRET, 'oauth-state');
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!stored || !state || !code || stored.exp < now() || !safeEqual(stored.state, state)) {
    return toJoin('expired', [clearState]);
  }

  const exchange = await exchangeCode(env, code, `${url.origin}/auth/callback`);
  if (!exchange.ok) {
    console.warn(`Discord token exchange failed: HTTP ${exchange.status}`);
    return toJoin('error', [clearState]);
  }
  const { access_token: accessToken, refresh_token: refreshToken } = exchange.tokens;
  const user = await fetchUser(accessToken);
  // Revoking the refresh token ends the whole grant; we keep nothing from Discord but the result.
  const done = revoke(env, refreshToken || accessToken, refreshToken ? 'refresh_token' : 'access_token');
  if (ctx?.waitUntil) ctx.waitUntil(done);
  else await done;

  if (!user) return toJoin('error', [clearState]);
  if (!isVerifiedPerson(user)) return toJoin('unverified', [clearState]);

  const t = now();
  const session = { uid: String(user.id), name: displayName(user), iat: t, exp: t + SESSION_TTL };
  const sealed = await seal(session, env.SESSION_SECRET, 'session');
  return redirect(stored.returnTo, [clearState, setCookie(SESSION_COOKIE, sealed, SESSION_TTL)]);
}

export async function handleLogout(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return new Response('Forbidden', { status: 403 });
  return redirect(JOIN_PAGE, [clearCookie(SESSION_COOKIE)], 303);
}

export async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const s = await unseal(readCookie(request, SESSION_COOKIE), env.SESSION_SECRET, 'session');
  return s && s.exp > now() && SNOWFLAKE.test(String(s.uid || '')) ? s : null;
}

// → { status, body } for /api/invite. The invite is only ever sent to a verified session.
export async function inviteFor(request, env) {
  if (!authConfig(env).ok) return { status: 503, body: { signedIn: false, error: 'unavailable' } };
  const session = await readSession(request, env);
  if (!session) return { status: 401, body: { signedIn: false } };
  return { status: 200, body: { signedIn: true, name: session.name, invite: env.DISCORD_INVITE } };
}
