import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, unseal, safeReturn, SESSION_COOKIE, STATE_COOKIE } from '../auth.js';

const GUILD = '123456789012345678';
const USER = '234567890123456789';
const ROLE = '345678901234567890';
const env = (extra = {}) => ({
  DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_GUILD_ID: GUILD,
  DISCORD_REQUIRED_ROLE_IDS: '',
  DISCORD_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: 'x'.repeat(48),
  ASSETS: { fetch: async (req) => new Response(`asset:${new URL(req.url).pathname}`, { headers: { 'Content-Type': 'text/html' } }) },
  ...extra
});
const ctx = () => ({ waitUntil() {} });
const BASE = 'https://belpire.com';

let realFetch;
let discord; // controls the fake Discord
let calls;

beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  discord = { tokenStatus: 200, memberStatus: 200, member: { user: { id: USER, username: 'ringmaster', global_name: 'RingMaster', avatar: 'abc' }, roles: [ROLE], nick: null, pending: false }, refreshStatus: 200 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? String(init.body) : '' });
    if (u === 'https://discord.com/api/oauth2/token') {
      const grant = new URLSearchParams(String(init.body)).get('grant_type');
      const status = grant === 'refresh_token' ? discord.refreshStatus : discord.tokenStatus;
      if (status !== 200) return new Response('{}', { status });
      return Response.json({ access_token: `at-${grant}`, refresh_token: `rt-${grant}-${calls.length}`, expires_in: 604800 });
    }
    if (u === 'https://discord.com/api/oauth2/token/revoke') return new Response(null, { status: 200 });
    if (u === `https://discord.com/api/users/@me/guilds/${GUILD}/member`) {
      if (discord.memberStatus !== 200) return new Response('{}', { status: discord.memberStatus });
      return Response.json(discord.member);
    }
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const cookieValue = (res, name) => {
  for (const c of res.headers.getSetCookie()) if (c.startsWith(`${name}=`)) return c.split(';')[0].slice(name.length + 1);
  return null;
};

async function loginFlow(e, { returnTo = '/members/' } = {}) {
  const start = await worker.fetch(new Request(`${BASE}/auth/login?return=${encodeURIComponent(returnTo)}`), e, ctx());
  const auth = new URL(start.headers.get('Location'));
  const stateCookie = cookieValue(start, STATE_COOKIE);
  const cb = await worker.fetch(
    new Request(`${BASE}/auth/callback?code=abc&state=${auth.searchParams.get('state')}`, { headers: { Cookie: `${STATE_COOKIE}=${stateCookie}` } }),
    e,
    ctx()
  );
  return { start, auth, cb };
}

test('login redirects to Discord with minimal scopes, state and our callback', async () => {
  const res = await worker.fetch(new Request(`${BASE}/auth/login`), env(), ctx());
  assert.equal(res.status, 302);
  const u = new URL(res.headers.get('Location'));
  assert.equal(u.origin + u.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(u.searchParams.get('scope'), 'identify guilds.members.read');
  assert.equal(u.searchParams.get('redirect_uri'), `${BASE}/auth/callback`);
  assert.ok(u.searchParams.get('state').length >= 40);
  const cookie = res.headers.getSetCookie()[0];
  assert.match(cookie, /^__Host-belpire_oauth=.+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);
});

test('a server member logs in and can open the Members’ Lounge', async () => {
  const e = env();
  const { cb } = await loginFlow(e);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('Location'), '/members/');
  const session = cookieValue(cb, SESSION_COOKIE);
  assert.ok(session);
  assert.match(cb.headers.getSetCookie().find((c) => c.startsWith(SESSION_COOKIE)), /Max-Age=2592000/);
  const data = await unseal(session, e.SESSION_SECRET, 'session');
  assert.equal(data.name, 'RingMaster');
  assert.equal(data.avatar, `https://cdn.discordapp.com/avatars/${USER}/abc.png?size=64`);
  assert.ok(!('email' in data));

  const page = await worker.fetch(new Request(`${BASE}/members/`, { headers: { Cookie: `${SESSION_COOKIE}=${session}` } }), e, ctx());
  assert.equal(page.status, 200);
  assert.equal(await page.text(), 'asset:/members/');
  assert.equal(page.headers.get('Cache-Control'), 'private, no-store');

  const me = await (await worker.fetch(new Request(`${BASE}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${session}` } }), e, ctx())).json();
  assert.deepEqual(me, { loggedIn: true, name: 'RingMaster', avatar: data.avatar });
});

test('non-members and members without the required role are turned away', async () => {
  discord.memberStatus = 404;
  let { cb } = await loginFlow(env());
  assert.equal(cb.headers.get('Location'), '/denied/?reason=member');
  assert.equal(cookieValue(cb, SESSION_COOKIE), null);
  assert.ok(calls.some((c) => c.url.endsWith('/token/revoke')), 'grant is revoked');

  discord.memberStatus = 200;
  ({ cb } = await loginFlow(env({ DISCORD_REQUIRED_ROLE_IDS: '999999999999999999' })));
  assert.equal(cb.headers.get('Location'), '/denied/?reason=role');

  ({ cb } = await loginFlow(env({ DISCORD_REQUIRED_ROLE_IDS: `999999999999999999, ${ROLE}` })));
  assert.equal(cb.headers.get('Location'), '/members/');
});

