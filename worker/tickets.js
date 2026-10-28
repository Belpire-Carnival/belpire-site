// Tickets: Belpire's carnival currency. One bank (D1, see ticket-db.js) that both the website and the
// Belpire Usher's slash commands read and write, so Discord and belpire.com always show the same balance.
//
// Earning                                     Spending
//   daily punch card (streak bonus)             the Prize Booth (worker/prizes.js); orders wait Backstage
//   Find the Pea, Ring Toss and the High        and a Ringleader marks them done or refunds them
//     Striker, all decided here
//   game-night attendance (check in, then paid
//     every 10 minutes while in The Main Stage)
//   Ringleaders handing tickets out
//
//   GET  /api/tickets                       members: wallet, history, games, show, prizes, orders, high scores
//   POST /api/tickets/punch                 members
//   POST /api/tickets/games/shell           members  { pick: 0|1|2 }
//   POST /api/tickets/games/rings           members  { row: 'front'|'middle'|'back' }
//   POST /api/tickets/games/striker         members
//   POST /api/tickets/checkin               members, while a show is on
//   POST /api/tickets/redeem                members  { prize, detail?, game? }
//   POST /api/tickets/privacy               members  { hidden }
//   GET  /api/tickets/staff                 Ringleaders: open prize orders
//   GET  /api/tickets/members?q=            Ringleaders: find someone to hand tickets to
//   POST /api/tickets/award                 Ringleaders  { userId, amount, note }
//   POST /api/tickets/post-scores           Ringleaders: post the High Scores to the announcements channel now
//   POST /api/tickets/orders/:id/done       Ringleaders
//   POST /api/tickets/orders/:id/refund     Ringleaders  { reason? }

import { readSession } from './auth.js';
import { memberInfo, pollConfig, loadCatalog } from './polls.js';
import { pollStore } from './poll-db.js';
import { liveStatus } from './live.js';
import { getVoiceState, getMember, searchMembers, postMessage, sendDm, explain } from './discord-bot.js';
import { ticketStore, newId } from './ticket-db.js';
import { PRIZES, prizeById } from './prizes.js';

export const RULES = {
  punchBase: 10,
  punchStreakStep: 2,
  punchStreakMax: 5, // bonus days counted, so a 6-day streak and beyond earns 10 + 2×5 = 20
  shellPlays: 5,
  shellWin: 12,
  ringPlays: 5,
  // chance in 1000 and prize for each row: nearer bottles are easier, farther ones pay more
  ringRows: { front: { odds: 600, prize: 6 }, middle: { odds: 300, prize: 15 }, back: { odds: 100, prize: 50 } },
  strikerPlays: 3,
  // where the puck can land (1–10) with its chance in 1000 and prize; 10 rings the bell
  strikerTiers: [
    { upTo: 350, heights: [1, 2, 3], prize: 0, label: 'Wimp' },
    { upTo: 700, heights: [4, 5, 6], prize: 5, label: 'Not bad' },
    { upTo: 950, heights: [7, 8, 9], prize: 12, label: 'Strongman' },
    { upTo: 1000, heights: [10], prize: 40, label: 'DING!' }
  ],
  attendPerCheck: 3,
  attendCap: 60,
  awardMax: 500
};
const SNOWFLAKE = /^\d{17,20}$/;
const ID = /^[a-f0-9]{24}$/;
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status, error, message) => json({ error, message }, status);

export class TicketError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Days roll over at midnight Eastern, when game nights end.
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDay = (ms = Date.now()) => dayFmt.format(new Date(ms));
const prevDay = (day) => etDay(Date.parse(`${day}T12:00:00Z`) - 86400000);

export const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
export const ticketsText = (n) => plural(n, 'ticket');

function randomInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

export function punchAmount(streak) {
  return RULES.punchBase + RULES.punchStreakStep * Math.min(Math.max(streak - 1, 0), RULES.punchStreakMax);
}

// ---------------------------------------------------------------- the show (game night) right now

// A show is on while a booked game night is under way (from 15 minutes before, for 6 hours) or a Ringleader
// is live in The Main Stage. Check-ins and attendance pay are keyed to the show.
export async function currentShow(env, now = Date.now()) {
  const night = env.DB ? await pollStore(env.DB).tonight(now).catch(() => null) : null;
  if (night) return { key: `night:${night.id}`, title: night.title };
  const live = await liveStatus(env, now).catch(() => ({ live: false }));
  if (live.live) return { key: `live:${etDay(now - 6 * 3600e3)}`, title: 'Live on The Main Stage' };
  return null;
}

