import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, SESSION_COOKIE } from '../auth.js';
import { _clearMemberCache, _clearCatalogCache } from '../polls.js';
import { _clearLiveCache } from '../live.js';
import { punchAmount, payAttendance, etDay, RULES, weeklyHighScores, highScoresMessage, quarterStart, quarterResets } from '../tickets.js';
import { ticketStore } from '../ticket-db.js';
import { pollStore } from '../poll-db.js';
import { COMMANDS, verifyDiscord } from '../interactions.js';
import { PRIZES } from '../prizes.js';
import { fakeD1 } from './helpers/d1.mjs';
import { clock } from '../midway.js';
import { getWeeklyLineup } from '../../site/midway/rotation.js';

// The Midway rotates booths weekly; move the clock to a Tuesday afternoon when this booth is open.
const realNow = clock.now;
function openFor(id) {
  for (let w = 0; w < 6; w++) {
    const at = Date.parse('2026-11-24T19:00:00Z') + w * 7 * 86400000;
    if (getWeeklyLineup(new Date(at)).activeGames.includes(id)) {
      clock.now = () => at;
      return at;
    }
  }
  throw new Error(`${id} never opens`);
}

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
afterEach(() => { globalThis.fetch = realFetch; clock.now = realNow; });

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
  openFor('find-the-pea');
  let wins = 0;
  for (let i = 0; i < 5; i++) {
    const r = await post('/api/tickets/games/shell', 'fan', { pick: 1 });
    assert.equal(r.status, 200);
    assert.ok([0, 1, 2].includes(r.body.pea));
    assert.equal(r.body.win, r.body.pea === 1);
    assert.equal(r.body.amount, r.body.win ? 12 : 0);
    assert.equal(r.body.playsLeft, 5 - i - 1);
    if (r.body.win) wins++;
  }
  assert.equal((await post('/api/tickets/games/shell', 'fan', { pick: 0 })).status, 429);
  assert.equal((await post('/api/tickets/games/shell', 'fan2', { pick: 7 })).status, 400);
  assert.equal((await call('/api/tickets', { as: 'fan' })).body.wallet.balance, wins * 12);
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
  assert.deepEqual(me.show, { title: 'Friday Fright', checkedIn: true, paid: RULES.attendPerCheck * 2, cap: RULES.attendCap, doubled: false });
});

test('the Prize Booth: needs enough Slivers and a note, tells the mods, refunds put Slivers back', async () => {
  const store = ticketStore(env.DB);
  const game = 'https://store.steampowered.com/app/1966720';
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'steam-5', detail: game })).status, 402);
  assert.equal((await store.orderCounts('2000-01-01', U.fan)).mine['steam-5'], undefined, 'a failed purchase leaves no order behind');
  await store.change(U.fan, 'Fan One', 4200, 'award', { by: 'test' });
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'steam-5' })).status, 400, 'note required');
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'nope' })).status, 400);
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'fan-favorite' })).status, 400, 'old prizes are gone from the booth');
  const r = await post('/api/tickets/redeem', 'fan', { prize: 'steam-5', detail: game });
  assert.equal(r.status, 200);
  assert.equal(r.body.balance, 600);
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'steam-5', detail: 'again' })).status, 409, 'one waiting at a time');
  assert.match(discord.posted.at(-1).content, /Fan One\*\* redeemed \*\*Steam game, \$5 or less/);
  assert.equal(discord.posted.at(-1).channel, MODS);

  assert.equal((await call('/api/tickets/staff', { as: 'fan' })).status, 403);
  const q = (await call('/api/tickets/staff', { as: 'boss' })).body.orders;
  assert.equal(q.length, 1);
  assert.equal(q[0].by, 'Fan One');
  assert.equal((await post(`/api/tickets/orders/${q[0].id}/refund`, 'fan', {})).status, 403);
  assert.equal((await post(`/api/tickets/orders/${q[0].id}/refund`, 'boss', { reason: 'That game is not for sale' })).status, 200);
  assert.equal((await post(`/api/tickets/orders/${q[0].id}/done`, 'boss', {})).status, 404, 'handled once');
  assert.equal((await store.wallet(U.fan)).balance, 4200);
  assert.match(discord.dms.at(-1).content, /refunded \(3600 Slivers back\)[\s\S]*That game is not for sale/);
});

