import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../index.js';
import { seal, SESSION_COOKIE } from '../auth.js';
import { _clearMemberCache } from '../polls.js';
import { ticketStore } from '../ticket-db.js';
import { GAMES, SWEEP_BONUS, clock, economy, rollTier, cleanChoice, visualParamsFor, midwayStore, purgeOldPlays } from '../midway.js';
import { COMMANDS } from '../interactions.js';
import { ALL_GAME_IDS, getWeeklyLineup, easternMidnightIso } from '../../site/midway/rotation.js';
import { fakeD1 } from './helpers/d1.mjs';

const ORIGIN = 'https://belpire.com';
const GUILD = '100000000000000001';
const U = { fan: '300000000000000003', fan2: '300000000000000004', stranger: '300000000000000099' };
const NAMES = { [U.fan]: 'Fan One', [U.fan2]: 'Fan Two' };
const realFetch = globalThis.fetch;
const real = { now: clock.now, rand: clock.rand };
let env;

beforeEach(() => {
  _clearMemberCache();
  globalThis.fetch = async (url) => {
    const m = new URL(url).pathname.replace('/api/v10', '').match(/^\/guilds\/\d+\/members\/(\d+)$/);
    if (m) return NAMES[m[1]] ? Response.json({ nick: NAMES[m[1]], roles: [], user: { id: m[1], username: 'u' } }) : Response.json({ code: 10007 }, { status: 404 });
    throw new Error('unexpected ' + url);
  };
  env = { SESSION_SECRET: 'x'.repeat(48), DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: GUILD, MAIN_STAGE_CHANNEL_ID: '100000000000000002', GENERAL_CHANNEL_ID: '100000000000000003', POLL_MANAGER_ROLE_IDS: '200000000000000001', DB: fakeD1() };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  clock.now = real.now;
  clock.rand = real.rand;
});

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
const play = (id, as, choice) => call(`/api/midway/play/${id}`, { as, method: 'POST', body: choice === undefined ? {} : { choice } });

// A Tuesday afternoon (Eastern) when `id` is open (or, with open = false, shut).
function weekFor(id, open = true) {
  for (let w = 0; w < 8; w++) {
    const at = Date.parse('2026-11-24T19:00:00Z') + w * 7 * 86400000;
    if (getWeeklyLineup(new Date(at)).activeGames.includes(id) === open) {
      clock.now = () => at;
      return at;
    }
  }
  throw new Error(`no week for ${id}`);
}
// Dice that always land on the top tier (the last weight band).
const loaded = (n) => n - 1;
// Dice that always land on the bottom tier.
const cold = () => 0;

// ------------------------------------------------------------------ rotation

test('the rotation flips at Monday midnight Eastern, not before', () => {
  const sun = getWeeklyLineup(new Date('2026-11-23T04:59:00Z')); // Sunday 11:59 pm Eastern
  const mon = getWeeklyLineup(new Date('2026-11-23T05:00:00Z')); // Monday 12:00 am Eastern
  assert.equal(sun.easternKey, '2026-11-22');
  assert.equal(mon.easternKey, '2026-11-23');
  assert.equal(mon.weekNumber, sun.weekNumber + 1);
  assert.equal(sun.nextRotationDateKey, '2026-11-23');
  assert.equal(mon.nextRotationDateKey, '2026-11-30');
  assert.deepEqual(getWeeklyLineup(new Date('2026-11-17T15:00:00Z')).activeGames, getWeeklyLineup(new Date('2026-11-22T15:00:00Z')).activeGames, 'Tuesday and Sunday share a week');
  // daylight saving: the summer flip is at 04:00 UTC
  const jul = getWeeklyLineup(new Date('2026-07-06T04:00:00Z'));
  assert.equal(jul.easternKey, '2026-07-06');
  assert.equal(jul.weekNumber, getWeeklyLineup(new Date('2026-07-06T03:59:00Z')).weekNumber + 1);
});

test('every booth opens exactly once per 5-week cycle, in a 4-5-5-5-6 split', () => {
  for (let cycle = 0; cycle < 4; cycle++) {
    const first = getWeeklyLineup(new Date('2026-11-24T19:00:00Z'));
    const base = Date.parse('2026-11-24T19:00:00Z') + (cycle * 5 - first.weekInCycle) * 7 * 86400000;
    const seen = [];
    const sizes = [];
    for (let w = 0; w < 5; w++) {
      const l = getWeeklyLineup(new Date(base + w * 7 * 86400000));
      assert.equal(l.weekInCycle, w);
      seen.push(...l.activeGames);
      sizes.push(l.activeGames.length);
      assert.equal(l.activeGames.length + l.closedGames.length, 25);
    }
    assert.deepEqual([...seen].sort(), [...ALL_GAME_IDS].sort(), `cycle ${cycle}`);
    assert.deepEqual([...sizes].sort(), [4, 5, 5, 5, 6]);
  }
});