test('callback rejects a missing or tampered state', async () => {
  const e = env();
  const noCookie = await worker.fetch(new Request(`${BASE}/auth/callback?code=abc&state=zzz`), e, ctx());
  assert.equal(noCookie.headers.get('Location'), '/denied/?reason=expired');

  const forged = await seal({ state: 'other', returnTo: '/members/', exp: Math.floor(Date.now() / 1000) + 600 }, e.SESSION_SECRET, 'oauth-state');
  const bad = await worker.fetch(new Request(`${BASE}/auth/callback?code=abc&state=zzz`, { headers: { Cookie: `${STATE_COOKIE}=${forged}` } }), e, ctx());
  assert.equal(bad.headers.get('Location'), '/denied/?reason=expired');
  assert.equal(calls.length, 0, 'never talks to Discord without a valid state');
});

test('members pages redirect to login without a session; a state cookie is not a session', async () => {
  const e = env();
  const res = await worker.fetch(new Request(`${BASE}/members/nights`), e, ctx());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/auth/login?return=%2Fmembers%2Fnights');

  const stateLike = await seal({ uid: USER, name: 'x', exp: 9e9, chk: 9e9 }, e.SESSION_SECRET, 'oauth-state');
  const swapped = await worker.fetch(new Request(`${BASE}/members/`, { headers: { Cookie: `${SESSION_COOKIE}=${stateLike}` } }), e, ctx());
  assert.equal(swapped.status, 302);
});

test('daily re-check keeps members in and removes people who left', async () => {
  const e = env();
  const t = Math.floor(Date.now() / 1000);
  const stale = await seal({ uid: USER, name: 'Old Name', avatar: 'x', rt: 'rt-old', iat: t - 3 * 86400, exp: t + 20 * 86400, chk: t - 2 * 86400 }, e.SESSION_SECRET, 'session');

  const ok = await worker.fetch(new Request(`${BASE}/members/`, { headers: { Cookie: `${SESSION_COOKIE}=${stale}` } }), e, ctx());
  assert.equal(ok.status, 200);
  const renewed = await unseal(cookieValue(ok, SESSION_COOKIE), e.SESSION_SECRET, 'session');
  assert.equal(renewed.name, 'RingMaster');
  assert.ok(renewed.chk >= t);
  assert.match(renewed.rt, /^rt-refresh_token-/);

  discord.memberStatus = 404;
  const gone = await worker.fetch(new Request(`${BASE}/members/`, { headers: { Cookie: `${SESSION_COOKIE}=${stale}` } }), e, ctx());
  assert.equal(gone.headers.get('Location'), '/denied/?reason=member');
  assert.match(gone.headers.getSetCookie()[0], /Max-Age=0/);

  discord.memberStatus = 200;
  discord.refreshStatus = 503; // Discord outage: don't lock people out
  const outage = await worker.fetch(new Request(`${BASE}/members/`, { headers: { Cookie: `${SESSION_COOKIE}=${stale}` } }), e, ctx());
  assert.equal(outage.status, 200);
});

test('logout needs POST, rejects cross-site origins, clears the cookie', async () => {
  const e = env();
  assert.equal((await worker.fetch(new Request(`${BASE}/auth/logout`), e, ctx())).status, 405);
  const cross = await worker.fetch(new Request(`${BASE}/auth/logout`, { method: 'POST', headers: { Origin: 'https://evil.example' } }), e, ctx());
  assert.equal(cross.status, 403);
  const out = await worker.fetch(new Request(`${BASE}/auth/logout`, { method: 'POST', headers: { Origin: BASE } }), e, ctx());
  assert.equal(out.status, 303);
  assert.match(out.headers.get('Set-Cookie'), /^__Host-belpire_session=; .*Max-Age=0$/);
});

test('without configuration, login is disabled but the public site still works', async () => {
  const e = env({ DISCORD_CLIENT_ID: 'REPLACE_WITH_DISCORD_APPLICATION_ID', SESSION_SECRET: '' });
  assert.equal((await worker.fetch(new Request(`${BASE}/auth/login`), e, ctx())).headers.get('Location'), '/denied/?reason=setup');
  assert.equal((await worker.fetch(new Request(`${BASE}/members/`), e, ctx())).headers.get('Location'), '/denied/?reason=setup');
  assert.deepEqual(await (await worker.fetch(new Request(`${BASE}/api/me`), e, ctx())).json(), { loggedIn: false, loginEnabled: false });
  assert.equal(await (await worker.fetch(new Request(`${BASE}/`), e, ctx())).text(), 'asset:/');
});

test('safeReturn blocks open redirects', () => {
  assert.equal(safeReturn('/members/nights?x=1'), '/members/nights?x=1');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', null, 'members']) assert.equal(safeReturn(bad), '/members/');
});