test('real-money prizes: one per member per quarter, a stock cap for everyone, gifts gated by coin', async () => {
  const store = ticketStore(env.DB);
  const game = 'https://store.steampowered.com/app/1966720';
  await store.change(U.fan, 'Fan One', 8000, 'award', { by: 'test' });
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'steam-10', detail: game })).status, 200);
  const second = await post('/api/tickets/redeem', 'fan', { prize: 'steam-5', detail: game });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'member', 'a real-money prize already claimed this quarter');
  const shelf = (await call('/api/tickets', { as: 'fan' })).body.prizes;
  assert.equal(shelf.find((p) => p.id === 'steam-10').left, 3);
  assert.equal(shelf.find((p) => p.id === 'steam-5').locked, 'member');
  assert.equal(shelf.find((p) => p.id === 'tarot').locked, 'pending');

  // The booth runs out: 6 of the $5 game in a quarter, however many people want one.
  for (let i = 0; i < 6; i++) await store.order({ id: `a${i}`.padEnd(24, '0'), user_id: `9${i}`, name: 'Other', prize: 'steam-5', cost: 2400, detail: game, game_key: null, game_name: null });
  await store.change(U.fan2, 'Fan Two', 3000, 'award', { by: 'test' });
  const out = await post('/api/tickets/redeem', 'fan2', { prize: 'steam-5', detail: game });
  assert.equal(out.body.error, 'soldout');
  assert.equal((await store.wallet(U.fan2)).balance, 3000, 'no Slivers taken');

  // The $25 card needs The Closet coin (24,000 lifetime) and the Slivers.
  const gate = await post('/api/tickets/redeem', 'fan2', { prize: 'gift-card-25', detail: 'Steam' });
  assert.equal(gate.status, 403);
  assert.equal(gate.body.error, 'gate');
  assert.match(gate.body.message, /The Closet/);
  assert.equal((await call('/api/tickets', { as: 'fan2' })).body.prizes.find((p) => p.id === 'gift-card-25').gateCoin, 'The Closet');
  await store.change(U.fan2, 'Fan Two', 34000, 'award', { by: 'test' });
  assert.equal((await post('/api/tickets/redeem', 'fan2', { prize: 'gift-card-25', detail: 'Steam' })).status, 200);

  // The Fortune Teller's reading waits for her OK.
  const tarot = await post('/api/tickets/redeem', 'fan2', { prize: 'tarot', detail: 'Will we win tonight?' });
  assert.equal(tarot.status, 403);
  assert.equal(tarot.body.error, 'pending');
  assert.equal((await store.orderCounts('2000-01-01', U.fan2)).mine.tarot, undefined);
});

test('quarters start at midnight Eastern on Jan 1, Apr 1, Jul 1 and Oct 1', () => {
  assert.equal(quarterStart(Date.parse('2026-11-21T22:00:00Z')), '2026-10-01T04:00:00.000Z');
  assert.equal(quarterStart(Date.parse('2026-01-15T12:00:00Z')), '2026-01-01T05:00:00.000Z');
  assert.equal(quarterStart(Date.parse('2026-04-01T03:59:00Z')), '2026-01-01T05:00:00.000Z', 'still March 31 in the east');
  assert.equal(quarterStart(Date.parse('2026-07-04T12:00:00Z')), '2026-07-01T04:00:00.000Z');
  assert.deepEqual(['2026-01-10', '2026-05-10', '2026-08-10', '2026-11-21'].map((d) => quarterResets(Date.parse(`${d}T17:00:00Z`))), ['Apr 1', 'Jul 1', 'Oct 1', 'Jan 1']);
});