const onStage = (vs, env) => Boolean(vs && vs.channel_id === env.MAIN_STAGE_CHANNEL_ID && !vs.self_deaf && !vs.deaf);
const slot = (now) => Math.floor(now / 600000);

// ---------------------------------------------------------------- actions (website and slash commands)

export async function punch(env, uid, name, now = Date.now()) {
  const store = ticketStore(env.DB);
  const day = etDay(now);
  const w = await store.wallet(uid);
  if (w?.punch_day === day) throw new TicketError(409, 'punched', 'Your card is already punched today. Come back after midnight Eastern.');
  const streak = w?.punch_day === prevDay(day) ? Number(w.streak || 0) + 1 : 1;
  const amount = punchAmount(streak);
  const balance = await store.change(uid, name, amount, 'punch', { note: streak > 1 ? `Punch card, ${streak}-day streak` : 'Punch card', ref: `punch:${uid}:${day}` });
  if (balance === null) throw new TicketError(409, 'punched', 'Your card is already punched today.');
  await store.setPunch(uid, day, streak);
  return { amount, streak, balance };
}

export async function playShell(env, uid, name, pick, now = Date.now()) {
  if (![0, 1, 2].includes(pick)) throw new TicketError(400, 'pick', 'Pick shell 1, 2 or 3.');
  const store = ticketStore(env.DB);
  const day = etDay(now);
  const prefix = `shell:${uid}:${day}:`;
  const played = await store.countRefs(prefix);
  if (played >= RULES.shellPlays) throw new TicketError(429, 'no_plays', `That's all ${RULES.shellPlays} games of Find the Pea for today. The barker reopens at midnight Eastern.`);
  const pea = randomInt(3);
  const win = pea === pick;
  const amount = win ? RULES.shellWin : 0;
  const balance = await store.change(uid, name, amount, 'game', { note: win ? 'Find the Pea: found it' : 'Find the Pea', ref: `${prefix}${played + 1}` });
  if (balance === null) throw new TicketError(409, 'busy', 'One game at a time. Try again.');
  return { pea, win, amount, balance, playsLeft: RULES.shellPlays - played - 1 };
}

// Shared bookkeeping for a daily-limited game: counts today's plays, records the result (0 for a loss).
async function playDaily(env, uid, name, game, limit, outOf, decide, now) {
  const store = ticketStore(env.DB);
  const prefix = `${game}:${uid}:${etDay(now)}:`;
  const played = await store.countRefs(prefix);
  if (played >= limit) throw new TicketError(429, 'no_plays', outOf);
  const r = decide();
  const balance = await store.change(uid, name, r.amount, 'game', { note: r.note, ref: `${prefix}${played + 1}` });
  if (balance === null) throw new TicketError(409, 'busy', 'One game at a time. Try again.');
  return { ...r, balance, playsLeft: limit - played - 1 };
}

export function playRings(env, uid, name, row, now = Date.now()) {
  const rule = RULES.ringRows[row];
  if (!rule || !Object.hasOwn(RULES.ringRows, row)) throw new TicketError(400, 'row', 'Pick the front, middle or back row.');
  return playDaily(env, uid, name, 'rings', RULES.ringPlays, `That's all ${RULES.ringPlays} rings for today. The booth reopens at midnight Eastern.`, () => {
    const win = randomInt(1000) < rule.odds;
    // which bottle in the row (0–3), for the animation
    return { row, win, bottle: randomInt(4), amount: win ? rule.prize : 0, note: win ? `Ring Toss: ringer on the ${row} row` : 'Ring Toss' };
  }, now);
}

export function swingStriker(env, uid, name, now = Date.now()) {
  return playDaily(env, uid, name, 'striker', RULES.strikerPlays, `Your arms need a rest: that's all ${RULES.strikerPlays} swings for today. Back at midnight Eastern.`, () => {
    const roll = randomInt(1000);
    const tier = RULES.strikerTiers.find((t) => roll < t.upTo);
    const height = tier.heights[randomInt(tier.heights.length)];
    return { height, bell: height === 10, label: tier.label, amount: tier.prize, note: tier.prize ? `High Striker: ${tier.label}` : 'High Striker' };
  }, now);
}