test('the rotation is the same on every run (no randomness)', () => {
  const a = getWeeklyLineup(new Date('2027-03-03T12:00:00Z'));
  const b = getWeeklyLineup(new Date('2027-03-03T12:00:00Z'));
  assert.deepEqual(a, b);
});

test('easternMidnightIso works on both sides of daylight saving', () => {
  assert.equal(easternMidnightIso('2026-11-23'), '2026-11-23T05:00:00.000Z');
  assert.equal(easternMidnightIso('2026-07-06'), '2026-07-06T04:00:00.000Z');
});

// ------------------------------------------------------------------ economy

// The spec's Master Economy & Odds Matrix: plays, average per day, most per day.
const MATRIX = {
  'find-the-pea': [5, 20, 60], 'ring-toss': [5, 25, 250], 'high-striker': [3, 20.25, 120], 'shooting-gallery': [5, 22, 200],
  'milk-bottle-knockdown': [4, 21.6, 200], 'balloon-darts': [5, 22.5, 200], 'skee-ball': [5, 24, 100], 'dunk-tank': [3, 20.4, 200],
  'water-gun-race': [3, 21, 48], 'goldfish-bowl-toss': [5, 22, 200], 'rigged-hoop': [4, 22, 200], 'knife-thrower': [3, 20.7, 200],
  'whac-a-mole': [3, 21.6, 72], 'claw-machine': [3, 20.4, 200], 'buzz-wire': [4, 22.2, 80], 'frog-bog': [5, 24, 125],
  'rope-ladder-climb': [2, 20.8, 200], plinko: [4, 21.6, 200], 'big-six': [1, 20, 200], 'duck-pond': [4, 22, 100],
  'derby-race': [3, 21, 84], 'coin-pusher': [5, 23, 175], 'guess-the-jar': [1, 20, 200], 'test-your-grip': [2, 20.8, 200],
  'hall-of-mirrors': [3, 21, 84]
};

test('all 25 booths match the economy matrix (plays, average a day, most a day)', () => {
  assert.deepEqual(Object.keys(GAMES).sort(), [...ALL_GAME_IDS].sort());
  for (const id of ALL_GAME_IDS) {
    const g = GAMES[id];
    const e = economy(id);
    assert.equal(g.plays, MATRIX[id][0], id);
    assert.equal(e.avgPerDay, MATRIX[id][1], id);
    assert.equal(e.maxPerDay, MATRIX[id][2], id);
    for (const tiers of g.rows ? Object.values(g.rows) : [g.tiers]) {
      const total = tiers.reduce((s, t) => s + t[2], 0);
      assert.ok(total === 1000 || (id === 'find-the-pea' && total === 3), `${id} weights add up`);
    }
    assert.ok(g.closed && g.blurb, `${id} has its copy`);
  }
  assert.equal(ALL_GAME_IDS.filter((id) => economy(id).maxPerDay === 200).length, 13, '13 booths top out at 200');
  assert.deepEqual(ALL_GAME_IDS.filter((id) => GAMES[id].sweep).sort(), ['claw-machine', 'dunk-tank', 'knife-thrower']);
});

test('rolls follow the weights', () => {
  const tiers = GAMES['coin-pusher'].tiers;
  assert.equal(rollTier(tiers, () => 0)[0], 'no-drop');
  assert.equal(rollTier(tiers, () => 499)[0], 'no-drop');
  assert.equal(rollTier(tiers, () => 500)[0], 'trickle');
  assert.equal(rollTier(tiers, () => 969)[0], 'cascade');
  assert.equal(rollTier(tiers, () => 970)[0], 'avalanche');
  assert.equal(rollTier(tiers, loaded)[0], 'avalanche');
  // and with the real crypto dice, over many rolls
  const count = (id, key, n = 20000) => {
    let hits = 0;
    for (let i = 0; i < n; i++) if (rollTier(GAMES[id].tiers)[0] === key) hits++;
    return hits / n;
  };
  assert.ok(Math.abs(count('find-the-pea', 'found') - 1 / 3) < 0.02);
  assert.ok(Math.abs(count('high-striker', 'bell') - 0.05) < 0.01);
  assert.ok(Math.abs(count('derby-race', 'win') - 0.25) < 0.015);
});