test('Sponsor a Double Night: one per game night, the rest wait; check-ins and the cron pay double', async () => {
  const store = ticketStore(env.DB);
  await store.change(U.fan, 'Fan One', 5000, 'award', { by: 'test' });
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'double-night' })).status, 200);
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'double-night' })).status, 200, 'extra ones queue up');
  assert.equal((await call('/api/tickets/staff', { as: 'boss' })).body.orders.length, 0, 'they run themselves, nothing for a Ringleader to do');
  assert.equal((await call('/api/tickets/staff', { as: 'boss' })).body.doubleNights, 2);

  const polls = pollStore(env.DB);
  await polls.create({ id: 'night1', title: 'Friday Fright', candidates: [], created_by: U.boss, created_by_name: 'Synister', created_at: Date.now() - 86400000 });
  await env.DB.prepare("UPDATE polls SET status = 'scheduled', event_start = ? WHERE id = 'night1'").bind(new Date(Date.now() - 3600e3).toISOString()).run();
  discord.voice[U.fan2] = { channel_id: STAGE };
  const c = await post('/api/tickets/checkin', 'fan2');
  assert.equal(c.body.earned, RULES.attendPerCheck * 2);
  assert.equal(c.body.cap, RULES.attendCap * 2);
  assert.equal(c.body.doubled, true);
  assert.match(discord.posted.at(-1).content, /Double Night!\*\* Fan One sponsored it/);
  assert.match(discord.dms.at(-1).content, /Your \*\*Double Night\*\* is on/);
  assert.equal(await payAttendance(env, Date.now() + 600000), RULES.attendPerCheck * 2);
  assert.equal((await call('/api/tickets/staff', { as: 'boss' })).body.doubleNights, 1, 'only one used up for this night');
  assert.equal((await call('/api/tickets', { as: 'fan2' })).body.show.doubled, true);

  // Next game night takes the next one, and after that it is back to normal.
  const { showBoost } = await import('../tickets.js');
  assert.equal(await showBoost(env, { key: 'night:night1', title: 'Friday Fright' }), 2);
  assert.equal(await showBoost(env, { key: 'night:night2', title: 'Saturday' }), 2);
  assert.equal(await showBoost(env, { key: 'night:night3', title: 'Sunday' }), 1);
  const mine = (await call('/api/tickets', { as: 'fan' })).body.orders;
  assert.ok(mine.every((o) => o.status === 'done' && o.reason === 'Played at a game night'));
});

test('Golden Ticket drawing: up to 5 entries each, one winner drawn Backstage, entries closed', async () => {
  const store = ticketStore(env.DB);
  await store.change(U.fan, 'Fan One', 9000, 'award', { by: 'test' });
  await store.change(U.fan2, 'Fan Two', 3000, 'award', { by: 'test' });
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'golden-ticket' })).status, 200);
  const sixth = await post('/api/tickets/redeem', 'fan', { prize: 'golden-ticket' });
  assert.equal(sixth.status, 409);
  assert.equal((await store.wallet(U.fan)).balance, 1500);
  assert.equal((await post('/api/tickets/redeem', 'fan2', { prize: 'golden-ticket' })).status, 200);

  const staff = (await call('/api/tickets/staff', { as: 'boss' })).body;
  assert.deepEqual(staff.drawing, { entries: 6, players: 2 });
  assert.equal(staff.orders.length, 0, 'entries are not orders for a Ringleader to handle');
  assert.equal((await post('/api/tickets/draw', 'fan', {})).status, 403);
  const win = await post('/api/tickets/draw', 'boss', {});
  assert.equal(win.status, 200);
  assert.ok(['Fan One', 'Fan Two'].includes(win.body.winner));
  assert.equal(win.body.entries, 6);
  assert.match(discord.dms.at(-1).content, /You won the Golden Ticket drawing/);
  assert.equal(discord.dms.at(-1).channel, 'dm-' + win.body.userId);
  assert.match(discord.posted.at(-1).content, /Golden Ticket drawing: \*\*(Fan One|Fan Two)\*\* won, out of 6 entries from 2 members/);
  assert.equal((await call('/api/tickets/staff', { as: 'boss' })).body.drawing.entries, 0);
  assert.equal((await post('/api/tickets/draw', 'boss', {})).status, 409, 'nobody left to draw');
  assert.equal((await post('/api/tickets/redeem', 'fan', { prize: 'golden-ticket' })).status, 409, 'the 5 per quarter includes the drawn ones');
});

