import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, SESSION_COOKIE } from '../auth.js';
import { _clearMemberCache } from '../polls.js';
import { cleanStaffMessage, discordCopy, purgeStaffMessages, staffStore, STAFF_MESSAGE_MAX, STAFF_MESSAGES_PER_MINUTE } from '../staff-chat.js';
import { fakeD1 } from './helpers/d1.mjs';

const ORIGIN = 'https://belpire.com';
const MODS = '100000000000000009';
const MANAGER = '200000000000000001';
const U = { boss: '300000000000000001', mistress: '300000000000000002', fan: '300000000000000003' };
const realFetch = globalThis.fetch;
let env;
let roles;
let discord;

beforeEach(() => {
  _clearMemberCache();
  roles = { [U.boss]: [MANAGER], [U.mistress]: [MANAGER], [U.fan]: [] };
  discord = { posted: [], deleted: [], fail: false, next: 900000000000000000n };
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname.replace('/api/v10', '');
    const method = init.method || 'GET';
    let m = p.match(/^\/guilds\/\d+\/members\/(\d+)$/);
    if (m) return roles[m[1]] ? Response.json({ nick: { [U.boss]: 'Synister', [U.mistress]: 'Nightartist', [U.fan]: 'Fan' }[m[1]], roles: roles[m[1]], user: { id: m[1] } }) : Response.json({ code: 10007 }, { status: 404 });
    m = p.match(/^\/channels\/(\d+)\/messages$/);
    if (m && method === 'POST') {
      if (discord.fail) return Response.json({ code: 50013 }, { status: 403 });
      const id = String(discord.next++);
      discord.posted.push({ channel: m[1], id, ...JSON.parse(init.body) });
      return Response.json({ id });
    }
    m = p.match(/^\/channels\/(\d+)\/messages\/(\d+)$/);
    if (m && method === 'DELETE') {
      discord.deleted.push(m[2]);
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected ' + method + ' ' + url);
  };
  env = {
    SESSION_SECRET: 'x'.repeat(48), DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: '100000000000000001', POLL_MANAGER_ROLE_IDS: MANAGER,
    MAIN_STAGE_CHANNEL_ID: '100000000000000002', GENERAL_CHANNEL_ID: '100000000000000003', MOD_CHANNEL_ID: MODS,
    DB: fakeD1(), ASSETS: { fetch: () => new Response('') }
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call(path, { as, method = 'GET', body, origin = ORIGIN } = {}) {
  const headers = {};
  if (as) {
    const t = Math.floor(Date.now() / 1000);
    headers.Cookie = `${SESSION_COOKIE}=${await seal({ uid: U[as], name: as, iat: t, exp: t + 3600 }, env.SESSION_SECRET, 'session')}`;
  }
  if (method !== 'GET') { headers.Origin = origin; headers['Content-Type'] = 'application/json'; }
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: method !== 'GET' ? JSON.stringify(body || {}) : undefined }), env, { waitUntil: () => {} });
  return { status: res.status, body: await res.json(), headers: res.headers };
}
const send = (as, body) => call('/api/backstage/messages', { as, method: 'POST', body: { body } });

test('message text is cleaned and the Discord copy names the sender without pinging anyone', () => {
  assert.equal(cleanStaffMessage('  hi\r\nthere‮\u0007 '), 'hi\nthere');
  assert.equal(cleanStaffMessage('a\n\n\n\n\n\nb'), 'a\n\n\nb');
  assert.equal(cleanStaffMessage('x'.repeat(STAFF_MESSAGE_MAX + 50)).length, STAFF_MESSAGE_MAX);
  assert.equal(discordCopy('*Syn*', 'Lights out at 9'), '🎪 **Syn** · Backstage\nLights out at 9');
});

test('only Ringleaders can read or post', async () => {
  assert.equal((await call('/api/backstage/messages')).status, 401);
  assert.equal((await call('/api/backstage/messages', { as: 'fan' })).status, 403);
  assert.equal((await send('fan', 'let me in')).status, 403);
  assert.equal((await call('/api/backstage/messages', { as: 'boss', method: 'POST', body: { body: 'x' }, origin: 'https://evil.example' })).status, 403);
  const r = await call('/api/backstage/messages', { as: 'boss' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(r.body.messages, []);
  assert.equal(r.body.discord, true);
});

test('a message is saved, posted to the staff channel, and shown to every Ringleader in order', async () => {
  const a = await send('boss', 'Doors at 8:45. @everyone bring snacks');
  assert.equal(a.status, 200);
  assert.equal(a.body.message.posted, true);
  assert.equal(a.body.reason, null);
  assert.equal(discord.posted.length, 1);
  assert.equal(discord.posted[0].channel, MODS);
  assert.deepEqual(discord.posted[0].allowed_mentions, { parse: [] }, 'nobody gets pinged');
  assert.match(discord.posted[0].content, /^🎪 \*\*Synister\*\* · Backstage\nDoors at 8:45/);
  await send('mistress', 'Cheese curds are handled');
  const list = (await call('/api/backstage/messages', { as: 'mistress' })).body.messages;
  assert.deepEqual(list.map((m) => [m.by, m.mine]), [['Synister', false], ['Nightartist', true]]);
  assert.equal((await send('boss', '   ')).status, 400);
});

test('if Discord refuses, the message still stays Backstage and says why', async () => {
  discord.fail = true;
  const r = await send('boss', 'test');
  assert.equal(r.status, 200);
  assert.equal(r.body.message.posted, false);
  assert.match(r.body.reason, /permission/);
  delete env.MOD_CHANNEL_ID;
  discord.fail = false;
  const r2 = await send('boss', 'no channel');
  assert.equal(r2.body.message.posted, false);
  assert.match(r2.body.reason, /No staff channel/);
  assert.equal((await call('/api/backstage/messages', { as: 'boss' })).body.messages.length, 2);
});

test('authors delete their own messages here and in Discord; nobody else can', async () => {
  const { id } = (await send('boss', 'oops')).body.message;
  assert.equal((await call(`/api/backstage/messages/${id}/delete`, { as: 'mistress', method: 'POST' })).status, 403);
  assert.equal((await call(`/api/backstage/messages/${id}/delete`, { as: 'boss', method: 'POST' })).status, 200);
  assert.deepEqual(discord.deleted, [discord.posted[0].id]);
  assert.equal((await call('/api/backstage/messages', { as: 'boss' })).body.messages.length, 0);
  assert.equal((await call(`/api/backstage/messages/${id}/delete`, { as: 'boss', method: 'POST' })).status, 404);
});

test('a burst limit per Ringleader, and messages expire after 90 days', async () => {
  for (let i = 0; i < STAFF_MESSAGES_PER_MINUTE; i++) assert.equal((await send('boss', `m${i}`)).status, 200);
  assert.equal((await send('boss', 'one more')).status, 429);
  assert.equal((await send('mistress', 'my turn')).status, 200);
  const store = staffStore(env.DB);
  await store.add({ id: 'a'.repeat(24), user_id: U.boss, name: 'Synister', body: 'old news', created_at: '2020-01-01T00:00:00.000Z' });
  assert.equal(await purgeStaffMessages(env), 1);
  assert.equal((await store.latest()).length, STAFF_MESSAGES_PER_MINUTE + 1);
});
