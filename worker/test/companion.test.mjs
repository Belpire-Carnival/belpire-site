import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCompanionAuth, handleProfile, readCompanionSession, cleanProfile, COMPANION_COOKIE, MAX_PROFILE_BYTES } from '../companion.js';
import { readSession, seal } from '../auth.js';

const SECRET = 'x'.repeat(40);
const BASE = { COMPANION_DISCORD_CLIENT_ID: '123456789012345678', COMPANION_DISCORD_CLIENT_SECRET: 's', SESSION_SECRET: SECRET };
const ORIGIN = 'https://bureau.belpire.com';
const UID = '223456789012345678';

// A tiny stand-in for D1 that understands the five statements companion.js uses.
function fakeDb() {
  const rows = new Map();
  const stmt = (sql) => ({
    args: [],
    bind(...a) { this.args = a; return this; },
    async run() {
      const a = this.args;
      if (/^CREATE TABLE/.test(sql)) return { meta: { changes: 0 } };
      if (/^INSERT INTO companion_profiles/.test(sql)) {
        if (rows.has(a[0])) return { meta: { changes: 0 } };
        rows.set(a[0], { uid: a[0], name: a[1], data: a[2], updated_at: a[3] });
        return { meta: { changes: 1 } };
      }
      if (/^UPDATE companion_profiles/.test(sql)) {
        const r = rows.get(a[3]);
        if (!r || r.updated_at !== a[4]) return { meta: { changes: 0 } };
        Object.assign(r, { name: a[0], data: a[1], updated_at: a[2] });
        return { meta: { changes: 1 } };
      }
      if (/^DELETE FROM companion_profiles/.test(sql)) return { meta: { changes: rows.delete(a[0]) ? 1 : 0 } };
      throw new Error('unexpected SQL: ' + sql);
    },
    async first() {
      return rows.get(this.args[0]) || null;
    }
  });
  return { rows, prepare: stmt };
}

async function cookieFor(uid = UID, name = 'Pilot One', exp = Math.floor(Date.now() / 1000) + 3600) {
  const v = await seal({ uid, name, iat: 0, exp }, SECRET, 'bureau-session');
  return `${COMPANION_COOKIE}=${v}`;
}
const req = (method, path, { cookie, body, origin = ORIGIN } = {}) =>
  new Request(ORIGIN + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });

