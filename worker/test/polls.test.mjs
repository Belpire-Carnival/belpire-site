import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, SESSION_COOKIE } from '../auth.js';
import { channelPermissions, PERMS } from '../discord-bot.js';
import { purgeOldBallots, doomPicks, doomEligible, safeArt, buildCatalog, validRanking, tally, winners, validStart, cleanTitle, pollConfig, eventPayload, _clearMemberCache, _clearCatalogCache } from '../polls.js';
import { fakeD1 } from './helpers/d1.mjs';

const ORIGIN = 'https://belpire.com';
const GUILD = '100000000000000001';
const STAGE = '100000000000000002';
const GENERAL = '100000000000000003';
const RINGMASTER_ROLE = '200000000000000001';
const GUARD_ROLE = '200000000000000002';
const USERS = { boss: '300000000000000001', guard: '300000000000000002', fan: '300000000000000003', fan2: '300000000000000004', stranger: '300000000000000009' };

const feed = { tracked: [{ appid: 1966720, name: 'Lethal Company', tent: 'horror' }, { appid: 553850, name: 'Helldivers 2', tent: 'other' }, { appid: 3527290, name: 'PEAK', tent: 'party' }] };
const packs = { packs: [
  { name: 'The Jackbox Party Pack 7', short: 'Pack 7', appid: 1211630, games: [{ name: 'Quiplash 3', min: 3, max: 8 }, { name: 'Champ\'d Up', min: 3, max: 8 }] },
  { name: 'Trivia Murder Party 3', short: 'Trivia Murder Party 3', appid: 3048060, games: [{ name: 'Trivia Murder Party 3', min: 1, max: 8 }] }
] };

let env;
let discord;
const realFetch = globalThis.fetch;

function setup() {
  _clearMemberCache();
  _clearCatalogCache();
  discord = { messages: [], events: [], failPosts: false, failEvents: false, stageType: 2,
    botRoles: ['600000000000000001'],
    roles: [
      { id: GUILD, permissions: String((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 20n)) }, // @everyone: view, send, embed, connect
      { id: '600000000000000001', permissions: String(1n << 44n) } // bot role: create events
    ],
    overwrites: { [GENERAL]: [], [STAGE]: [] } };
  const members = {
    [USERS.boss]: { nick: 'RingMaster', roles: [RINGMASTER_ROLE], user: { username: 'boss' } },
    [USERS.guard]: { roles: [GUARD_ROLE], user: { username: 'guard', global_name: 'Carnival Guard' } },
    [USERS.fan]: { roles: [], user: { username: 'fan' } },
    [USERS.fan2]: { roles: ['999999999999999999'], user: { username: 'fan2' } }
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    assert.equal(init.headers.Authorization, 'Bot bot-token');
    if (u.pathname === `/api/v10/guilds/${GUILD}/members/700000000000000001`) return Response.json({ roles: discord.botRoles, user: { id: '700000000000000001' } });
    let m = u.pathname.match(/^\/api\/v10\/guilds\/(\d+)\/members\/(\d+)$/);
    if (m) return members[m[2]] ? Response.json(members[m[2]]) : Response.json({ code: 10007 }, { status: 404 });
    if (u.pathname === '/api/v10/users/@me') return Response.json({ id: '700000000000000001', username: 'Belpire Bot' });
    if (u.pathname === `/api/v10/guilds/${GUILD}/members/700000000000000001`) return Response.json({ roles: discord.botRoles, user: { id: '700000000000000001' } });
    if (u.pathname === `/api/v10/guilds/${GUILD}/roles`) return Response.json(discord.roles);
    m = u.pathname.match(/^\/api\/v10\/channels\/(\d+)$/);
    if (m) {
      if (m[1] === GENERAL) return Response.json({ id: GENERAL, name: 'general', type: 0, permission_overwrites: discord.overwrites[GENERAL] });
      if (m[1] === STAGE) return Response.json({ id: STAGE, name: 'The Main Stage', type: discord.stageType, permission_overwrites: discord.overwrites[STAGE] });
      return Response.json({ code: 10003 }, { status: 404 });
    }
    m = u.pathname.match(/^\/api\/v10\/channels\/(\d+)\/messages$/);
    if (m) {
      if (discord.failPosts) return Response.json({ code: 50013 }, { status: 403 });
      discord.messages.push({ channel: m[1], body: JSON.parse(init.body) });
      return Response.json({ id: '400000000000000001' });
    }
    if (u.pathname === `/api/v10/guilds/${GUILD}/scheduled-events`) {
      if (discord.failEvents) return Response.json({ code: 50013 }, { status: 403 });
      discord.events.push(JSON.parse(init.body));
      return Response.json({ id: '500000000000000001' });
    }
    throw new Error('unexpected fetch ' + url);
  };
  env = {
    SESSION_SECRET: 'x'.repeat(48),
    DISCORD_CLIENT_ID: '111111111111111111',
    DISCORD_CLIENT_SECRET: 's',
    DISCORD_INVITE: 'https://discord.gg/example',
    DISCORD_BOT_TOKEN: 'bot-token',
    DISCORD_GUILD_ID: GUILD,
    POLL_MANAGER_ROLE_IDS: `${RINGMASTER_ROLE}, ${GUARD_ROLE}`,
    MAIN_STAGE_CHANNEL_ID: STAGE,
    GENERAL_CHANNEL_ID: GENERAL,
    DB: fakeD1(),
    ASSETS: { fetch: async (req) => {
      const p = new URL(req.url ?? req).pathname;
      if (p === '/data/feed.json') return Response.json(feed);
      if (p === '/jackbox/packs.json') return Response.json(packs);
      return new Response('nope', { status: 404 });
    } }
  };
}
beforeEach(setup);
afterEach(() => { globalThis.fetch = realFetch; });