test('picks are checked per booth', () => {
  assert.throws(() => cleanChoice('find-the-pea', null), /Pick a shell first/);
  assert.throws(() => cleanChoice('find-the-pea', '4'), /Pick a shell: 1, 2, 3/);
  assert.equal(cleanChoice('ring-toss', ' Back '), 'back');
  assert.throws(() => cleanChoice('ring-toss', '__proto__'));
  assert.equal(cleanChoice('plinko', null), null, 'optional pick');
  assert.equal(cleanChoice('guess-the-jar', '250'), '250');
  assert.throws(() => cleanChoice('guess-the-jar', '99'), /100 to 500/);
  assert.throws(() => cleanChoice('guess-the-jar', '250.5'));
  assert.equal(cleanChoice('big-six', 'whatever'), null, 'booths without a pick ignore one');
});

test('the stage is always told a result that matches the roll', () => {
  for (let i = 0; i < 300; i++) {
    for (const tier of GAMES['guess-the-jar'].tiers) {
      const guess = 100 + (i % 401);
      const v = visualParamsFor('guess-the-jar', tier, String(guess));
      const off = Math.abs(v.actual - guess);
      const ok = { exact: off === 0, 'within-5': off >= 1 && off <= 5, 'within-20': off >= 6 && off <= 20, off: off >= 21 }[tier[0]];
      assert.ok(ok && v.actual >= 50 && v.actual <= 650, `${tier[0]} ${guess} → ${v.actual}`);
    }
    const [loss, win] = GAMES['derby-race'].tiers;
    assert.equal(visualParamsFor('derby-race', win, '3').winner, 3);
    const lost = visualParamsFor('derby-race', loss, '3');
    assert.notEqual(lost.winner, 3);
    assert.deepEqual([...lost.order].sort(), [1, 2, 3, 4]);
    assert.equal(lost.order[0], lost.winner);
    assert.notEqual(visualParamsFor('hall-of-mirrors', GAMES['hall-of-mirrors'].tiers[0], '2').exit, 2);
    const miss = visualParamsFor('find-the-pea', GAMES['find-the-pea'].tiers[0], '2');
    assert.ok(miss.pea !== 1 && miss.pea >= 0 && miss.pea <= 2);
    const h = visualParamsFor('high-striker', GAMES['high-striker'].tiers[2], null).height;
    assert.ok(h >= 7 && h <= 9);
  }
});

// ------------------------------------------------------------------ API

