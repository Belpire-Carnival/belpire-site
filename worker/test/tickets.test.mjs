import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, SESSION_COOKIE } from '../auth.js';
import { _clearMemberCache, _clearCatalogCache } from '../polls.js';
import { _clearLiveCache } from '../live.js';
import { punchAmount, payAttendance, etDay, RULES, weeklyHighScores, highScoresMessage } from '../tickets.js';
import { ticketStore } from '../ticket-db.js';
import { pollStore } from '../poll-db.js';
import { COMMANDS, verifyDiscord } from '../interactions.js';
import { PRIZES } from '../prizes.js';
import { fakeD1 } from './helpers/d1.mjs';

const ORIGIN = 'https://belpire.com';
const GUILD = '100000000000000001';
const STAGE = '100000000000000002';
const MODS = '100000000000000009';
const MANAGER = '200000000000000001';
const U = { boss: '300000000000000001', fan: '300000000000000003', fan2: '300000000000000004', stranger: '300000000000000099' };
const NAMES = { [U.boss]: 'Synister', [U.fan]: 'Fan One', [U.fan2]: 'Fan Two' };
const realFetch = globalThis.fetch;
let env;
let discord;

const feed = { tracked: [{ appid: 1966720, name: 'Lethal Company', tent: 'horror' }, { appid: 3527290, name: 'PEAK', tent: 'party' }, { appid: 739630, name: 'Phasmophobia', tent: 'horror' }] };

beforeEach(() => {
  _clearMemberCache();
  _clearCatalogCache();
  _clearLiveCache();
  discord = { posted: [], dms: [], voice: {}, next: 1 };
  globalThis.fetch = async (url, init = {}) => {
    const p = new URL(url).pathname.replace('/api/v10', '');
    const method = init.method || 'GET';
    let m = p.match(/^\/guilds\/\d+\/members\/(\d+)$/);
    if (m) return NAMES[m[1]] ? Response.json({ nick: NAMES[m[1]], roles: m[1] === U.boss ? [MANAGER] : [], user: { id: m[1], username: 'u' } }) : Response.json({ code: 10007 }, { status: 404 });
    if (p.startsWith(`/guilds/${GUILD}/members/search`)) return Response.json([{ nick: 'Fan One', user: { id: U.fan, username: 'fanone' } }, { user: { id: '1', username: 'botty', bot: true } }]);
    m = p.match(/^\/guilds\/\d+\/voice-states\/(\d+)$/);
    if (m) return discord.voice[m[1]] ? Response.json(discord.voice[m[1]]) : Response.json({ code: 10065 }, { status: 404 });
    if (p === '/users/@me/channels') return Response.json({ id: 'dm-' + JSON.parse(init.body).recipient_id });
    m = p.match(/^\/channels\/([^/]+)\/messages$/);
    if (m && method === 'POST') {
      (m[1].startsWith('dm-') ? discord.dms : discord.posted).push({ channel: m[1], ...JSON.parse(init.body) });
      return Response.json({ id: String(discord.next++) });
    }
    throw new Error('unexpected ' + method + ' ' + url);
  };
  env = {
    SESSION_SECRET: 'x'.repeat(48), DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, POLL_MANAGER_ROLE_IDS: MANAGER,
    MAIN_STAGE_CHANNEL_ID: STAGE, GENERAL_CHANNEL_ID: '100000000000000003', MOD_CHANNEL_ID: MODS, RINGLEADER_IDS: U.boss,
    DB: fakeD1(),
    ASSETS: { fetch: async (req) => {
      const path = new URL(req.url).pathname;
      if (path === '/data/feed.json') return Response.json(feed);
      if (path === '/jackbox/packs.json') return Response.json({ packs: [] });
      return new Response('nope', { status: 404 });
    } }
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
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: method !== 'GET' ? JSON.stringify(body || {}) : undefined }), env, { waitUntil: () => {} });
  return { status: res.status, body: await res.json() };
}
const post = (path, as, body) => call(path, { as, method: 'POST', body });