async function cookieFor(uid, name = 'Someone') {
  const t = Math.floor(Date.now() / 1000);
  return `${SESSION_COOKIE}=${await seal({ uid, name, iat: t, exp: t + 3600 }, env.SESSION_SECRET, 'session')}`;
}
const ctx = { waitUntil: (p) => p };
async function api(path, { as, method = 'GET', body, origin = ORIGIN } = {}) {
  const headers = {};
  if (as) headers.Cookie = await cookieFor(USERS[as]);
  if (method !== 'GET') {
    headers.Origin = origin;
    headers['Content-Type'] = 'application/json';
  }
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// ---------------------------------------------------------------- pure helpers

test('catalog joins tracked games and Jackbox games with stable keys', () => {
  const c = buildCatalog(feed, packs);
  assert.deepEqual(c.map((x) => x.key), ['steam-1966720', 'steam-553850', 'steam-3527290', 'jb-1211630-quiplash-3', 'jb-1211630-champ-d-up', 'jb-3048060-trivia-murder-party-3']);
  assert.equal(c[3].name, 'Quiplash 3 (Pack 7)');
  assert.equal(c[5].name, 'Trivia Murder Party 3');
  assert.equal(buildCatalog({ favorites: [{ appid: 1, name: 'Fallback' }] }, null)[0].key, 'steam-1');
});

test('ballots: 1–4 distinct keys from the poll', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(validRanking(['a'], keys), true);
  assert.equal(validRanking(['a', 'b', 'c', 'd'], keys), true);
  assert.equal(validRanking([], keys), false);
  assert.equal(validRanking(['a', 'b', 'c', 'd', 'e'], keys), false);
  assert.equal(validRanking(['a', 'a'], keys), false);
  assert.equal(validRanking(['z'], keys), false);
  assert.equal(validRanking('a', keys), false);
});

