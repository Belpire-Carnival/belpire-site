import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, SESSION_COOKIE } from '../auth.js';
import { _clearMemberCache } from '../polls.js';
import { syncPendingPasses, passStatus } from '../passes.js';
import { _clearLiveCache } from '../live.js';
import { fakeD1 } from './helpers/d1.mjs';

const ORIGIN = 'https://belpire.com';
const GUILD = '100000000000000001';
const STAGE = '100000000000000002';
const MODS = '100000000000000009';
const MANAGER = '200000000000000001';
const PASS = '200000000000000010';
const PENDING = '200000000000000011';
const U = { boss: '300000000000000001', fan: '300000000000000003', ghoul: '300000000000000004', closed: '300000000000000005', stranger: '300000000000000099' };
const realFetch = globalThis.fetch;
let env;
let roles;
let discord;

beforeEach(() => {
  _clearMemberCache();
  _clearLiveCache();
  roles = { [U.boss]: [MANAGER], [U.fan]: [], [U.ghoul]: [PENDING], [U.closed]: [] };
  discord = { messages: [], dms: [], failRoles: false };
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname.replace('/api/v10', '');
    const method = init.method || 'GET';
    let m = p.match(/^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/);
    if (m) {
      if (discord.failRoles) return Response.json({ code: 50013 }, { status: 403 });
      const list = roles[m[1]] || (roles[m[1]] = []);
      if (method === 'PUT' && !list.includes(m[2])) list.push(m[2]);
      if (method === 'DELETE') roles[m[1]] = list.filter((r) => r !== m[2]);
      return new Response(null, { status: 204 });
    }
    m = p.match(/^\/guilds\/\d+\/members\/(\d+)$/);
    if (m) return roles[m[1]] ? Response.json({ nick: { [U.boss]: 'Synister', [U.fan]: 'Fan', [U.ghoul]: 'Ghoul', [U.closed]: 'Hermit' }[m[1]], roles: roles[m[1]], user: { id: m[1], username: 'x' } }) : Response.json({ code: 10007 }, { status: 404 });
    if (p.startsWith(`/guilds/${GUILD}/members`)) {
      return Response.json(Object.keys(roles).map((id) => ({ roles: roles[id], nick: id === U.ghoul ? 'Ghoul' : null, user: { id, username: 'u' + id.slice(-2) } })));
    }
    if (p === '/users/@me/channels') {
      const rid = JSON.parse(init.body).recipient_id;
      if (rid === U.closed) return Response.json({ code: 50007 }, { status: 403 });
      return Response.json({ id: 'dm-' + rid });
    }
    m = p.match(/^\/channels\/([^/]+)\/messages$/);
    if (m) {
      const body = JSON.parse(init.body);
      (m[1].startsWith('dm-') ? discord.dms : discord.messages).push({ channel: m[1], ...body });
      return Response.json({ id: '1' });
    }
    m = p.match(/^\/guilds\/\d+\/voice-states\/(\d+)$/);
    if (m) return m[1] === U.boss ? Response.json({ channel_id: STAGE, self_stream: true, member: { nick: 'Synister' } }) : Response.json({}, { status: 404 });
    throw new Error('unexpected ' + method + ' ' + url);
  };
  env = {
    SESSION_SECRET: 'x'.repeat(48), DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, POLL_MANAGER_ROLE_IDS: MANAGER,
    MAIN_STAGE_CHANNEL_ID: STAGE, GENERAL_CHANNEL_ID: '100000000000000003', GAME_NIGHT_ROLE_ID: PASS, GAME_NIGHT_PENDING_ROLE_ID: PENDING,
    MOD_CHANNEL_ID: MODS, RINGLEADER_IDS: U.boss, DB: fakeD1(), ASSETS: { fetch: () => new Response('') }
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function call(path, { as, method = 'GET', body } = {}) {
  const headers = {};
  if (as) {
    const t = Math.floor(Date.now() / 1000);
    headers.Cookie = `${SESSION_COOKIE}=${await seal({ uid: U[as], name: as, iat: t, exp: t + 3600 }, env.SESSION_SECRET, 'session')}`;
  }
  if (method !== 'GET') { headers.Origin = ORIGIN; headers['Content-Type'] = 'application/json'; }
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined }), env, { waitUntil: () => {} });
  return { status: res.status, body: await res.json() };
}

test('pass status from roles', () => {
  assert.equal(passStatus(env, { roles: [PASS] }), 'has_pass');
  assert.equal(passStatus(env, { roles: [PENDING] }), 'pending');
  assert.equal(passStatus(env, { roles: [] }), 'none');
  assert.equal(passStatus(env, { manager: true, roles: [] }), 'has_pass');
  assert.equal(passStatus({}, { roles: [] }), 'not_required');
});