test('punch card pays daily, more for a streak, and only once a day', async () => {
  assert.equal(punchAmount(1), 10);
  assert.equal(punchAmount(3), 14);
  assert.equal(punchAmount(30), 10 + 2 * RULES.punchStreakMax);
  const store = ticketStore(env.DB);
  const yesterday = etDay(Date.now() - 86400000);
  await store.change(U.fan, 'Fan One', 0, 'seed');
  await store.setPunch(U.fan, yesterday, 2);
  const r = await post('/api/tickets/punch', 'fan');
  assert.equal(r.status, 200);
  assert.equal(r.body.streak, 3);
  assert.equal(r.body.amount, 14);
  assert.equal((await post('/api/tickets/punch', 'fan')).status, 409);
  const me = (await call('/api/tickets', { as: 'fan' })).body;
  assert.equal(me.wallet.balance, 14);
  assert.equal(me.wallet.punchedToday, true);
  assert.equal(me.history[0].amount, 14);
  assert.equal((await call('/api/tickets', { as: 'stranger' })).status, 403, 'members only');
  assert.equal((await call('/api/tickets')).status, 401);
});

test('Find the Pea is decided on the server, pays only on a find, and stops after five games', async () => {
  let wins = 0;
  for (let i = 0; i < RULES.shellPlays; i++) {
    const r = await post('/api/tickets/games/shell', 'fan', { pick: 1 });
    assert.equal(r.status, 200);
    assert.ok([0, 1, 2].includes(r.body.pea));
    assert.equal(r.body.win, r.body.pea === 1);
    assert.equal(r.body.amount, r.body.win ? RULES.shellWin : 0);
    assert.equal(r.body.playsLeft, RULES.shellPlays - i - 1);
    if (r.body.win) wins++;
  }
  assert.equal((await post('/api/tickets/games/shell', 'fan', { pick: 0 })).status, 429);
  assert.equal((await post('/api/tickets/games/shell', 'fan2', { pick: 7 })).status, 400);
  assert.equal((await call('/api/tickets', { as: 'fan' })).body.wallet.balance, wins * RULES.shellWin);
});

test('check-in needs a show and The Main Stage; the cron pays once per 10 minutes up to the cap', async () => {
  assert.equal((await post('/api/tickets/checkin', 'fan')).body.error, 'no_show');
  const polls = pollStore(env.DB);
  await polls.create({ id: 'night1', title: 'Friday Fright', candidates: [], created_by: U.boss, created_by_name: 'Synister', created_at: Date.now() - 86400000 });
  await env.DB.prepare("UPDATE polls SET status = 'scheduled', event_start = ? WHERE id = 'night1'").bind(new Date(Date.now() - 3600e3).toISOString()).run();
  assert.equal((await post('/api/tickets/checkin', 'fan')).body.error, 'not_on_stage');
  discord.voice[U.fan] = { channel_id: STAGE, self_deaf: true };
  assert.equal((await post('/api/tickets/checkin', 'fan')).body.error, 'not_on_stage', 'deafened does not count');
  discord.voice[U.fan] = { channel_id: STAGE };
  const c = await post('/api/tickets/checkin', 'fan');
  assert.equal(c.status, 200);
  assert.equal(c.body.show, 'Friday Fright');
  assert.equal(c.body.earned, RULES.attendPerCheck);
  assert.equal(await payAttendance(env), 0, 'same 10-minute slot is never paid twice');
  assert.equal(await payAttendance(env, Date.now() + 600000), RULES.attendPerCheck);
  delete discord.voice[U.fan];
  assert.equal(await payAttendance(env, Date.now() + 1200000), 0, 'left the stage, no pay');
  const me = (await call('/api/tickets', { as: 'fan' })).body;
  assert.equal(me.wallet.balance, RULES.attendPerCheck * 2);
  assert.deepEqual(me.show, { title: 'Friday Fright', checkedIn: true, paid: RULES.attendPerCheck * 2, cap: RULES.attendCap });
});