test('ranked-choice tally: 4-3-2-1 points, ties by first places, then mentions, then A–Z', () => {
  const cands = ['A', 'B', 'C', 'D', 'E', 'F'].map((k) => ({ key: k, name: `Game ${k}` }));
  const standings = tally(cands, [['A', 'B', 'C', 'D'], ['B', 'A', 'E'], ['C'], ['B']]);
  assert.deepEqual(standings.map((r) => [r.key, r.points, r.firsts]), [['B', 11, 2], ['A', 7, 1], ['C', 6, 1], ['E', 2, 0], ['D', 1, 0], ['F', 0, 0]]);
  assert.deepEqual(winners(standings).map((r) => r.key), ['B', 'A', 'C', 'E']);
  const tie = tally([{ key: 'x', name: 'Zed' }, { key: 'y', name: 'Alpha' }], [['x'], ['y']]);
  assert.deepEqual(tie.map((r) => r.name), ['Alpha', 'Zed']);
  assert.deepEqual(winners(tally(cands, [])), []);
});

test('start time must carry an offset and be 5 minutes to 6 months out', () => {
  const now = Date.parse('2026-10-26T20:00:00Z');
  assert.equal(validStart('2026-10-30T20:00:00-04:00', now), '2026-10-31T00:00:00.000Z');
  assert.equal(validStart('2026-10-30T20:00', now), null);
  assert.equal(validStart('2026-10-26T20:02:00Z', now), null);
  assert.equal(validStart('2027-10-30T20:00:00Z', now), null);
  assert.equal(validStart('nonsense', now), null);
});

test('titles are tidied and config problems are named', () => {
  assert.equal(cleanTitle('  Friday\n\nFright  Night '), 'Friday Fright Night');
  assert.equal(cleanTitle(''), 'Game Night');
  assert.deepEqual(pollConfig({}).problems, ['DB binding', 'DISCORD_BOT_TOKEN', 'DISCORD_GUILD_ID', 'MAIN_STAGE_CHANNEL_ID', 'GENERAL_CHANNEL_ID', 'POLL_MANAGER_ROLE_IDS']);
  const long = eventPayload({ title: 'T'.repeat(90), results: [{ name: 'Some Long Game Name', points: 3 }] });
  assert.ok(long.name.length <= 100);
});

// ---------------------------------------------------------------- full flow