test('login sends the visitor to Discord asking only for identify, with its own state cookie', async () => {
  const res = await handleCompanionAuth(req('GET', '/auth/login'), BASE);
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(to.searchParams.get('scope'), 'identify');
  assert.equal(to.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback`);
  assert.match(res.headers.get('Set-Cookie'), /^__Host-bureau_oauth=.*Secure.*HttpOnly.*SameSite=Lax/);
});

test('login without the Adjutant credentials sends the visitor back with a setup status, and never borrows the Usher\'s', async () => {
  const res = await handleCompanionAuth(req('GET', '/auth/login'), {});
  assert.equal(res.headers.get('Location'), '/rsi1/companion/?signin=setup');
  const usherOnly = await handleCompanionAuth(req('GET', '/auth/login'), { DISCORD_CLIENT_ID: '123456789012345678', DISCORD_CLIENT_SECRET: 's', SESSION_SECRET: SECRET });
  assert.equal(usherOnly.headers.get('Location'), '/rsi1/companion/?signin=setup');
});

test('login names the Adjutant application as the client', async () => {
  const res = await handleCompanionAuth(req('GET', '/auth/login'), { ...BASE, DISCORD_CLIENT_ID: '999999999999999999' });
  assert.equal(new URL(res.headers.get('Location')).searchParams.get('client_id'), '123456789012345678');
});

test('callback checks the state, reads the user, revokes the grant and sets a companion session', async () => {
  const login = await handleCompanionAuth(req('GET', '/auth/login'), BASE);
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const stateCookie = login.headers.get('Set-Cookie').split(';')[0];
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/oauth2/token')) return Response.json({ access_token: 'a', refresh_token: 'r' });
    if (String(url).endsWith('/users/@me')) return Response.json({ id: UID, username: 'pilot', global_name: 'Pilot One' });
    return new Response(null, { status: 200 });
  };
  try {
    const res = await handleCompanionAuth(req('GET', `/auth/callback?code=c&state=${state}`, { cookie: stateCookie }), BASE);
    assert.equal(res.headers.get('Location'), '/rsi1/companion/?signin=ok');
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith(COMPANION_COOKIE + '='));
    assert.ok(session && /Secure; HttpOnly; SameSite=Lax/.test(session));
    assert.ok(calls.some((u) => u.endsWith('/oauth2/token/revoke')));
    // The session works for the companion...
    const s = await readCompanionSession(req('GET', '/api/companion/profile', { cookie: session.split(';')[0] }), BASE);
    assert.deepEqual([s.uid, s.name], [UID, 'Pilot One']);
    // ...and is useless as a belpire.com session, which unlocks the Discord invite and member pages.
    assert.equal(await readSession(req('GET', '/api/me', { cookie: session.split(';')[0] }), BASE), null);
    const asMain = session.split(';')[0].replace(COMPANION_COOKIE, '__Host-belpire_session');
    assert.equal(await readSession(req('GET', '/api/me', { cookie: asMain }), BASE), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('callback refuses a wrong or missing state and a user that is a bot', async () => {
  const login = await handleCompanionAuth(req('GET', '/auth/login'), BASE);
  const stateCookie = login.headers.get('Set-Cookie').split(';')[0];
  const wrong = await handleCompanionAuth(req('GET', '/auth/callback?code=c&state=nope', { cookie: stateCookie }), BASE);
  assert.equal(wrong.headers.get('Location'), '/rsi1/companion/?signin=expired');
  const none = await handleCompanionAuth(req('GET', '/auth/callback?code=c&state=nope'), BASE);
  assert.equal(none.headers.get('Location'), '/rsi1/companion/?signin=expired');
  const denied = await handleCompanionAuth(req('GET', '/auth/callback?error=access_denied'), BASE);
  assert.equal(denied.headers.get('Location'), '/rsi1/companion/?signin=cancelled');

  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => (String(url).endsWith('/oauth2/token') ? Response.json({ access_token: 'a' }) : String(url).endsWith('/users/@me') ? Response.json({ id: UID, bot: true }) : new Response(null));
  try {
    const bot = await handleCompanionAuth(req('GET', `/auth/callback?code=c&state=${state}`, { cookie: stateCookie }), BASE);
    assert.equal(bot.headers.get('Location'), '/rsi1/companion/?signin=error');
    assert.ok(!bot.headers.getSetCookie().some((c) => c.startsWith(COMPANION_COOKIE + '=') && !/Max-Age=0/.test(c)));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('logout clears the cookie and only answers a same-origin POST', async () => {
  const ok = await handleCompanionAuth(req('POST', '/auth/logout'), BASE);
  assert.equal(ok.status, 204);
  assert.match(ok.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal((await handleCompanionAuth(req('POST', '/auth/logout', { origin: 'https://evil.example' }), BASE)).status, 403);
  assert.equal((await handleCompanionAuth(req('GET', '/auth/logout'), BASE)).status, 405);
});

test('the profile needs a session and a database', async () => {
  const env = { ...BASE, DB: fakeDb() };
  const none = await handleProfile(req('GET', '/api/companion/profile'), env);
  assert.equal(none.status, 401);
  assert.equal((await none.json()).signedIn, false);
  const expired = await handleProfile(req('GET', '/api/companion/profile', { cookie: await cookieFor(UID, 'x', 1) }), env);
  assert.equal(expired.status, 401);
  const nodb = await handleProfile(req('GET', '/api/companion/profile', { cookie: await cookieFor() }), BASE);
  assert.equal(nodb.status, 503);
});

test('save, load, stale write and forget', async () => {
  const env = { ...BASE, DB: fakeDb() };
  const cookie = await cookieFor();
  const url = '/api/companion/profile';
  const empty = await (await handleProfile(req('GET', url, { cookie }), env)).json();
  assert.deepEqual([empty.signedIn, empty.saved, empty.updatedAt, empty.name, empty.uid], [true, false, 0, 'Pilot One', UID]);

  const data = { 'arsenal.runs': '[{"net":5}]', 'arsenal.settings': '{"body":"HURSTON"}' };
  const first = await (await handleProfile(req('PUT', url, { cookie, body: { data, base: 0 } }), env)).json();
  assert.equal(first.ok, true);
  const got = await (await handleProfile(req('GET', url, { cookie }), env)).json();
  assert.deepEqual(got.data, data);
  assert.equal(got.updatedAt, first.updatedAt);

  // Another device that never saw that save may not overwrite it.
  const stale = await handleProfile(req('PUT', url, { cookie, body: { data: { 'arsenal.runs': '[]' }, base: 0 } }), env);
  assert.equal(stale.status, 409);
  const sb = await stale.json();
  assert.deepEqual(sb.data, data);
  assert.equal(sb.updatedAt, first.updatedAt);

  // A device that did see it may.
  const next = await handleProfile(req('PUT', url, { cookie, body: { data: { 'arsenal.runs': '[]' }, base: first.updatedAt } }), env);
  assert.equal(next.status, 200);
  assert.ok((await next.json()).updatedAt > first.updatedAt);

  const del = await handleProfile(req('DELETE', url, { cookie }), env);
  assert.equal(del.status, 200);
  assert.equal((await (await handleProfile(req('GET', url, { cookie }), env)).json()).saved, false);
});

test('one person cannot read or change another person\'s profile', async () => {
  const env = { ...BASE, DB: fakeDb() };
  const a = await cookieFor(UID, 'A');
  const b = await cookieFor('323456789012345678', 'B');
  await handleProfile(req('PUT', '/api/companion/profile', { cookie: a, body: { data: { 'arsenal.runs': '[1]' }, base: 0 } }), env);
  const seen = await (await handleProfile(req('GET', '/api/companion/profile', { cookie: b }), env)).json();
  assert.equal(seen.saved, false);
  await handleProfile(req('DELETE', '/api/companion/profile', { cookie: b }), env);
  assert.equal((await (await handleProfile(req('GET', '/api/companion/profile', { cookie: a }), env)).json()).saved, true);
});

test('writes must come from the page: same origin, valid JSON, sane size', async () => {
  const env = { ...BASE, DB: fakeDb() };
  const cookie = await cookieFor();
  const url = '/api/companion/profile';
  assert.equal((await handleProfile(req('PUT', url, { cookie, origin: 'https://evil.example', body: { data: {}, base: 0 } }), env)).status, 403);
  assert.equal((await handleProfile(req('PUT', url, { cookie, origin: null, body: { data: {}, base: 0 } }), env)).status, 403);
  assert.equal((await handleProfile(req('DELETE', url, { cookie, origin: 'https://evil.example' }), env)).status, 403);
  const bad = await handleProfile(new Request(ORIGIN + url, { method: 'PUT', headers: { Cookie: cookie, Origin: ORIGIN }, body: 'not json' }), env);
  assert.equal(bad.status, 400);
  const big = await handleProfile(req('PUT', url, { cookie, body: { data: { 'arsenal.runs': JSON.stringify('x'.repeat(MAX_PROFILE_BYTES + 5)) }, base: 0 } }), env);
  assert.equal(big.status, 413);
  assert.equal((await handleProfile(req('POST', url, { cookie, body: {} }), env)).status, 405);
});

test('cleanProfile keeps only arsenal data keys with JSON values', () => {
  const r = cleanProfile({ 'arsenal.runs': '[1]', 'arsenal.__sync': '{}', 'other.key': '1', 'arsenal.bad': 'not json', 'arsenal.num': 5, 'arsenal.ok-2_x': '"fine"', '__proto__x': '1' });
  assert.deepEqual(r.data, { 'arsenal.runs': '[1]', 'arsenal.ok-2_x': '"fine"' });
  assert.equal(cleanProfile([]).error, 'bad_request');
  assert.equal(cleanProfile(null).error, 'bad_request');
  assert.equal(cleanProfile(Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`arsenal.k${i}`, '1']))).error, 'too_large');
});