test('old prizes: orders that were already paid for still finish, and the ballot pick still ticks itself off', async () => {
  const store = ticketStore(env.DB);
  const cat = (await call('/api/tickets', { as: 'fan' })).body.catalog;
  const peak = cat.find((c) => c.name === 'PEAK');
  assert.ok(peak);
  await store.order({ id: 'b'.repeat(24), user_id: U.fan, name: 'Fan One', prize: 'ballot-pick', cost: 250, detail: null, game_key: peak.key, game_name: 'PEAK' });
  const mine = (await call('/api/tickets', { as: 'fan' })).body.orders;
  assert.equal(mine[0].name, 'Put a game on the ballot');
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
  assert.match(discord.dms.at(-1).content, /handed you 50 Slivers: Best scream/);
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
  assert.match(p.body.data.content, /\+10 Slivers/);
  assert.equal(p.body.data.flags, 64, 'only you see it');
  assert.deepEqual(p.body.data.allowed_mentions, { parse: [] });
  assert.match((await signedInteraction(keys, slash('punch-card', U.fan))).body.data.content, /already punched/);
  assert.equal((await call('/api/tickets', { as: 'fan' })).body.wallet.balance, 10, 'the website sees the Discord punch');

  await post('/api/tickets/award', 'boss', { userId: U.fan, amount: 200 });
  assert.match((await signedInteraction(keys, slash('slivers', U.fan))).body.data.content, /\*\*210 Slivers\*\*/);
  openFor('find-the-pea');
  const pea = await signedInteraction(keys, slash('find-the-pea', U.fan, [{ name: 'shell', value: 2 }]));
  assert.match(pea.body.data.content, /Found it|Not under that one/);
  openFor('ring-toss');
  assert.match((await signedInteraction(keys, slash('ring-toss', U.fan, [{ name: 'row', value: 'back' }]))).body.data.content, /back\*\* row… (\*clink!\*|it bounces)/);
  openFor('high-striker');
  assert.match((await signedInteraction(keys, slash('high-striker', U.fan))).body.data.content, /WHAM!\* [▰▱]{10}/);
  clock.now = realNow;
  const booth = (await signedInteraction(keys, slash('prizes', U.fan))).body.data.content;
  assert.match(booth, /Steam game, \$5 or less\*\*: 3600 Slivers \(6 left this quarter\)/);
  assert.match(booth, /Live tarot reading\*\*: 5400 Slivers \(pending approval\)/);
  assert.match(booth, /\$25 gift card\*\*: 36000 Slivers \(needs The Closet\)/);
  assert.match((await signedInteraction(keys, slash('redeem', U.fan, [{ name: 'prize', value: 'artwork' }, { name: 'note', value: 'My avatar' }]))).body.data.content, /Custom artwork costs 7500 Slivers/);
  assert.match((await signedInteraction(keys, slash('redeem', U.fan, [{ name: 'prize', value: 'tarot' }, { name: 'note', value: 'Hi' }]))).body.data.content, /isn't open yet/);
  assert.match((await signedInteraction(keys, slash('give-slivers', U.fan, [{ name: 'member', value: U.fan2 }, { name: 'amount', value: 5 }]))).body.data.content, /Only the Ringleaders/);
  assert.match((await signedInteraction(keys, slash('give-slivers', U.boss, [{ name: 'member', value: U.fan2 }, { name: 'amount', value: 25 }], [MANAGER]))).body.data.content, /Gave \*\*Fan Two\*\* 25 Slivers/);
  assert.match((await signedInteraction(keys, slash('poll', U.fan))).body.data.content, /Only the Ringleaders can send out the poll/);
  assert.match((await signedInteraction(keys, slash('poll', U.boss, [], [MANAGER]))).body.data.content, /No poll is open right now/);
  const hs = await signedInteraction(keys, slash('high-scores', U.fan2));
  assert.equal(hs.body.data.flags, 0, 'High Scores are posted for everyone');
  // 210 Slivers so far, plus whatever the three booth plays above won (they roll for real)
  assert.ok(Number(hs.body.data.content.match(/1\. Fan One: (\d+)/)?.[1]) >= 210, hs.body.data.content);
  assert.match((await signedInteraction(keys, { ...slash('slivers', U.fan), guild_id: '999999999999999999' })).body.data.content, /only opens inside the Belpire server/);
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
  assert.match(sent.content, /All-time leaders\*\*\n🥇 Fan Two · 90 Slivers\n🥈 Fan One · 40 Slivers/);
  assert.doesNotMatch(sent.content, /Synister/, 'hidden members stay off');

  assert.equal((await post('/api/tickets/post-scores', 'fan', {})).status, 403);
  const now = await post('/api/tickets/post-scores', 'boss', {});
  assert.equal(now.status, 200);
  assert.match(discord.posted.at(-1).content, /This week's top earners\*\*\n🥇 Fan Two · 90 Slivers/);
  assert.equal((await call('/api/tickets/staff', { as: 'boss' })).body.announcements, true);
});

test('the High Scores message stays tidy', () => {
  const msg = highScoresMessage([], [{ name: '@everyone **x**', lifetime: 5 }], Date.parse('2026-11-01T17:05:00Z'));
  assert.match(msg, /A quiet week/);
  assert.match(msg, /🥇 everyone x · 5 Slivers/);
  assert.ok(msg.length <= 2000);
});

test('Ring Toss: pick a row, odds and prizes by row, five tosses a day', async () => {
  openFor('ring-toss');
  assert.equal((await post('/api/tickets/games/rings', 'fan', { row: 'roof' })).status, 400);
  assert.equal((await post('/api/tickets/games/rings', 'fan', { row: '__proto__' })).status, 400);
  const prize = { front: 6, middle: 15, back: 50 };
  let total = 0;
  for (let i = 0; i < 5; i++) {
    const row = ['front', 'middle', 'back'][i % 3];
    const r = await post('/api/tickets/games/rings', 'fan', { row });
    assert.equal(r.status, 200);
    assert.equal(r.body.row, row);
    assert.ok(r.body.bottle >= 0 && r.body.bottle < 4);
    assert.equal(r.body.amount, r.body.win ? prize[row] : 0);
    assert.equal(r.body.playsLeft, 5 - i - 1);
    total += r.body.amount;
  }
  assert.equal((await post('/api/tickets/games/rings', 'fan', { row: 'front' })).status, 429);
  const me = (await call('/api/tickets', { as: 'fan' })).body;
  assert.equal(me.wallet.balance, total);
  assert.equal(me.midway.games.find((g) => g.id === 'ring-toss').playsUsed, 5);
});

test('High Striker: heights match the prize table, three swings a day', async () => {
  openFor('high-striker');
  const pay = (h) => (h === 10 ? 40 : h >= 7 ? 12 : h >= 4 ? 5 : 0);
  for (let i = 0; i < 3; i++) {
    const r = await post('/api/tickets/games/striker', 'fan2', {});
    assert.equal(r.status, 200);
    assert.ok(r.body.height >= 1 && r.body.height <= 10, 'height is on the scale');
    assert.equal(r.body.amount, pay(r.body.height));
    assert.equal(r.body.bell, r.body.height === 10);
  }
  assert.equal((await post('/api/tickets/games/striker', 'fan2', {})).status, 429);
});

test('a booth that is shuttered this week turns the old routes away too', async () => {
  for (let w = 0; w < 6; w++) {
    const at = Date.parse('2026-11-24T19:00:00Z') + w * 7 * 86400000;
    if (!getWeeklyLineup(new Date(at)).activeGames.includes('find-the-pea')) {
      clock.now = () => at;
      break;
    }
  }
  const r = await post('/api/tickets/games/shell', 'fan', { pick: 0 });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /polishing the shells/);
});

test('the Concession Tent: snacks cost Slivers, curds are counted, something eats what you leave at night', async () => {
  const { concession, RULES: R } = await import('../tickets.js');
  await post('/api/tickets/award', 'boss', { userId: U.fan2, amount: 60 });
  const before = (await call('/api/tickets', { as: 'fan2' })).body.wallet.balance;
  const noon = Date.parse('2026-11-04T17:00:00Z'); // 12:00 Eastern
  const a = await concession(env, U.fan2, 'Fan Two', 'curds', false, noon);
  assert.equal(a.balance, before - R.snacks.curds.cost);
  assert.equal(a.curdsAllTime, 1);
  const b = await concession(env, U.fan2, 'Fan Two', 'curds', false, noon + 60e3);
  assert.equal(b.curdsAllTime, 2);
  const pop = await concession(env, U.fan2, 'Fan Two', 'popcorn', false, noon + 120e3);
  assert.equal(pop.curdsAllTime, null);
  const day = await concession(env, U.fan2, 'Fan Two', 'curds', true, noon + 180e3);
  assert.ok(day.left && !day.eaten, 'left out in daylight, still there');
  const late = await concession(env, U.fan2, 'Fan Two', 'curds', true, Date.parse('2026-11-05T07:30:00Z')); // 2:30 a.m. Eastern
  assert.ok(late.eaten, 'left out at night: something ate it');
  await assert.rejects(concession(env, U.fan2, 'Fan Two', 'funnel-cake', false, noon), /doesn't serve that/);
  await assert.rejects(concession(env, U.stranger, 'Nobody', 'curds', false, noon), /costs 5 Slivers/);
  const ledger = (await call('/api/tickets', { as: 'fan2' })).body;
  assert.ok(ledger.history?.some?.((h) => /Concession Tent: Cheese Curds/.test(h.note)) ?? true);
});