test('the whole night: open, vote, close to #general, schedule an event, announce it', async () => {
  // Anyone can look; only managers get the catalog.
  let r = await api('/api/polls/current');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.me, { signedIn: false, member: false, manager: false });
  assert.equal(r.body.poll, null);
  r = await api('/api/polls/current', { as: 'fan' });
  assert.equal(r.body.me.member, true);
  assert.equal(r.body.me.manager, false);
  assert.equal(r.body.catalog, undefined);
  r = await api('/api/polls/current', { as: 'guard' });
  assert.equal(r.body.me.manager, true);
  assert.equal(r.body.catalog.length, 6);

  // Members can't open polls; a Carnival Guard can.
  r = await api('/api/polls', { as: 'fan', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  assert.equal(r.status, 403);
  r = await api('/api/polls', { as: 'guard', method: 'POST', body: { title: 'Friday Fright', candidates: ['steam-1966720'] } });
  assert.equal(r.status, 400);
  r = await api('/api/polls', { as: 'guard', method: 'POST', body: { title: 'Friday Fright', candidates: ['steam-1966720', 'steam-553850', 'steam-3527290', 'jb-1211630-quiplash-3', 'jb-3048060-trivia-murder-party-3'] } });
  assert.equal(r.status, 201);
  const id = r.body.id;

  // Votes: members only, results hidden while open, a revote replaces the old ballot.
  r = await api(`/api/polls/${id}/ballot`, { as: 'stranger', method: 'POST', body: { ranking: ['steam-1966720'] } });
  assert.equal(r.status, 403);
  r = await api(`/api/polls/${id}/ballot`, { method: 'POST', body: { ranking: ['steam-1966720'] } });
  assert.equal(r.status, 401);
  r = await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-1966720', 'steam-1966720'] } });
  assert.equal(r.status, 400);
  await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  r = await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-1966720', 'jb-1211630-quiplash-3', 'steam-3527290', 'steam-553850'] } });
  assert.equal(r.status, 200);
  await api(`/api/polls/${id}/ballot`, { as: 'fan2', method: 'POST', body: { ranking: ['jb-1211630-quiplash-3', 'steam-1966720'] } });
  await api(`/api/polls/${id}/ballot`, { as: 'boss', method: 'POST', body: { ranking: ['steam-1966720'] } });
  r = await api('/api/polls/current', { as: 'fan' });
  assert.equal(r.body.poll.voteCount, 3);
  assert.equal(r.body.poll.results, null);
  assert.deepEqual(r.body.poll.myBallot, ['steam-1966720', 'jb-1211630-quiplash-3', 'steam-3527290', 'steam-553850']);

  // Scheduling before closing is refused; members can't close.
  r = await api(`/api/polls/${id}/schedule`, { as: 'boss', method: 'POST', body: { start: '2099-01-01T20:00:00-05:00' } });
  assert.equal(r.status, 409);
  r = await api(`/api/polls/${id}/close`, { as: 'fan', method: 'POST', body: {} });
  assert.equal(r.status, 403);

  // Close: tally, post results to #general, no more votes.
  r = await api(`/api/polls/${id}/close`, { as: 'guard', method: 'POST', body: {} });
  assert.deepEqual(r.body, { ok: true, posted: true, reason: null });
  assert.equal(discord.messages.length, 1);
  assert.equal(discord.messages[0].channel, GENERAL);
  assert.deepEqual(discord.messages[0].body.allowed_mentions, { parse: [] });
  const desc = discord.messages[0].body.embeds[0].description;
  assert.match(desc, /\*\*1\. Lethal Company\*\*  ·  11 pts/); // 4 + 3 + 4
  assert.match(desc, /\*\*2\. Quiplash 3 \(Pack 7\)\*\*  ·  7 pts/); // 3 + 4
  assert.match(desc, /3 members voted/);
  r = await api(`/api/polls/${id}/close`, { as: 'guard', method: 'POST', body: {} });
  assert.equal(r.status, 409);
  r = await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  assert.equal(r.status, 409);
  r = await api('/api/polls/current', { as: 'fan' });
  assert.equal(r.body.poll.status, 'closed');
  assert.equal(r.body.poll.results[0].name, 'Lethal Company');

  // Schedule: bad times refused, then the event lands in The Main Stage and #general gets a second post.
  r = await api(`/api/polls/${id}/schedule`, { as: 'guard', method: 'POST', body: { start: '2026-10-30T20:00' } });
  assert.equal(r.status, 400);
  const start = new Date(Date.now() + 3 * 86400 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  r = await api(`/api/polls/${id}/schedule`, { as: 'boss', method: 'POST', body: { start } });
  assert.equal(r.status, 200);
  assert.equal(r.body.eventUrl, `https://discord.com/events/${GUILD}/500000000000000001`);
  assert.equal(discord.events.length, 1);
  assert.equal(discord.events[0].channel_id, STAGE);
  assert.equal(discord.events[0].entity_type, 2);
  assert.match(discord.events[0].name, /^Friday Fright: Lethal Company · Quiplash 3 \(Pack 7\)/);
  assert.equal(discord.messages.length, 2);
  assert.match(discord.messages[1].body.content, /^Game night is set for <t:\d+:F>/);
  assert.equal(discord.messages[1].body.embeds[0].url, r.body.eventUrl);
  r = await api('/api/polls/current', { as: 'fan' });
  assert.equal(r.body.poll, null, 'a scheduled night leaves the ballot box free');
  assert.equal(r.body.upcoming.length, 1);
  assert.equal(r.body.upcoming[0].title, 'Friday Fright');
  assert.deepEqual(r.body.upcoming[0].lineup.slice(0, 2), ['Lethal Company', 'Quiplash 3 (Pack 7)']);
  assert.equal(r.body.upcoming[0].eventUrl, `https://discord.com/events/${GUILD}/500000000000000001`);
  r = await api('/api/polls/current');
  assert.equal(r.body.upcoming[0].eventUrl, null, 'event links are for members');

  // A new poll can open once the last one is scheduled.
  r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  assert.equal(r.status, 201);
});

test('failed Discord posts can be retried; a failed event leaves the poll ready to try again', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  const id = r.body.id;
  await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  discord.failPosts = true;
  r = await api(`/api/polls/${id}/close`, { as: 'boss', method: 'POST', body: {} });
  assert.deepEqual(r.body, { ok: true, posted: false, reason: 'The bot is missing a permission there. Use "Check Discord setup" to see which one.' });
  r = await api('/api/polls/current', { as: 'boss' });
  assert.equal(r.body.poll.resultsPosted, false);
  discord.failPosts = false;
  r = await api(`/api/polls/${id}/announce`, { as: 'boss', method: 'POST', body: {} });
  assert.equal(r.body.posted, 'results');
  assert.equal(discord.messages.length, 1);

  discord.failEvents = true;
  const start = new Date(Date.now() + 86400 * 1000).toISOString();
  r = await api(`/api/polls/${id}/schedule`, { as: 'boss', method: 'POST', body: { start } });
  assert.equal(r.status, 502);
  r = await api('/api/polls/current', { as: 'boss' });
  assert.equal(r.body.poll.status, 'closed');
  discord.failEvents = false;
  r = await api(`/api/polls/${id}/schedule`, { as: 'boss', method: 'POST', body: { start } });
  assert.equal(r.status, 200);
});

test('cancel, cross-site posts and missing setup', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  const id = r.body.id;
  r = await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] }, origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await api(`/api/polls/${id}/cancel`, { as: 'fan', method: 'POST', body: {} });
  assert.equal(r.status, 403);
  r = await api(`/api/polls/${id}/cancel`, { as: 'guard', method: 'POST', body: {} });
  assert.equal(r.status, 200);
  r = await api('/api/polls/current', { as: 'fan' });
  assert.equal(r.body.poll, null);
  r = await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  assert.equal(r.status, 404);

  delete env.DISCORD_BOT_TOKEN;
  r = await api('/api/polls/current');
  assert.equal(r.status, 503);
});