test('the Prize Booth: needs enough tickets, notes the mods, refunds put tickets back', async () => {
  const store = ticketStore(env.DB);
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'pin-oddity', detail: 'my jumpscare clip' })).status, 402);
  await store.change(U.fan, 'Fan One', 500, 'award', { by: 'test' });
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'pin-oddity' })).status, 400, 'note required');
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'nope' })).status, 400);
  const r = await post('/api/tickets/redeem', 'fan', { prize: 'pin-oddity', detail: 'my jumpscare clip' });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 300);
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'pin-oddity', detail: 'again' })).status, 409, 'one waiting at a time');
  assert.match(discord.posted.at(-1).content, /Fan One\*\* redeemed \*\*Pin an Oddity/);
  assert.equal(discord.posted.at(-1).channel, MODS);

  assert.equal((await call('/api/tickets/staff', { as: 'fan' })).status, 403);
  const q = (await call('/api/tickets/staff', { as: 'boss' })).body.orders;
  assert.equal(q.length, 1);
  assert.equal(q[0].by, 'Fan One');
  assert.equal((await post(`/api/tickets/orders/${q[0].id}/refund`, 'fan', {})).status, 403);
  assert.equal((await post(`/api/tickets/orders/${q[0].id}/refund`, 'boss', { reason: 'That clip got removed' })).status, 200);
  assert.equal((await post(`/api/tickets/orders/${q[0].id}/done`, 'boss', {})).status, 404, 'handled once');
  assert.equal((await store.wallet(U.fan)).balance, 500);
  assert.match(discord.dms.at(-1).content, /refunded \(200 tickets back\)[\s\S]*That clip got removed/);

  const fav = await post('/api/tickets/redeem', 'fan', { prize: 'fan-favorite' });
  await post(`/api/tickets/orders/${fav.body.order.id}/done`, 'boss', {});
  const hs = (await call('/api/tickets', { as: 'fan' })).body.highScores;
  assert.equal(hs[0].badge, true);
  assert.equal(hs[0].me, true);
});

test('"Put a game on the ballot" shows up pre-ticked for Ringleaders and completes when a poll includes it', async () => {
  await ticketStore(env.DB).change(U.fan, 'Fan One', 300, 'award', { by: 'test' });
  const cat = (await call('/api/tickets', { as: 'fan' })).body.catalog;
  const peak = cat.find((c) => c.name === 'PEAK');
  assert.ok(peak);
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'ballot-pick', game: 'nope' })).status, 400);
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'ballot-pick', game: peak.key })).status, 200);
  const cur = (await call('/api/polls/current', { as: 'boss' })).body;
  assert.deepEqual(cur.prizePicks.map((p) => [p.key, p.by]), [[peak.key, 'Fan One']]);
  const lethal = cur.catalog.find((c) => c.name === 'Lethal Company');
  const made = await post('/api/polls', 'boss', { title: 'Saturday', candidates: [lethal.key, peak.key] });
  assert.equal(made.status, 201);
  assert.equal(made.body.prizePicks, 1);
  assert.equal((await call('/api/tickets/staff', { as: 'boss' })).body.orders.length, 0);
  assert.match(discord.dms.at(-1).content, /PEAK\*\* is on the ballot for \*\*Saturday/);
});

test('Ringleaders find members and hand out or take back tickets; balances never go negative', async () => {
  assert.equal((await call('/api/tickets/members?q=fa', { as: 'fan' })).status, 403);
  const found = (await call('/api/tickets/members?q=fa', { as: 'boss' })).body.members;
  assert.deepEqual(found.map((m) => m.name), ['Fan One'], 'bots are left out');
  assert.equal((await post('/api/tickets/award', 'boss', { userId: U.fan, amount: 9999 })).status, 400);
  const a = await post('/api/tickets/award', 'boss', { userId: U.fan, amount: 50, note: 'Best scream of the night' });
  assert.equal(a.body.balance, 50);
  assert.match(discord.dms.at(-1).content, /handed you 50 tickets: Best scream/);
  const b = await post('/api/tickets/award', 'boss', { userId: U.fan, amount: -80 });
  assert.equal(b.body.balance, 0);
  assert.equal((await post('/api/tickets/award', 'fan', { userId: U.fan2, amount: 5 })).status, 403);
});