test('state: the week\'s lineup, today\'s plays and the next reset, members only', async () => {
  assert.equal((await call('/api/midway/state')).status, 401);
  assert.equal((await call('/api/midway/state', { as: 'stranger' })).status, 403);
  const at = weekFor('big-six');
  const s = (await call('/api/midway/state', { as: 'fan' })).body;
  const lineup = getWeeklyLineup(new Date(at));
  assert.equal(s.easternDate, lineup.easternKey);
  assert.equal(s.nextResetIso, easternMidnightIso(new Date(Date.parse(`${lineup.easternKey}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)));
  assert.deepEqual(s.rotation.activeGames, lineup.activeGames);
  assert.equal(s.games.length, 25);
  const six = s.games.find((g) => g.id === 'big-six');
  assert.deepEqual([six.isOpen, six.playsUsed, six.playsMax, six.avgPerDay, six.maxPerDay], [true, 0, 1, 20, 200]);
  assert.equal(s.games.filter((g) => g.isOpen).length, lineup.activeGames.length);
  assert.ok(s.games.every((g) => g.closedCopy && Array.isArray(g.odds) !== Boolean(g.id === 'ring-toss')));
});

test('a play: rolled on the server, recorded, paid into the one bank; plays run out', async () => {
  weekFor('skee-ball');
  let total = 0;
  for (let i = 1; i <= 5; i++) {
    const r = await play('skee-ball', 'fan');
    assert.equal(r.status, 200);
    assert.equal(r.body.playIndex, i);
    assert.equal(r.body.playsMax, 5);
    assert.ok([2, 4, 8, 20].includes(r.body.totalPayout), 'Skee-Ball always pays something');
    assert.ok([10, 30, 50, 100].includes(r.body.visualParams.points));
    assert.equal(typeof r.body.visualParams.seed, 'number');
    total += r.body.totalPayout;
    assert.equal(r.body.newBalance, total);
  }
  const out = await play('skee-ball', 'fan');
  assert.equal(out.status, 429);
  assert.match(out.body.message, /all 5 plays of Skee-Ball/);
  assert.equal((await ticketStore(env.DB).wallet(U.fan)).balance, total);
  const rows = await midwayStore(env.DB).today(U.fan, getWeeklyLineup(new Date(clock.now())).easternKey);
  assert.equal(rows.length, 5);
  assert.equal((await call('/api/midway/state', { as: 'fan' })).body.games.find((g) => g.id === 'skee-ball').playsUsed, 5);
  assert.equal((await call('/api/midway/state', { as: 'fan2' })).body.games.find((g) => g.id === 'skee-ball').playsUsed, 0, 'each member counts their own');
});

test('closed booths, unknown booths, missing picks and cross-site posts are refused', async () => {
  weekFor('dunk-tank', false);
  const shut = await play('dunk-tank', 'fan');
  assert.equal(shut.status, 403);
  assert.equal(shut.body.error, 'closed');
  assert.match(shut.body.message, /Tank's being drained/);
  assert.equal((await play('carousel', 'fan')).status, 404);
  assert.equal((await play('__proto__', 'fan')).status, 404);
  weekFor('derby-race');
  assert.equal((await play('derby-race', 'fan')).status, 400, 'pick a horse first');
  assert.equal((await play('derby-race', 'fan', '5')).status, 400);
  assert.equal((await ticketStore(env.DB).wallet(U.fan))?.balance ?? 0, 0, 'nothing paid for a refused play');
  const t = Math.floor(Date.now() / 1000);
  const cookie = `${SESSION_COOKIE}=${await seal({ uid: U.fan, name: 'fan', iat: t, exp: t + 3600 }, env.SESSION_SECRET, 'session')}`;
  const res = await worker.fetch(new Request(`${ORIGIN}/api/midway/play/derby-race`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"choice":"1"}' }), env, {});
  assert.equal(res.status, 403);
});

test('sweep bonus: three top-tier plays in a day on Dunk Tank adds 50', async () => {
  weekFor('dunk-tank');
  clock.rand = loaded;
  const r1 = await play('dunk-tank', 'fan');
  const r2 = await play('dunk-tank', 'fan');
  const r3 = await play('dunk-tank', 'fan');
  assert.deepEqual([r1.body.outcomeTier, r2.body.outcomeTier, r3.body.outcomeTier], ['dunk', 'dunk', 'dunk']);
  assert.deepEqual([r1.body.sweepBonus, r2.body.sweepBonus, r3.body.sweepBonus], [0, 0, SWEEP_BONUS]);
  assert.equal(r3.body.totalPayout, 100);
  assert.equal(r3.body.newBalance, 200, 'the day\'s ceiling');

  // one miss in the run means no sweep
  clock.rand = cold;
  await play('dunk-tank', 'fan2');
  clock.rand = loaded;
  await play('dunk-tank', 'fan2');
  const last = await play('dunk-tank', 'fan2');
  assert.equal(last.body.sweepBonus, 0);
});

test('a booth that pays nothing still uses a play and leaves a row, never a negative', async () => {
  weekFor('goldfish-bowl-toss');
  clock.rand = cold;
  const r = await play('goldfish-bowl-toss', 'fan');
  assert.equal(r.body.totalPayout, 0);
  assert.equal(r.body.playsLeft, 4);
  assert.equal(r.body.newBalance, 0);
});

test('plays made under the old Ticket Booth names still count today', async () => {
  const at = weekFor('find-the-pea');
  const day = getWeeklyLineup(new Date(at)).easternKey;
  const bank = ticketStore(env.DB);
  for (let i = 1; i <= 4; i++) await bank.change(U.fan, 'Fan One', 0, 'game', { ref: `shell:${U.fan}:${day}:${i}` });
  const r = await play('find-the-pea', 'fan', '1');
  assert.equal(r.body.playIndex, 5);
  assert.equal(r.body.playsLeft, 0);
  assert.equal((await play('find-the-pea', 'fan', '1')).status, 429);
});

test('play rows are cleared after 30 days', async () => {
  const at = weekFor('skee-ball');
  await play('skee-ball', 'fan');
  const day = getWeeklyLineup(new Date(at)).easternKey;
  await purgeOldPlays(env, at + 29 * 86400000);
  assert.equal((await midwayStore(env.DB).today(U.fan, day)).length, 1);
  await purgeOldPlays(env, at + 31 * 86400000);
  assert.equal((await midwayStore(env.DB).today(U.fan, day)).length, 0);
});

test('Discord: /play offers all 25 booths and /midway lists the week', () => {
  const p = COMMANDS.find((c) => c.name === 'play');
  assert.equal(p.options[0].choices.length, 25);
  assert.ok(p.options[1].description.length <= 100);
  assert.ok(COMMANDS.find((c) => c.name === 'midway'));
});