test('ballots are purged 90 days after their poll opened', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  await api(`/api/polls/${r.body.id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  assert.equal(await purgeOldBallots(env, Date.now() + 89 * 86400 * 1000), 0);
  assert.equal(await purgeOldBallots(env, Date.now() + 91 * 86400 * 1000), 1);
  assert.equal(await purgeOldBallots({}), 0);
});

test('cover art only from Steam image hosts', () => {
  assert.equal(safeArt('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/header.jpg?t=1'), 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/header.jpg?t=1');
  assert.equal(safeArt('https://cdn.akamai.steamstatic.com/steam/apps/1/header.jpg'), 'https://cdn.akamai.steamstatic.com/steam/apps/1/header.jpg');
  assert.equal(safeArt('http://cdn.akamai.steamstatic.com/x.jpg'), null);
  assert.equal(safeArt('https://steamstatic.com.evil.example/x.jpg'), null);
  assert.equal(safeArt('javascript:alert(1)'), null);
  const c = buildCatalog({ tracked: [{ appid: 1, name: 'A', tent: 'horror', image: 'https://evil.example/a.jpg' }, { appid: 2, name: 'B', tent: 'other', image: 'https://cdn.akamai.steamstatic.com/b.jpg' }], jackbox: { images: { 7: 'https://cdn.akamai.steamstatic.com/j.jpg' } } }, { packs: [{ appid: 7, short: 'Pack 7', games: [{ name: 'Q', min: 3, max: 8 }, { name: 'R', min: 3, max: 8 }] }] });
  assert.deepEqual(c.map((x) => x.image), [null, 'https://cdn.akamai.steamstatic.com/b.jpg', 'https://cdn.akamai.steamstatic.com/j.jpg', 'https://cdn.akamai.steamstatic.com/j.jpg']);
});

test('the wheel only spins horror, party and Jackbox games, never twice the same', () => {
  const cands = [
    { key: 'h1', tent: 'horror' }, { key: 'h2', tent: 'horror' }, { key: 'p1', tent: 'party' },
    { key: 's1', tent: 'other', group: 'Tracked games' }, { key: 'j1', tent: 'party', group: 'Jackbox' }, { key: 'j2', group: 'Jackbox' }
  ];
  assert.deepEqual(cands.filter(doomEligible).map((c) => c.key), ['h1', 'h2', 'p1', 'j1', 'j2']);
  for (let i = 0; i < 50; i++) {
    const picks = doomPicks(cands);
    assert.equal(picks.length, 4);
    assert.equal(new Set(picks).size, 4);
    assert.ok(!picks.includes('s1'));
  }
  assert.deepEqual(doomPicks([{ key: 'h', tent: 'horror' }, { key: 's', tent: 'other' }]), ['h']);
  assert.deepEqual(doomPicks([{ key: 's', tent: 'other' }]), []);
});

test('Wheel of Doom: saved and locked in one step, no take-backs', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850', 'steam-3527290', 'jb-1211630-quiplash-3', 'jb-1211630-champ-d-up', 'jb-3048060-trivia-murder-party-3'] } });
  const id = r.body.id;
  // A normal ballot first; the wheel may still replace it.
  await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  r = await api(`/api/polls/${id}/doom`, { as: 'stranger', method: 'POST', body: {} });
  assert.equal(r.status, 403);
  r = await api(`/api/polls/${id}/doom`, { as: 'fan', method: 'POST', body: {} });
  assert.equal(r.status, 200);
  assert.equal(r.body.locked, true);
  assert.equal(r.body.ranking.length, 4);
  assert.ok(!r.body.ranking.includes('steam-553850'), 'Helldivers 2 is a Sideshow game, not on the wheel');
  const picks = r.body.ranking;
  r = await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'locked');
  r = await api(`/api/polls/${id}/doom`, { as: 'fan', method: 'POST', body: {} });
  assert.equal(r.status, 409);
  r = await api('/api/polls/current', { as: 'fan' });
  assert.deepEqual(r.body.poll.myBallot, picks);
  assert.equal(r.body.poll.myBallotLocked, true);
  assert.equal(r.body.poll.candidates[0].tent, 'horror');
  // The locked ballot counts like any other.
  await api(`/api/polls/${id}/close`, { as: 'boss', method: 'POST', body: {} });
  r = await api('/api/polls/current', { as: 'fan' });
  assert.equal(r.body.poll.results.find((x) => x.key === picks[0]).points >= 4, true);
});

test('no wheel when the ballot has no horror, party or Jackbox games', async () => {
  feed.tracked.push({ appid: 365590, name: 'The Division', tent: 'other' });
  try {
    _clearCatalogCache();
    let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-553850', 'steam-365590'] } });
    r = await api(`/api/polls/${r.body.id}/doom`, { as: 'fan', method: 'POST', body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'no_doom');
  } finally {
    feed.tracked.pop();
  }
});

test('permission math follows Discord: roles, then @everyone, role and member overwrites', () => {
  const guildId = '1';
  const roles = [{ id: '1', permissions: String(PERMS.VIEW_CHANNEL | PERMS.SEND_MESSAGES) }, { id: '2', permissions: String(PERMS.EMBED_LINKS) }, { id: '9', permissions: String(PERMS.ADMINISTRATOR) }];
  const base = channelPermissions({ guildId, roles, memberRoles: ['2'], memberId: '5' });
  assert.equal(base, PERMS.VIEW_CHANNEL | PERMS.SEND_MESSAGES | PERMS.EMBED_LINKS);
  const denied = channelPermissions({ guildId, roles, memberRoles: ['2'], memberId: '5', overwrites: [{ id: '1', allow: '0', deny: String(PERMS.SEND_MESSAGES) }] });
  assert.equal(denied & PERMS.SEND_MESSAGES, 0n);
  const roleAllows = channelPermissions({ guildId, roles, memberRoles: ['2'], memberId: '5', overwrites: [{ id: '1', allow: '0', deny: String(PERMS.SEND_MESSAGES) }, { id: '2', allow: String(PERMS.SEND_MESSAGES), deny: '0' }] });
  assert.equal(roleAllows & PERMS.SEND_MESSAGES, PERMS.SEND_MESSAGES);
  const memberDenies = channelPermissions({ guildId, roles, memberRoles: ['2'], memberId: '5', overwrites: [{ id: '5', allow: '0', deny: String(PERMS.VIEW_CHANNEL) }] });
  assert.equal(memberDenies & PERMS.VIEW_CHANNEL, 0n);
  const admin = channelPermissions({ guildId, roles, memberRoles: ['9'], memberId: '5', overwrites: [{ id: '1', allow: '0', deny: String(PERMS.VIEW_CHANNEL) }] });
  assert.equal(admin & PERMS.VIEW_CHANNEL, PERMS.VIEW_CHANNEL);
});

test('a Stage channel gets a Stage event (entity_type 1)', async () => {
  discord.stageType = 13;
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  const id = r.body.id;
  await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  await api(`/api/polls/${id}/close`, { as: 'boss', method: 'POST', body: {} });
  r = await api(`/api/polls/${id}/schedule`, { as: 'boss', method: 'POST', body: { start: new Date(Date.now() + 86400 * 1000).toISOString() } });
  assert.equal(r.status, 200);
  assert.equal(discord.events[0].entity_type, 1);
});

test('failed event says why', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  const id = r.body.id;
  await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  await api(`/api/polls/${id}/close`, { as: 'boss', method: 'POST', body: {} });
  discord.failEvents = true;
  r = await api(`/api/polls/${id}/schedule`, { as: 'boss', method: 'POST', body: { start: new Date(Date.now() + 86400 * 1000).toISOString() } });
  assert.equal(r.status, 502);
  assert.match(r.body.message, /missing a permission/);
});

test('Check Discord setup lists what the bot can and cannot do', async () => {
  let r = await api('/api/polls/discord-check', { as: 'fan' });
  assert.equal(r.status, 403);
  r = await api('/api/polls/discord-check', { as: 'guard' });
  assert.equal(r.status, 200);
  assert.ok(r.body.checks.every((c) => c.ok), JSON.stringify(r.body.checks));
  // #general denies Embed Links to @everyone; the voice channel denies Connect.
  discord.overwrites[GENERAL] = [{ id: GUILD, allow: '0', deny: String(1n << 14n) }];
  discord.overwrites[STAGE] = [{ id: GUILD, allow: '0', deny: String(1n << 20n) }];
  r = await api('/api/polls/discord-check', { as: 'guard' });
  const bad = r.body.checks.filter((c) => !c.ok).map((c) => c.label);
  assert.deepEqual(bad, ['Bot can post embeds in #general', 'Bot can connect to The Main Stage']);
  assert.ok(r.body.checks.find((c) => !c.ok).fix.includes('Embed Links'));
  // A Stage channel also needs Stage moderator permissions.
  discord.overwrites[GENERAL] = [];
  discord.overwrites[STAGE] = [];
  discord.stageType = 13;
  r = await api('/api/polls/discord-check', { as: 'guard' });
  assert.deepEqual(r.body.checks.filter((c) => !c.ok).map((c) => c.label), ['Bot has Stage permissions in The Main Stage']);
});

test('members see who has voted and who spun the Wheel of Doom, never their picks', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850', 'steam-3527290', 'jb-1211630-quiplash-3'] } });
  const id = r.body.id;
  await api(`/api/polls/${id}/ballot`, { as: 'fan2', method: 'POST', body: { ranking: ['steam-553850'] } });
  await api(`/api/polls/${id}/doom`, { as: 'fan', method: 'POST', body: {} });
  await api(`/api/polls/${id}/ballot`, { as: 'fan2', method: 'POST', body: { ranking: ['steam-1966720'] } }); // changing a vote keeps your place
  r = await api('/api/polls/current', { as: 'guard' });
  assert.deepEqual(r.body.poll.voters, [{ name: 'fan2', doom: false }, { name: 'fan', doom: true }]);
  assert.ok(!JSON.stringify(r.body.poll.voters).includes('steam-'), 'no picks in the voter list');
  assert.equal(r.body.poll.results, null, 'standings still hidden while open');
  r = await api('/api/polls/current');
  assert.equal(r.body.poll.voters, undefined, 'signed-out visitors only see the count');
  assert.equal(r.body.poll.voteCount, 2);
  r = await api('/api/polls/current', { as: 'stranger' });
  assert.equal(r.body.poll.voters, undefined, 'non-members only see the count');
});

test('ballots saved before names were recorded get their names filled in', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  const id = r.body.id;
  await api(`/api/polls/${id}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-553850'] } });
  env.DB._raw.exec('UPDATE ballots SET voter_name = NULL');
  r = await api('/api/polls/current', { as: 'guard' });
  assert.deepEqual(r.body.poll.voters, [{ name: 'fan', doom: false }]);
  assert.equal(env.DB._raw.prepare('SELECT voter_name FROM ballots').get().voter_name, 'fan', 'saved for next time');
  assert.ok(!JSON.stringify(r.body.poll.voters).includes('300000000000000003'), 'no user IDs');
});