export async function checkIn(env, uid, name, now = Date.now()) {
  const show = await currentShow(env, now);
  if (!show) throw new TicketError(409, 'no_show', 'No show right now. Check in when a game night is on or a Ringleader is live in The Main Stage.');
  const vs = await getVoiceState(env, uid).catch(() => null);
  if (!onStage(vs, env)) throw new TicketError(409, 'not_on_stage', 'Hop into The Main Stage first (and undeafen), then check in.');
  const store = ticketStore(env.DB);
  const row = await store.checkin(uid, name, show.key);
  let paid = Number(row.paid || 0);
  let earned = 0;
  if (paid < RULES.attendCap) {
    const b = await store.change(uid, name, RULES.attendPerCheck, 'attend', { note: `At the show: ${show.title}`, ref: `attend:${uid}:${show.key}:${slot(now)}` });
    if (b !== null) {
      earned = RULES.attendPerCheck;
      paid += earned;
      await store.addPaid(uid, show.key, earned);
    }
  }
  return { show: show.title, earned, paid, cap: RULES.attendCap };
}

// Cron, every 10 minutes: pays everyone checked in to the current show who is still in The Main Stage.
export async function payAttendance(env, now = Date.now()) {
  if (!env.DB || !env.DISCORD_BOT_TOKEN || !SNOWFLAKE.test(String(env.MAIN_STAGE_CHANNEL_ID || ''))) return 0;
  const store = ticketStore(env.DB);
  await store.purgeCheckinsBefore(new Date(now - 3 * 86400000).toISOString());
  const show = await currentShow(env, now);
  if (!show) return 0;
  let paidOut = 0;
  for (const c of await store.checkins(show.key, 40)) {
    if (c.paid >= RULES.attendCap) continue;
    const vs = await getVoiceState(env, c.user_id).catch(() => null);
    if (!onStage(vs, env)) continue;
    const b = await store.change(c.user_id, c.name, RULES.attendPerCheck, 'attend', { note: `At the show: ${show.title}`, ref: `attend:${c.user_id}:${show.key}:${slot(now)}` });
    if (b !== null) {
      await store.addPaid(c.user_id, show.key, RULES.attendPerCheck);
      paidOut += RULES.attendPerCheck;
    }
  }
  return paidOut;
}

// ---------------------------------------------------------------- weekly High Scores post

