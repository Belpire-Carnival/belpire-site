// Tickets: Belpire's carnival currency. One bank (D1, see ticket-db.js) that both the website and the
// Belpire Usher's slash commands read and write, so Discord and belpire.com always show the same balance.
//
// Earning                                     Spending
//   daily punch card (streak bonus)             the Prize Booth (worker/prizes.js); orders wait Backstage
//   the Midway's booths (worker/midway.js)      and a Ringleader marks them done or refunds them
//   game-night attendance (check in, then paid
//     every 10 minutes while in The Main Stage)
//   Ringleaders handing tickets out
//
//   GET  /api/tickets                       members: wallet, history, games, show, prizes, orders, high scores
//   POST /api/tickets/punch                 members
//   POST /api/tickets/games/shell|rings|striker  members (kept for old pages; the Midway is /api/midway, worker/midway.js)
//   POST /api/tickets/checkin               members, while a show is on
//   POST /api/tickets/redeem                members  { prize, detail?, game? }
//   POST /api/tickets/privacy               members  { hidden }
//   GET  /api/tickets/staff                 Ringleaders: open prize orders
//   GET  /api/tickets/members?q=            Ringleaders: find someone to hand tickets to
//   POST /api/tickets/award                 Ringleaders  { userId, amount, note }
//   POST /api/tickets/post-scores           Ringleaders: post the High Scores to the announcements channel now
//   POST /api/tickets/draw                  Ringleaders: draw the Golden Ticket winner from the entries waiting
//   POST /api/tickets/orders/:id/done       Ringleaders
//   POST /api/tickets/orders/:id/refund     Ringleaders  { reason? }

import { coinFor, coinLadder } from './coins.js';
import { readSession } from './auth.js';
import { memberInfo, pollConfig, loadCatalog } from './polls.js';
import { pollStore } from './poll-db.js';
import { liveStatus } from './live.js';
import { getVoiceState, getMember, searchMembers, listMembers, postMessage, sendDm, explain } from './discord-bot.js';
import { ticketStore, newId } from './ticket-db.js';
import { PRIZES, prizeById, prizeName } from './prizes.js';
import { play as midwayRun, midwayState, MidwayError } from './midway.js';