test('members can hide from the High Scores', async () => {
  await ticketStore(env.DB).change(U.fan, 'Fan One', 40, 'award');
  await ticketStore(env.DB).change(U.fan2, 'Fan Two', 20, 'award');
  assert.deepEqual((await call('/api/tickets', { as: 'fan2' })).body.highScores.map((r) => r.name), ['Fan One', 'Fan Two']);
  await post('/api/tickets/privacy', 'fan', { hidden: true });
  const body = (await call('/api/tickets', { as: 'fan2' })).body;
  assert.deepEqual(body.highScores.map((r) => r.name), ['Fan Two']);
  assert.equal(body.wallet.rank, 1);
});

test('/api/me gives the sign-in menu what it needs for each kind of visitor', async () => {
  assert.deepEqual((await call('/api/me')).body, { signedIn: false });
  const stranger = (await call('/api/me', { as: 'stranger' })).body;
  assert.equal(stranger.member, false);
  assert.equal(stranger.tickets, undefined);
  const pollId = (await post('/api/polls', 'boss', { title: 'Friday', candidates: (await call('/api/polls/current', { as: 'boss' })).body.catalog.slice(0, 2).map((c) => c.key) })).body.id;
  const fan = (await call('/api/me', { as: 'fan' })).body;
  assert.equal(fan.member, true);
  assert.equal(fan.manager, false);
  assert.deepEqual(fan.polls, { open: 1, unvoted: [{ id: pollId, title: 'Friday' }] });
  assert.equal(fan.tickets.balance, 0);
  assert.equal(fan.staff, undefined);
  const boss = (await call('/api/me', { as: 'boss' })).body;
  assert.deepEqual(boss.staff, { passes: 0, oddities: 0, prizes: 0, chatLatest: null });
});

// ---------------------------------------------------------------- slash commands

async function signedInteraction(keys, payload, { tamper = false, ts = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(ts + body)));
  const res = await worker.fetch(new Request(ORIGIN + '/api/discord/interactions', {
    method: 'POST',
    headers: { 'X-Signature-Ed25519': Buffer.from(sig).toString('hex'), 'X-Signature-Timestamp': String(ts), 'Content-Type': 'application/json' },
    body: tamper ? body.replace('punch', 'pinch') : body
  }), env, { waitUntil: () => {} });
  return { status: res.status, body: res.status === 200 ? await res.json() : await res.text() };
}
const slash = (name, uid, options, roles = []) => ({ type: 2, guild_id: GUILD, member: { nick: NAMES[uid], roles, user: { id: uid, username: 'u' } }, data: { name, options } });

test('slash commands: signature checked, same bank as the website', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  env.DISCORD_PUBLIC_KEY = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('hex');

  assert.equal((await signedInteraction(keys, { type: 1 })).body.type, 1, 'PING → PONG');
  assert.equal((await signedInteraction(keys, slash('punch-card', U.fan), { tamper: true })).status, 401);
  assert.equal((await signedInteraction(keys, { type: 1 }, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401, 'stale timestamps refused');
  assert.equal(await verifyDiscord(env, 'zz', '1', ''), false);

  const p = await signedInteraction(keys, slash('punch-card', U.fan));
  assert.match(p.body.data.content, /\+10 tickets/);
  assert.equal(p.body.data.flags, 64, 'only you see it');
  assert.deepEqual(p.body.data.allowed_mentions, { parse: [] });
  assert.match((await signedInteraction(keys, slash('punch-card', U.fan))).body.data.content, /already punched/);
  assert.equal((await call('/api/tickets', { as: 'fan' })).body.wallet.balance, 10, 'the website sees the Discord punch');

  await post('/api/tickets/award', 'boss', { userId: U.fan, amount: 200 });
  assert.match((await signedInteraction(keys, slash('tickets', U.fan))).body.data.content, /\*\*210 tickets\*\*/);
  const pea = await signedInteraction(keys, slash('find-the-pea', U.fan, [{ name: 'shell', value: 2 }]));
  assert.match(pea.body.data.content, /Found it|Not under that one/);
  assert.match((await signedInteraction(keys, slash('redeem', U.fan, [{ name: 'prize', value: 'ballot-pick' }]))).body.data.content, /belpire\.com\/me/);
  assert.match((await signedInteraction(keys, slash('redeem', U.fan, [{ name: 'prize', value: 'fan-favorite' }]))).body.data.content, /Fan Favorite badge\*\* ordered/);
  assert.match((await signedInteraction(keys, slash('give-tickets', U.fan, [{ name: 'member', value: U.fan2 }, { name: 'amount', value: 5 }]))).body.data.content, /Only the Ringleaders/);
  assert.match((await signedInteraction(keys, slash('give-tickets', U.boss, [{ name: 'member', value: U.fan2 }, { name: 'amount', value: 25 }], [MANAGER]))).body.data.content, /Gave \*\*Fan Two\*\* 25 tickets/);
  const hs = await signedInteraction(keys, slash('high-scores', U.fan2));
  assert.equal(hs.body.data.flags, 0, 'High Scores are posted for everyone');
  assert.match(hs.body.data.content, /1\. Fan One: 2\d\d/);
  assert.match((await signedInteraction(keys, { ...slash('tickets', U.fan), guild_id: '999999999999999999' })).body.data.content, /only opens inside the Belpire server/);
});

test('command definitions are valid for Discord', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const c of COMMANDS) {
    assert.match(c.name, /^[a-z-]{1,32}$/);
    assert.ok(c.description.length >= 1 && c.description.length <= 100, c.name);
    for (const o of c.options || []) {
      assert.ok(o.description.length <= 100);
      for (const ch of o.choices || []) assert.ok(ch.name.length <= 100);
    }
  }
  assert.ok(COMMANDS.find((c) => c.name === 'redeem').options[0].choices.length === PRIZES.length);
});