// Sundays at noon Eastern, to ANNOUNCEMENTS_CHANNEL_ID. Change POST_HOUR_ET to move it.
export const POST_HOUR_ET = 12;
const etParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
const MEDALS = ['🥇', '🥈', '🥉'];
const clean = (s) => String(s).replace(/[*_`~|>\\#@:<]/g, '').trim() || 'A member';

export function highScoresMessage(weekly, allTime, now = Date.now()) {
  const from = shortDate.format(new Date(now - 7 * 86400000));
  const to = shortDate.format(new Date(now - 86400000));
  const line = (r, i, n) => `${MEDALS[i] || `**${i + 1}.**`} ${clean(r.name)}${r.badge ? ' ✦' : ''} · ${Number(n).toLocaleString('en-US')} tickets`;
  const parts = [`## 🏆 Midway High Scores · ${from} – ${to}`];
  parts.push('**This week\'s top earners**');
  parts.push(weekly.length ? weekly.map((r, i) => line(r, i, r.won)).join('\n') : '*A quiet week on the Midway. The booth is still open.*');
  if (allTime.length) parts.push('', '**All-time leaders**', allTime.slice(0, 5).map((r, i) => line(r, i, r.lifetime)).join('\n'));
  parts.push('', 'Get on the board: `/punch-card` every day, `/find-the-pea`, and `/checkin` at game night. 👉 https://belpire.com/me/');
  parts.push('-# 🦇 Want off the board? Tick "Keep me off the High Scores" on Your Ticket Booth page.');
  return parts.join('\n').slice(0, 2000);
}

const announceChannel = (env) => (SNOWFLAKE.test(String(env.ANNOUNCEMENTS_CHANNEL_ID || '')) ? env.ANNOUNCEMENTS_CHANNEL_ID : null);

export async function postHighScores(env, now = Date.now()) {
  const channel = announceChannel(env);
  if (!channel) throw new TicketError(503, 'no_channel', 'No announcements channel is set up yet.');
  const store = ticketStore(env.DB);
  const weekly = await store.weekly(new Date(now - 7 * 86400000).toISOString(), 10);
  const allTime = await highScores(env, null, 5);
  await postMessage(env, channel, { content: highScoresMessage(weekly, allTime, now) });
  return { weekly: weekly.length, allTime: allTime.length };
}

// Cron (every 10 minutes): posts once, on the first run after noon Eastern each Sunday.
export async function weeklyHighScores(env, now = Date.now()) {
  if (!env.DB || !env.DISCORD_BOT_TOKEN || !announceChannel(env)) return false;
  const p = Object.fromEntries(etParts.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  if (p.weekday !== 'Sun' || Number(p.hour) < POST_HOUR_ET) return false;
  const store = ticketStore(env.DB);
  const week = etDay(now);
  if (!(await store.claimPost(week))) return false;
  if (!(await store.leaderboard(1)).length) return false; // nobody has tickets yet: skip quietly
  try {
    await postHighScores(env, now);
    return true;
  } catch (err) {
    await store.releasePost(week);
    console.warn(`Weekly High Scores post failed: ${err.message}`);
    return false;
  }
}

const modChannel = (env) => (SNOWFLAKE.test(String(env.MOD_CHANNEL_ID || '')) ? env.MOD_CHANNEL_ID : null);
const safeName = (s) => String(s).replace(/[*_`~|>\\]/g, '');

export async function redeem(env, uid, name, { prize: prizeId, detail, game } = {}, catalog = null) {
  const prize = prizeById(prizeId);
  if (!prize) throw new TicketError(400, 'prize', 'That prize isn\'t in the booth.');
  const store = ticketStore(env.DB);
  if ((await store.waiting(uid, prize.id)) >= prize.limit) throw new TicketError(409, 'waiting', `You already have ${prize.name} waiting for a Ringleader.`);
  const o = { id: newId(), user_id: uid, name, prize: prize.id, cost: prize.cost, detail: null, game_key: null, game_name: null };
  if (prize.needs === 'note') {
    o.detail = cleanText(detail, 200);
    if (!o.detail) throw new TicketError(400, 'detail', 'Add a short note so the Ringleaders know what you want.');
  }
  if (prize.needs === 'game') {
    const g = (catalog || []).find((c) => c.key === game);
    if (!g) throw new TicketError(400, 'game', 'Pick a game from the list.');
    o.game_key = g.key;
    o.game_name = g.name;
  }
  const balance = await store.spend(uid, prize.cost, 'redeem', `Prize Booth: ${prize.name}`);
  if (balance === null) throw new TicketError(402, 'short', `${prize.name} costs ${ticketsText(prize.cost)}. Keep playing!`);
  await store.order(o);
  const channel = modChannel(env);
  if (channel) {
    const what = o.game_name ? ` (${o.game_name})` : o.detail ? `: “${o.detail}”` : '';
    await postMessage(env, channel, { content: `🎟️ **${safeName(name)}** redeemed **${prize.name}**${what} for ${ticketsText(prize.cost)}.\nSort it out Backstage: https://belpire.com/backstage/#bs-prizes` })
      .catch((err) => console.warn(`Prize note failed: ${explain(err)}`));
  }
  return { order: publicOrder(o), balance };
}

export async function award(env, by, userId, amount, note) {
  if (!SNOWFLAKE.test(String(userId || ''))) throw new TicketError(400, 'user', 'Pick someone from the list.');
  amount = Math.trunc(Number(amount));
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > RULES.awardMax) throw new TicketError(400, 'amount', `Hand out between 1 and ${RULES.awardMax} tickets (or take some back with a minus).`);
  const m = await getMember(env, userId);
  if (!m) throw new TicketError(404, 'not_member', 'That person isn\'t in the server.');
  const name = String(m.nick || m.user?.global_name || m.user?.username || 'A member').slice(0, 64);
  const why = cleanText(note, 120) || (amount > 0 ? 'A gift from the Ringleaders' : 'Adjusted by the Ringleaders');
  const balance = await ticketStore(env.DB).change(userId, name, amount, amount > 0 ? 'award' : 'adjust', { note: why, by });
  return { name, amount, balance };
}

export async function summary(env, uid) {
  const store = ticketStore(env.DB);
  const w = await store.wallet(uid);
  const today = etDay();
  return {
    balance: Number(w?.balance || 0),
    lifetime: Number(w?.lifetime || 0),
    streak: w?.punch_day === today || w?.punch_day === prevDay(today) ? Number(w?.streak || 0) : 0,
    punchedToday: w?.punch_day === today,
    nextPunch: punchAmount(w?.punch_day === prevDay(today) ? Number(w.streak || 0) + 1 : 1),
    hidden: Boolean(w?.hidden),
    rank: await store.rank(uid)
  };
}

export async function highScores(env, uid = null, limit = 10) {
  const now = new Date().toISOString();
  return (await ticketStore(env.DB).leaderboard(limit)).map((r, i) => ({ rank: i + 1, name: r.name, lifetime: Number(r.lifetime), badge: Boolean(r.badge_until && r.badge_until > now), me: r.user_id === uid }));
}

const publicOrder = (o) => ({ id: o.id, prize: o.prize, name: prizeById(o.prize)?.name || o.prize, cost: o.cost, detail: o.detail, game: o.game_name, status: o.status || 'pending', at: o.created_at || new Date().toISOString(), reason: o.reason || null });

// Prize orders for "Put a game on the ballot", for the Backstage poll form.
export async function prizePicks(env) {
  if (!env.DB) return [];
  return (await ticketStore(env.DB).pendingOrders(100)).filter((o) => o.prize === 'ballot-pick' && o.game_key).map((o) => ({ order: o.id, key: o.game_key, game: o.game_name, by: o.name }));
}

// When a Ringleader opens a poll, ballot-pick orders for games on it are done.
export async function fulfilPicks(env, pollTitle, keys, by) {
  if (!env.DB) return 0;
  const store = ticketStore(env.DB);
  let n = 0;
  for (const o of await store.pendingOrders(100)) {
    if (o.prize !== 'ballot-pick' || !keys.includes(o.game_key)) continue;
    if (await store.decide(o.id, 'done', by, `On the ballot for ${pollTitle}`)) {
      n++;
      await sendDm(env, o.user_id, `🎟️ Your pick **${o.game_name}** is on the ballot for **${pollTitle}**. Go vote: https://belpire.com/big-tent/`).catch(() => {});
    }
  }
  return n;
}

// ---------------------------------------------------------------- HTTP

export async function handleTickets(request, env) {
  if (!env.DB || !pollConfig(env).ok) return fail(503, 'unavailable', 'The ticket booth is being set up.');
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3); // after /api/tickets
  const session = await readSession(request, env);
  if (!session) return fail(401, 'signed_out', 'Sign in with Discord first.');
  const staffAction = ['staff', 'members', 'award', 'orders', 'post-scores'].includes(parts[0]);
  const store = ticketStore(env.DB);

  try {
    if (request.method === 'GET') {
      const who = await memberInfo(env, session, { fresh: staffAction });
      if (!who.member) return fail(403, 'not_member', 'Tickets are for members of the Belpire Discord.');
      if (parts.length === 0) {
        const show = await currentShow(env);
        const day = etDay();
        return json({
          me: { name: who.name, manager: who.manager },
          wallet: await summary(env, session.uid),
          rules: RULES,
          games: {
            shell: { left: Math.max(0, RULES.shellPlays - (await store.countRefs(`shell:${session.uid}:${day}:`))) },
            rings: { left: Math.max(0, RULES.ringPlays - (await store.countRefs(`rings:${session.uid}:${day}:`))) },
            striker: { left: Math.max(0, RULES.strikerPlays - (await store.countRefs(`striker:${session.uid}:${day}:`))) }
          },
          show: show ? await store.getCheckin(session.uid, show.key).then((c) => ({ title: show.title, checkedIn: Boolean(c), paid: Number(c?.paid || 0), cap: RULES.attendCap })) : null,
          history: (await store.history(session.uid, 25)).map((h) => ({ amount: h.amount, kind: h.kind, note: h.note, at: h.created_at })),
          prizes: PRIZES,
          orders: (await store.myOrders(session.uid, 10)).map(publicOrder),
          highScores: await highScores(env, session.uid),
          catalog: (await loadCatalog(env, url.origin)).map((c) => ({ key: c.key, name: c.name, group: c.group }))
        });
      }
      if (!who.manager) return fail(403, 'not_manager', 'Staff only.');
      if (parts[0] === 'staff') {
        return json({ orders: (await store.pendingOrders(100)).map((o) => ({ ...publicOrder(o), by: o.name })), announcements: Boolean(announceChannel(env)) });
      }
      if (parts[0] === 'members') {
        const q = cleanText(url.searchParams.get('q'), 32);
        if (q.length < 2) return json({ members: [] });
        const found = await searchMembers(env, q, 10);
        return json({ members: found.filter((m) => !m.user?.bot).map((m) => ({ id: m.user.id, name: String(m.nick || m.user.global_name || m.user.username).slice(0, 64), username: m.user.username })) });
      }
      return fail(404, 'not_found', 'Not found.');
    }

    if (request.method !== 'POST') return fail(405, 'method', 'Not allowed.');
    if (request.headers.get('Origin') !== url.origin || !(request.headers.get('Content-Type') || '').startsWith('application/json')) {
      return fail(403, 'forbidden', 'Use the buttons on belpire.com.');
    }
    const who = await memberInfo(env, session, { fresh: staffAction });
    if (!who.member) return fail(403, 'not_member', 'Tickets are for members of the Belpire Discord.');
    const body = await request.json().catch(() => ({}));

    if (parts.length === 1 && parts[0] === 'punch') return json({ ok: true, ...(await punch(env, session.uid, who.name)) });
    if (parts.length === 2 && parts[0] === 'games' && parts[1] === 'shell') return json({ ok: true, ...(await playShell(env, session.uid, who.name, Number(body.pick))) });
    if (parts.length === 2 && parts[0] === 'games' && parts[1] === 'rings') return json({ ok: true, ...(await playRings(env, session.uid, who.name, String(body.row || ''))) });
    if (parts.length === 2 && parts[0] === 'games' && parts[1] === 'striker') return json({ ok: true, ...(await swingStriker(env, session.uid, who.name)) });
    if (parts.length === 1 && parts[0] === 'checkin') return json({ ok: true, ...(await checkIn(env, session.uid, who.name)) });
    if (parts.length === 1 && parts[0] === 'privacy') {
      await store.setHidden(session.uid, who.name, Boolean(body.hidden));
      return json({ ok: true, hidden: Boolean(body.hidden) });
    }
    if (parts.length === 1 && parts[0] === 'redeem') {
      const prize = prizeById(body.prize);
      const catalog = prize?.needs === 'game' ? await loadCatalog(env, url.origin) : null;
      return json({ ok: true, ...(await redeem(env, session.uid, who.name, body, catalog)) });
    }

    if (!who.manager) return fail(403, 'not_manager', 'Only the Ringleaders can do that.');
    if (parts.length === 1 && parts[0] === 'post-scores') {
      try {
        return json({ ok: true, ...(await postHighScores(env)) });
      } catch (err) {
        if (err instanceof TicketError) throw err;
        throw new TicketError(502, 'discord', `Discord didn't take the post. ${explain(err)}`);
      }
    }
    if (parts.length === 1 && parts[0] === 'award') {
      const r = await award(env, who.name, body.userId, body.amount, body.note);
      if (r.amount > 0) await sendDm(env, body.userId, `🎟️ The Ringleaders handed you ${ticketsText(r.amount)}${body.note ? `: ${cleanText(body.note, 120)}` : '.'}`).catch(() => {});
      return json({ ok: true, ...r });
    }
    if (parts.length === 3 && parts[0] === 'orders' && ID.test(parts[1]) && ['done', 'refund'].includes(parts[2])) {
      const o = await store.getOrder(parts[1]);
      if (!o || o.status !== 'pending') return fail(404, 'not_found', 'That order has already been handled.');
      const prize = prizeById(o.prize);
      const reason = parts[2] === 'refund' ? cleanText(body.reason, 200) || null : null;
      if (!(await store.decide(o.id, parts[2] === 'done' ? 'done' : 'refunded', who.name, reason))) return fail(404, 'not_found', 'That order has already been handled.');
      let dm = null;
      if (parts[2] === 'done') {
        if (o.prize === 'fan-favorite') await store.setBadge(o.user_id, new Date(Date.now() + 30 * 86400000).toISOString());
        dm = await sendDm(env, o.user_id, `🎟️ Your prize is ready: **${prize?.name || o.prize}**. Enjoy it!`).catch(() => false);
      } else {
        await store.change(o.user_id, o.name, o.cost, 'refund', { note: `Refund: ${prize?.name || o.prize}`, by: who.name, ref: `refund:${o.id}` });
        dm = await sendDm(env, o.user_id, `🎟️ Your **${prize?.name || o.prize}** order was refunded (${ticketsText(o.cost)} back).${reason ? `\nFrom the Ringleaders: ${reason}` : ''}`).catch(() => false);
      }
      return json({ ok: true, dm });
    }
    return fail(404, 'not_found', 'Not found.');
  } catch (err) {
    if (err instanceof TicketError) return fail(err.status, err.code, err.message);
    console.error(`Tickets error: ${err.stack || err.message}`);
    return fail(500, 'error', 'The ticket booth jammed. Try again in a moment.');
  }
}