export const RULES = {
  punchBase: 10,
  punchStreakStep: 2,
  punchStreakMax: 5, // bonus days counted, so a 6-day streak and beyond earns 10 + 2×5 = 20
  // Booth games, odds and daily plays live in worker/midway.js (GAMES).
  attendPerCheck: 3,
  attendCap: 60,
  awardMax: 500,
  // The Concession Tent: snacks bought with Slivers. Orders are counted for the curd Feats.
  concessionDaily: 10,
  snacks: {
    curds: { name: 'Cheese Curds', icon: '🧀', cost: 5, line: 'A paper boat of cheese curds, still squeaking. The RingMistress will not discuss the recipe.' },
    apple: { name: 'Candy Apple', icon: '🍎', cost: 4, line: 'A candy apple from the cart, glossy red and a little too warm.' },
    popcorn: { name: 'Popcorn', icon: '🍿', cost: 3, line: 'A striped bag of popcorn. Every kernel is popped. Nobody saw the machine running.' }
  }
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

// Prize caps count by calendar quarter (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec), Eastern. → the instant it began, as ISO.
export function quarterStart(now = Date.now()) {
  const [y, m] = etDay(now).split('-').map(Number);
  const first = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  for (const hours of [4, 5]) { // midnight Eastern is 04:00 UTC in summer time, 05:00 otherwise
    const t = Date.parse(`${first}T00:00:00Z`) + hours * 3600e3;
    if (etDay(t) === first && etDay(t - 1) !== first) return new Date(t).toISOString();
  }
  return `${first}T05:00:00.000Z`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Jan 1": when the caps next start over.
export function quarterResets(now = Date.now()) {
  const m = Number(etDay(now).split('-')[1]);
  return `${MONTHS[(Math.floor((m - 1) / 3) * 3 + 3) % 12]} 1`;
}

export const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const plural = (n, word) => `${n} ${word}${Math.abs(n) === 1 ? '' : 's'}`;
export const ticketsText = (n) => plural(n, 'Sliver'); // the currency is Slivers; code names keep 'tickets'

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

// The three original booths now run on the Midway (worker/midway.js): same odds, same daily plays, but only in the
// weeks the rotation opens them. These keep the shapes the Discord commands already use.
async function midwayPlay(env, uid, name, gameId, choice, now) {
  try {
    return await midwayRun(env, uid, name, gameId, choice, now);
  } catch (err) {
    if (err instanceof MidwayError) throw new TicketError(err.status, err.code, err.message);
    throw err;
  }
}

export async function playShell(env, uid, name, pick, now) {
  if (![0, 1, 2].includes(pick)) throw new TicketError(400, 'pick', 'Pick shell 1, 2 or 3.');
  const r = await midwayPlay(env, uid, name, 'find-the-pea', String(pick + 1), now);
  return { pea: r.visualParams.pea, win: r.outcomeTier === 'found', amount: r.amount, balance: r.balance, playsLeft: r.playsLeft };
}

export async function playRings(env, uid, name, row, now) {
  const r = await midwayPlay(env, uid, name, 'ring-toss', row, now);
  return { row: r.visualParams.row, win: r.outcomeTier === 'ringer', bottle: r.visualParams.bottle, amount: r.amount, balance: r.balance, playsLeft: r.playsLeft };
}

const STRIKER_LABELS = { wimp: 'Wimp', 'not-bad': 'Not bad', strongman: 'Strongman', bell: 'DING!' };
export async function swingStriker(env, uid, name, now) {
  const r = await midwayPlay(env, uid, name, 'high-striker', null, now);
  const height = r.visualParams.height;
  return { height, bell: height === 10, label: STRIKER_LABELS[r.outcomeTier], amount: r.amount, balance: r.balance, playsLeft: r.playsLeft };
}

// 2 while a sponsored Double Night is running for this show, else 1. The first time a show is looked at, the oldest
// waiting "Sponsor a Double Night" order is used up on it, so only one Double Night runs per game night; the rest
// wait for the next one.
export async function showBoost(env, show) {
  const store = ticketStore(env.DB);
  if (await store.doubledShow(show.key)) return 2;
  const next = (await store.pendingOf('double-night'))[0];
  if (!next) return 1;
  if (!(await store.decide(next.id, 'done', 'The Usher', `show:${show.key}`))) return (await store.doubledShow(show.key)) ? 2 : 1;
  const channel = modChannel(env);
  if (channel) {
    await postMessage(env, channel, { content: `🎪 **Double Night!** ${safeName(next.name)} sponsored it, so check-in Slivers are doubled for **${safeName(show.title)}**.` })
      .catch((err) => console.warn(`Double Night note failed: ${explain(err)}`));
  }
  await sendDm(env, next.user_id, `🎪 Your **Double Night** is on: everyone at **${show.title}** earns double check-in Slivers. Thank you for sponsoring it!`).catch(() => {});
  return 2;
}

export async function checkIn(env, uid, name, now = Date.now()) {
  const show = await currentShow(env, now);
  if (!show) throw new TicketError(409, 'no_show', 'No show right now. Check in when a game night is on or a Ringleader is live in The Main Stage.');
  const vs = await getVoiceState(env, uid).catch(() => null);
  if (!onStage(vs, env)) throw new TicketError(409, 'not_on_stage', 'Hop into The Main Stage first (and undeafen), then check in.');
  const store = ticketStore(env.DB);
  const boost = await showBoost(env, show);
  const per = RULES.attendPerCheck * boost;
  const cap = RULES.attendCap * boost;
  const row = await store.checkin(uid, name, show.key);
  let paid = Number(row.paid || 0);
  let earned = 0;
  if (paid < cap) {
    const b = await store.change(uid, name, per, 'attend', { note: `At the show: ${show.title}${boost > 1 ? ' (Double Night)' : ''}`, ref: `attend:${uid}:${show.key}:${slot(now)}` });
    if (b !== null) {
      earned = per;
      paid += earned;
      await store.addPaid(uid, show.key, earned);
    }
  }
  return { show: show.title, earned, paid, cap, doubled: boost > 1 };
}

// Cron, every 10 minutes: pays everyone checked in to the current show who is still in The Main Stage.
export async function payAttendance(env, now = Date.now()) {
  if (!env.DB || !env.DISCORD_BOT_TOKEN || !SNOWFLAKE.test(String(env.MAIN_STAGE_CHANNEL_ID || ''))) return 0;
  const store = ticketStore(env.DB);
  await store.purgeCheckinsBefore(new Date(now - 3 * 86400000).toISOString());
  const show = await currentShow(env, now);
  if (!show) return 0;
  let paidOut = 0;
  const boost = await showBoost(env, show);
  const per = RULES.attendPerCheck * boost;
  const cap = RULES.attendCap * boost;
  for (const c of await store.checkins(show.key, 40)) {
    if (c.paid >= cap) continue;
    const vs = await getVoiceState(env, c.user_id).catch(() => null);
    if (!onStage(vs, env)) continue;
    const b = await store.change(c.user_id, c.name, per, 'attend', { note: `At the show: ${show.title}${boost > 1 ? ' (Double Night)' : ''}`, ref: `attend:${c.user_id}:${show.key}:${slot(now)}` });
    if (b !== null) {
      await store.addPaid(c.user_id, show.key, per);
      paidOut += per;
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
  const line = (r, i, n) => `${MEDALS[i] || `**${i + 1}.**`} ${clean(r.name)}${r.badge ? ' ✦' : ''} · ${Number(n).toLocaleString('en-US')} Slivers`;
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

// Why a prize can't be bought right now, or null. `counts` is store.orderCounts for this quarter.
function lockedReason(prize, lifetime, counts) {
  if (prize.pending) return 'pending';
  if (prize.gate && lifetime < prize.gate) return 'gate';
  if (prize.cap != null && (counts.all[prize.id] || 0) >= prize.cap) return 'soldout';
  if (prize.group) {
    const used = PRIZES.filter((p) => p.group === prize.group).reduce((n, p) => n + (counts.mine[p.id] || 0), 0);
    if (used >= prize.perMember) return 'member';
  } else if (prize.perMember && (counts.mine[prize.id] || 0) >= prize.perMember) return 'member';
  return null;
}

// The booth as one member sees it: every prize with how many are left this quarter and whether it can be bought.
export async function shelf(env, uid, lifetime, now = Date.now()) {
  const counts = await ticketStore(env.DB).orderCounts(quarterStart(now), uid);
  return PRIZES.map((p) => ({
    ...p,
    left: p.cap == null ? null : Math.max(0, p.cap - (counts.all[p.id] || 0)),
    locked: lockedReason(p, Number(lifetime || 0), counts),
    gateCoin: p.gate ? coinFor(p.gate).name : null
  }));
}

const LOCKED_TEXT = {
  pending: (p) => `${p.name} isn't open yet. It's waiting for approval.`,
  gate: (p) => `${p.name} needs ${p.gate ? coinFor(p.gate).name : 'a higher'} coin. Keep playing!`,
  soldout: (p) => `${p.name} is sold out for this quarter. The booth restocks on ${quarterResets()}.`,
  member: (p) => (p.group ? `You've already claimed a real-money prize this quarter. The booth resets on ${quarterResets()}.` : `That's all ${p.perMember} of ${p.name} for this quarter.`)
};

export async function redeem(env, uid, name, { prize: prizeId, detail, game } = {}, catalog = null, now = Date.now()) {
  const prize = prizeById(prizeId);
  if (!prize) throw new TicketError(400, 'prize', 'That prize isn\'t in the booth.');
  const store = ticketStore(env.DB);
  if ((await store.waiting(uid, prize.id)) >= prize.limit) throw new TicketError(409, 'waiting', `You already have ${prize.name} waiting for a Ringleader.`);
  const since = quarterStart(now);
  const lock = lockedReason(prize, Number((await store.wallet(uid))?.lifetime || 0), await store.orderCounts(since, uid));
  if (lock) throw new TicketError(lock === 'pending' || lock === 'gate' ? 403 : 409, lock, LOCKED_TEXT[lock](prize));
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
  // Place the order first (so two people can't take the last of a capped prize), then take the Slivers; no Slivers, no order.
  if (prize.cap != null) {
    if (!(await store.orderWithinCap(o, prize.cap, since))) throw new TicketError(409, 'soldout', LOCKED_TEXT.soldout(prize));
  } else {
    await store.order(o);
  }
  const balance = await store.spend(uid, prize.cost, 'redeem', `Prize Booth: ${prize.name}`);
  if (balance === null) {
    await store.dropOrder(o.id);
    throw new TicketError(402, 'short', `${prize.name} costs ${ticketsText(prize.cost)}. Keep playing!`);
  }
  // Double Night and drawing entries run themselves; everything else waits Backstage for a Ringleader.
  const channel = modChannel(env);
  if (channel && !prize.kind) {
    const what = o.game_name ? ` (${o.game_name})` : o.detail ? `: “${o.detail}”` : '';
    await postMessage(env, channel, { content: `🎟️ **${safeName(name)}** redeemed **${prize.name}**${what} for ${ticketsText(prize.cost)}.\nSort it out Backstage: https://belpire.com/backstage/#bs-prizes` })
      .catch((err) => console.warn(`Prize note failed: ${explain(err)}`));
  }
  return { order: publicOrder(o), balance };
}

// Backstage: draws this quarter's Golden Ticket winner from every entry waiting (each entry is one chance), and closes them.
export async function drawGoldenTicket(env, by) {
  const store = ticketStore(env.DB);
  const entries = await store.pendingOf('golden-ticket');
  if (!entries.length) throw new TicketError(409, 'no_entries', 'Nobody has entered the drawing yet.');
  const win = entries[randomInt(entries.length)];
  for (const e of entries) await store.decide(e.id, 'done', by, e.id === win.id ? 'You won the drawing!' : `Drawing won by ${win.name}`);
  await sendDm(env, win.user_id, '🎟️ **You won the Golden Ticket drawing!** A Ringleader will be in touch about your $25 gift card.').catch(() => {});
  const channel = modChannel(env);
  if (channel) {
    await postMessage(env, channel, { content: `🎟️ Golden Ticket drawing: **${safeName(win.name)}** won, out of ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} from ${new Set(entries.map((e) => e.user_id)).size} members. Sort out their $25 gift card.` })
      .catch((err) => console.warn(`Drawing note failed: ${explain(err)}`));
  }
  return { winner: win.name, userId: win.user_id, entries: entries.length, players: new Set(entries.map((e) => e.user_id)).size };
}

const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });
const etHour = (ms) => Number(hourFmt.format(new Date(ms)));

// The Concession Tent. Spends Slivers on a snack and counts the order (refs feed the curd Feats).
// Leaving a snack on the counter between midnight and 4 a.m. Eastern means something eats it.
export async function concession(env, uid, name, snackId, leave = false, now = Date.now()) {
  const snack = RULES.snacks[snackId];
  if (!snack) throw new TicketError(400, 'snack', 'The Concession Tent doesn\'t serve that.');
  const store = ticketStore(env.DB);
  const day = etDay(now);
  const today = await store.countRefs(`concession:${uid}:${day}:`);
  if (today >= RULES.concessionDaily) throw new TicketError(429, 'full', 'That\'s enough snacks for one day. The Concession Tent reopens at midnight Eastern.');
  const ref = `concession:${uid}:${day}:${snackId}:${today + 1}`;
  const balance = await store.spend(uid, snack.cost, 'concession', `Concession Tent: ${snack.name}`, ref);
  if (balance === null) throw new TicketError(402, 'short', `${snack.name} costs ${ticketsText(snack.cost)}. Keep playing!`);
  const night = etHour(now) < 4;
  const eaten = Boolean(leave && night);
  const curds = snackId === 'curds'
    ? Number((await env.DB.prepare('SELECT COUNT(*) AS n FROM ticket_ledger WHERE ref LIKE ?').bind(`concession:${uid}:%:curds:%`).first()).n)
    : null;
  return { snack: snack.name, icon: snack.icon, cost: snack.cost, line: snack.line, balance, left: Boolean(leave), eaten, curdsAllTime: curds, ordersToday: today + 1 };
}

export async function award(env, by, userId, amount, note) {
  if (!SNOWFLAKE.test(String(userId || ''))) throw new TicketError(400, 'user', 'Pick someone from the list.');
  amount = Math.trunc(Number(amount));
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > RULES.awardMax) throw new TicketError(400, 'amount', `Hand out between 1 and ${RULES.awardMax} Slivers (or take some back with a minus).`);
  const m = await getMember(env, userId);
  if (!m) throw new TicketError(404, 'not_member', 'That person isn\'t in the server.');
  const name = String(m.nick || m.user?.global_name || m.user?.username || 'A member').slice(0, 64);
  const why = cleanText(note, 120) || (amount > 0 ? 'A gift from the Ringleaders' : 'Adjusted by the Ringleaders');
  const balance = await ticketStore(env.DB).change(userId, name, amount, amount > 0 ? 'award' : 'adjust', { note: why, by });
  return { name, amount, balance };
}

// A gift to every member of the server (bots skipped), from /give-everyone. `key` (the interaction ID) makes
// each run pay each member once, even if Discord retries. Needs the Server Members intent, like the pass sync.
export async function awardEveryone(env, by, amount, note, key) {
  amount = Math.trunc(Number(amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > RULES.awardMax) throw new TicketError(400, 'amount', `Give everyone between 1 and ${RULES.awardMax} Slivers.`);
  const why = cleanText(note, 120) || 'A gift from the Ringleaders to everyone';
  const store = ticketStore(env.DB);
  let given = 0, already = 0;
  for (const m of await listMembers(env)) {
    if (!m?.user?.id || m.user.bot) continue;
    const name = String(m.nick || m.user.global_name || m.user.username || 'A member').slice(0, 64);
    const r = await store.change(m.user.id, name, amount, 'award', { note: why, by, ref: `everyone:${key}:${m.user.id}` });
    if (r === null) already++; else given++;
  }
  return { given, already, amount };
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
    rank: await store.rank(uid),
    coin: coinFor(w?.lifetime)
  };
}

export async function highScores(env, uid = null, limit = 10) {
  const now = new Date().toISOString();
  return (await ticketStore(env.DB).leaderboard(limit)).map((r, i) => ({ rank: i + 1, name: r.name, lifetime: Number(r.lifetime), coin: coinFor(r.lifetime), badge: Boolean(r.badge_until && r.badge_until > now), me: r.user_id === uid }));
}

const publicOrder = (o) => ({ id: o.id, prize: o.prize, name: prizeName(o.prize), cost: o.cost, detail: o.detail, game: o.game_name, status: o.status || 'pending', at: o.created_at || new Date().toISOString(), reason: String(o.reason || '').startsWith('show:') ? 'Played at a game night' : o.reason || null });

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
  const staffAction = ['staff', 'members', 'award', 'orders', 'post-scores', 'draw'].includes(parts[0]);
  const store = ticketStore(env.DB);

  try {
    if (request.method === 'GET') {
      const who = await memberInfo(env, session, { fresh: staffAction });
      if (!who.member) return fail(403, 'not_member', 'Slivers are for members of the Belpire Discord.');
      if (parts.length === 0) {
        const day = etDay();
        // Everything below is independent, so ask for it all at once instead of one query after another.
        const [show, wallet, midway, history, orders, scores, catalog] = await Promise.all([
          currentShow(env).then((s) => (s ? Promise.all([store.getCheckin(session.uid, s.key), store.doubledShow(s.key)]).then(([c, d]) => ({ title: s.title, checkedIn: Boolean(c), paid: Number(c?.paid || 0), cap: RULES.attendCap * (d ? 2 : 1), doubled: Boolean(d) })) : null)),
          summary(env, session.uid),
          midwayState(env, session.uid),
          store.history(session.uid, 25),
          store.myOrders(session.uid, 10),
          highScores(env, session.uid),
          loadCatalog(env, url.origin)
        ]);
        return json({
          me: { name: who.name, manager: who.manager },
          wallet,
          rules: RULES,
          coins: coinLadder(),
          midway,
          show,
          history: history.map((h) => ({ amount: h.amount, kind: h.kind, note: h.note, at: h.created_at })),
          prizes: await shelf(env, session.uid, wallet.lifetime),
          prizeResets: quarterResets(),
          orders: orders.map(publicOrder),
          highScores: scores,
          catalog: catalog.map((c) => ({ key: c.key, name: c.name, group: c.group }))
        });
      }
      if (!who.manager) return fail(403, 'not_manager', 'Staff only.');
      if (parts[0] === 'staff') {
        const entries = await store.pendingOf('golden-ticket');
        const sponsors = await store.pendingOf('double-night');
        return json({
          orders: (await store.pendingOrders(100, ['golden-ticket', 'double-night'])).map((o) => ({ ...publicOrder(o), by: o.name })),
          drawing: { entries: entries.length, players: new Set(entries.map((e) => e.user_id)).size },
          doubleNights: sponsors.length,
          announcements: Boolean(announceChannel(env))
        });
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
    if (!who.member) return fail(403, 'not_member', 'Slivers are for members of the Belpire Discord.');
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
    if (parts.length === 1 && parts[0] === 'draw') return json({ ok: true, ...(await drawGoldenTicket(env, who.name)) });
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