test('a member requests a pass on the site: Pending role, one note to the mods', async () => {
  assert.equal((await call('/api/passes', { as: 'fan' })).body.status, 'none');
  const r = await call('/api/passes/request', { as: 'fan', method: 'POST' });
  assert.equal(r.body.status, 'pending');
  assert.ok(roles[U.fan].includes(PENDING));
  assert.equal(discord.messages.length, 1);
  assert.match(discord.messages[0].content, /Fan.*wants a Game Night pass.*asked on belpire\.com/s);
  assert.deepEqual(discord.messages[0].allowed_mentions, { parse: [] }, 'nobody gets pinged');
  await call('/api/passes/request', { as: 'fan', method: 'POST' });
  assert.equal(discord.messages.length, 1, 'asking twice sends one note');
  assert.equal((await call('/api/passes', { as: 'fan' })).body.status, 'pending');
});

test('onboarding answers are picked up by the cron', async () => {
  assert.equal(await syncPendingPasses(env), 1);
  assert.match(discord.messages[0].content, /Ghoul.*answered Yes during onboarding/s);
  assert.equal(await syncPendingPasses(env), 0, 'only once');
  const q = (await call('/api/passes', { as: 'boss' })).body.queue;
  assert.deepEqual(q.map((x) => [x.name, x.source]), [['Ghoul', 'onboarding']]);
});

test('Ringleaders stamp a pass: Game Night on, Pending off, DM sent', async () => {
  await syncPendingPasses(env);
  assert.equal((await call(`/api/passes/${U.ghoul}/approve`, { as: 'fan', method: 'POST' })).status, 403);
  const r = await call(`/api/passes/${U.ghoul}/approve`, { as: 'boss', method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(r.body.dm, true);
  assert.deepEqual(roles[U.ghoul], [PASS]);
  assert.match(discord.dms[0].content, /stamped/);
  assert.equal((await call('/api/passes', { as: 'boss' })).body.queue.length, 0);
  assert.equal((await call(`/api/passes/${U.ghoul}/approve`, { as: 'boss', method: 'POST' })).status, 404, 'no double handling');
});

test('turning someone away removes Pending and sends the reason; closed DMs are reported, not fatal', async () => {
  await call('/api/passes/request', { as: 'closed', method: 'POST' });
  const r = await call(`/api/passes/${U.closed}/deny`, { as: 'boss', method: 'POST', body: { reason: 'Read the rules first' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.dm, false);
  assert.ok(!roles[U.closed].includes(PENDING));
  const mine = (await call('/api/passes', { as: 'closed' })).body;
  assert.equal(mine.status, 'none');
  assert.equal(mine.lastDenied.reason, 'Read the rules first');
  // they can ask again, and the mods hear about it again
  await call('/api/passes/request', { as: 'closed', method: 'POST' });
  assert.equal(discord.messages.length, 2);
});

test('Discord refusing the role change is explained', async () => {
  discord.failRoles = true;
  const r = await call('/api/passes/request', { as: 'fan', method: 'POST' });
  assert.equal(r.status, 502);
  assert.match(r.body.message, /missing a permission/);
});

test('live banner: members without a pass are pointed at the pass, not the channel', async () => {
  let r = await call('/api/live', { as: 'fan' });
  assert.equal(r.body.access, 'no_pass');
  assert.equal(r.body.joinUrl, null);
  r = await call('/api/live', { as: 'ghoul' });
  assert.equal(r.body.access, 'pass_pending');
  roles[U.fan].push(PASS);
  _clearMemberCache();
  r = await call('/api/live', { as: 'fan' });
  assert.equal(r.body.access, 'member');
  assert.ok(r.body.joinUrl);
});

test('outsiders and strangers cannot request or decide', async () => {
  assert.equal((await call('/api/passes/request', { method: 'POST' })).status, 401);
  assert.equal((await call('/api/passes/request', { as: 'stranger', method: 'POST' })).status, 403);
  assert.equal((await call('/api/passes', { as: 'stranger' })).body.status, 'not_member');
});

test('the 10-minute check removes a stray Pending role from people who already have a pass', async () => {
  roles[U.fan] = [PASS, PENDING];
  assert.equal(await syncPendingPasses(env), 1, 'only Ghoul is queued');
  assert.deepEqual(roles[U.fan], [PASS]);
  assert.ok(!discord.messages.some((m) => m.content.includes('Fan')), 'no mod note for them');
  assert.ok(!(await call('/api/passes', { as: 'boss' })).body.queue.some((q) => q.name === 'Fan'));
});