test('the High Scores post every Sunday at noon Eastern, once, without hidden members', async () => {
  const ANN = '100000000000000077';
  const store = ticketStore(env.DB);
  const sunday = Date.parse('2026-11-01T17:05:00Z'); // Sun 12:05 ET
  assert.equal(await weeklyHighScores(env, sunday), false, 'no channel set: nothing');
  env.ANNOUNCEMENTS_CHANNEL_ID = ANN;
  assert.equal(await weeklyHighScores(env, sunday), false, 'nobody has tickets yet: skipped');
  await env.DB.prepare('DELETE FROM ticket_posts').run();
  await store.change(U.fan, 'Fan One', 40, 'award');
  await store.change(U.fan2, 'Fan Two', 90, 'award');
  await store.change(U.boss, 'Synister', 500, 'award');
  await store.setHidden(U.boss, 'Synister', true);
  assert.equal(await weeklyHighScores(env, Date.parse('2026-10-31T17:05:00Z')), false, 'Saturday: no');
  assert.equal(await weeklyHighScores(env, Date.parse('2026-11-01T15:55:00Z')), false, 'Sunday morning: not yet');
  const before = discord.posted.length;
  // Ledger rows are stamped with the real clock, so look back from now for the weekly part.
  assert.equal(await weeklyHighScores(env, sunday), true);
  assert.equal(await weeklyHighScores(env, sunday + 600000), false, 'only once a week');
  const sent = discord.posted.at(-1);
  assert.equal(discord.posted.length, before + 1);
  assert.equal(sent.channel, ANN);
  assert.deepEqual(sent.allowed_mentions, { parse: [] });
  assert.match(sent.content, /Midway High Scores/);
  assert.match(sent.content, /All-time leaders\*\*\n🥇 Fan Two · 90 tickets\n🥈 Fan One · 40 tickets/);
  assert.doesNotMatch(sent.content, /Synister/, 'hidden members stay off');

  assert.equal((await post('/api/tickets/post-scores', 'fan', {})).status, 403);
  const now = await post('/api/tickets/post-scores', 'boss', {});
  assert.equal(now.status, 200);
  assert.match(discord.posted.at(-1).content, /This week's top earners\*\*\n🥇 Fan Two · 90 tickets/);
  assert.equal((await call('/api/tickets/staff', { as: 'boss' })).body.announcements, true);
});

test('the High Scores message stays tidy', () => {
  const msg = highScoresMessage([], [{ name: '@everyone **x**', lifetime: 5 }], Date.parse('2026-11-01T17:05:00Z'));
  assert.match(msg, /A quiet week/);
  assert.match(msg, /🥇 everyone x · 5 tickets/);
  assert.ok(msg.length <= 2000);
});