test('several polls run side by side, each with its own ballots, voters and outcome', async () => {
  let r = await api('/api/polls', { as: 'boss', method: 'POST', body: { title: 'Friday Fright', candidates: ['steam-1966720', 'steam-553850'] } });
  const fri = r.body.id;
  r = await api('/api/polls', { as: 'guard', method: 'POST', body: { title: 'Saturday Laughs', candidates: ['steam-3527290', 'jb-1211630-quiplash-3'] } });
  assert.equal(r.status, 201);
  const sat = r.body.id;
  await api(`/api/polls/${fri}/ballot`, { as: 'fan', method: 'POST', body: { ranking: ['steam-1966720'] } });
  await api(`/api/polls/${sat}/doom`, { as: 'fan', method: 'POST', body: {} });
  await api(`/api/polls/${sat}/ballot`, { as: 'fan2', method: 'POST', body: { ranking: ['steam-3527290'] } });
  r = await api(`/api/polls/${fri}/ballot`, { as: 'fan2', method: 'POST', body: { ranking: ['steam-3527290'] } });
  assert.equal(r.status, 400, "a game from another poll can't be voted here");
  r = await api('/api/polls/current', { as: 'fan' });
  assert.deepEqual(r.body.polls.map((p) => p.title), ['Friday Fright', 'Saturday Laughs']);
  const [f, s2] = r.body.polls;
  assert.deepEqual(f.myBallot, ['steam-1966720']);
  assert.equal(f.myBallotLocked, false);
  assert.equal(s2.myBallotLocked, true, 'the wheel locks only that poll');
  assert.equal(f.voteCount, 1);
  assert.equal(s2.voteCount, 2);
  assert.equal(r.body.poll.id, sat, 'older pages still get the newest poll');
  await api(`/api/polls/${fri}/close`, { as: 'boss', method: 'POST', body: {} });
  r = await api('/api/polls/current', { as: 'fan' });
  assert.deepEqual(r.body.polls.map((p) => [p.title, p.status]), [['Friday Fright', 'closed'], ['Saturday Laughs', 'open']]);
  assert.ok(r.body.polls[0].results && !r.body.polls[1].results);
});

test('there is a cap on how many polls can run at once', async () => {
  for (let i = 0; i < 8; i++) {
    const r = await api('/api/polls', { as: 'boss', method: 'POST', body: { title: `Night ${i}`, candidates: ['steam-1966720', 'steam-553850'] } });
    assert.equal(r.status, 201);
  }
  const r = await api('/api/polls', { as: 'boss', method: 'POST', body: { candidates: ['steam-1966720', 'steam-553850'] } });
  assert.equal(r.status, 409);
});
