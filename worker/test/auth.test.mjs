import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, unseal, safeReturn, isVerifiedPerson, authConfig, SESSION_COOKIE, STATE_COOKIE } from '../auth.js';

const ORIGIN = 'https://belpire.com';
const USER = '123456789012345678';
const env = (over = {}) => ({
  DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: 'x'.repeat(48),
  DISCORD_INVITE: 'https://discord.gg/example',
  ASSETS: { fetch: () => new Response('static') },
  ...over
});
const ctx = { waitUntil: (p) => p };
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const call = (path, init = {}, e = env()) => worker.fetch(new Request(ORIGIN + path, { redirect: 'manual', ...init }), e, ctx);
const cookieValue = (res, name) => {
  for (const c of res.headers.getSetCookie()) if (c.startsWith(name + '=')) return c.slice(name.length + 1).split(';')[0];
  return null;
};

// Fake Discord: token exchange, /users/@me and revoke.
function fakeDiscord(user, { tokenStatus = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, body: init.body ? String(init.body) : '' });
    if (url.endsWith('/oauth2/token')) {
      return tokenStatus === 200
        ? Response.json({ access_token: 'at', refresh_token: 'rt', token_type: 'Bearer', scope: 'identify email' })
        : new Response('nope', { status: tokenStatus });
    }
    if (url.endsWith('/users/@me')) return Response.json(user);
    if (url.endsWith('/oauth2/token/revoke')) return new Response(null, { status: 200 });
    throw new Error('unexpected fetch ' + url);
  };
  return calls;
}

async function loginState(e = env()) {
  const res = await call('/auth/login?return=/join/', {}, e);
  const loc = new URL(res.headers.get('Location'));
  return { state: loc.searchParams.get('state'), cookie: cookieValue(res, STATE_COOKIE), loc };
}

async function callback(user, opts) {
  const e = env();
  const { state, cookie } = await loginState(e);
  const calls = fakeDiscord(user, opts);
  const res = await call(`/auth/callback?code=abc&state=${state}`, { headers: { Cookie: `${STATE_COOKIE}=${cookie}` } }, e);
  return { res, calls, e };
}

test('login redirects to Discord with identify + email and a state cookie', async () => {
  const { loc, cookie, state } = await loginState();
  assert.equal(loc.origin + loc.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(loc.searchParams.get('scope'), 'identify email');
  assert.equal(loc.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.ok(state && cookie);
});

test('a verified account gets a session with no email or tokens, and the grant is revoked', async () => {
  const { res, calls, e } = await callback({ id: USER, username: 'clown', global_name: 'Pennywhistle', email: 'a@b.c', verified: true });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/join/');
  const session = await unseal(cookieValue(res, SESSION_COOKIE), e.SESSION_SECRET, 'session');
  assert.equal(session.uid, USER);
  assert.equal(session.name, 'Pennywhistle');
  assert.deepEqual(Object.keys(session).sort(), ['exp', 'iat', 'name', 'uid']);
  assert.ok(calls.some((c) => c.url.endsWith('/oauth2/token/revoke') && c.body.includes('token=rt')));
});

test('an unverified account is turned away without a session', async () => {
  const { res, calls } = await callback({ id: USER, username: 'clown', verified: false });
  assert.equal(res.headers.get('Location'), '/join/?status=unverified');
  assert.equal(cookieValue(res, SESSION_COOKIE), null);
  assert.ok(calls.some((c) => c.url.endsWith('/oauth2/token/revoke')));
});

test('bots and system accounts are turned away', () => {
  assert.equal(isVerifiedPerson({ id: USER, verified: true, bot: true }), false);
  assert.equal(isVerifiedPerson({ id: USER, verified: true, system: true }), false);
  assert.equal(isVerifiedPerson({ id: USER }), false);
  assert.equal(isVerifiedPerson({ id: USER, verified: true }), true);
});

test('a mismatched or missing state is rejected before contacting Discord', async () => {
  const e = env();
  const { cookie } = await loginState(e);
  const calls = fakeDiscord({ id: USER, verified: true });
  const res = await call('/auth/callback?code=abc&state=forged', { headers: { Cookie: `${STATE_COOKIE}=${cookie}` } }, e);
  assert.equal(res.headers.get('Location'), '/join/?status=expired');
  assert.equal(calls.length, 0);
});

test('a state cookie cannot be used as a session', async () => {
  const e = env();
  const forged = await seal({ uid: USER, name: 'x', iat: 0, exp: 9e9 }, e.SESSION_SECRET, 'oauth-state');
  const res = await call('/api/invite', { headers: { Cookie: `${SESSION_COOKIE}=${forged}` } }, e);
  assert.equal(res.status, 401);
});

test('a failed token exchange shows an error', async () => {
  const { res } = await callback({ id: USER, verified: true }, { tokenStatus: 400 });
  assert.equal(res.headers.get('Location'), '/join/?status=error');
});

test('/api/invite: 401 when signed out, the invite when signed in, never cached', async () => {
  const e = env();
  const out = await call('/api/invite', {}, e);
  assert.equal(out.status, 401);
  assert.deepEqual(await out.json(), { signedIn: false });

  const t = Math.floor(Date.now() / 1000);
  const session = await seal({ uid: USER, name: 'Pennywhistle', iat: t, exp: t + 60 }, e.SESSION_SECRET, 'session');
  const res = await call('/api/invite', { headers: { Cookie: `${SESSION_COOKIE}=${session}` } }, e);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { signedIn: true, name: 'Pennywhistle', invite: 'https://discord.gg/example' });
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});

test('an expired session gets no invite', async () => {
  const e = env();
  const t = Math.floor(Date.now() / 1000);
  const session = await seal({ uid: USER, name: 'x', iat: t - 100, exp: t - 1 }, e.SESSION_SECRET, 'session');
  const res = await call('/api/invite', { headers: { Cookie: `${SESSION_COOKIE}=${session}` } }, e);
  assert.equal(res.status, 401);
});

test('missing configuration closes the box office instead of leaking anything', async () => {
  const e = env({ DISCORD_INVITE: '' });
  assert.deepEqual(authConfig(e).problems, ['DISCORD_INVITE']);
  assert.equal((await call('/api/invite', {}, e)).status, 503);
  const login = await call('/auth/login', {}, e);
  assert.equal(login.headers.get('Location'), '/join/?status=setup');
  assert.equal(authConfig(env({ DISCORD_INVITE: 'https://evil.example/x' })).ok, false);
});

test('logout clears the session and refuses cross-site posts', async () => {
  const ok = await call('/auth/logout', { method: 'POST', headers: { Origin: ORIGIN } });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('Set-Cookie'), /Max-Age=0/);
  const bad = await call('/auth/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
  assert.equal((await call('/auth/logout')).status, 405);
});

test('return paths stay on this site', () => {
  assert.equal(safeReturn('/join/'), '/join/');
  assert.equal(safeReturn('//evil.example'), '/join/');
  assert.equal(safeReturn('https://evil.example'), '/join/');
  assert.equal(safeReturn('/\\evil'), '/join/');
});
