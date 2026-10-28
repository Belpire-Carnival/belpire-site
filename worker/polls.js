// Game-night polls for The Big Tent (belpire.com/big-tent/).
//
//   GET  /api/polls/current          every active poll (several can run at once, one per game night)          the open/closed poll, upcoming scheduled nights, and what this visitor may do
//   POST /api/polls                  managers: open a poll from the game catalog
//   POST /api/polls/:id/ballot       members: rank up to 4 games (ranked choice, 4-3-2-1 points)
//   POST /api/polls/:id/doom         members: the Wheel of Doom picks 4 horror/party/Jackbox games; ballot locks
//   POST /api/polls/:id/close        managers: close voting, post the top 4 to #general
//   POST /api/polls/:id/schedule     managers: set date/time, create the Discord event in The Main Stage,
//                                    post a second message to #general
//   POST /api/polls/:id/announce     managers: retry whichever Discord post didn't go through
//   POST /api/polls/:id/cancel       managers: call it off
//   GET  /api/polls/discord-check    managers: what the bot can and can't do in #general and The Main Stage
//
// Who's who comes from the Discord server itself, read with the bot: anyone in the server votes;
// people holding a role in POLL_MANAGER_ROLE_IDS (RingMaster, RingMistress, Carnival Guard, Fortune Teller) manage.
// Runtime secrets: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, POLL_MANAGER_ROLE_IDS, MAIN_STAGE_CHANNEL_ID,
// GENERAL_CHANNEL_ID. Binding: DB (D1). The visitor's identity comes from the sign-in cookie (auth.js).

import { readSession } from './auth.js';
import { prizePicks, fulfilPicks } from './tickets.js';
import { pollStore } from './poll-db.js';
import { getMember, postMessage, createVoiceEvent, eventUrl, explain, checkSetup } from './discord-bot.js';

export const MAX_RANK = 4;
const POINTS = [4, 3, 2, 1];
const MIN_CANDIDATES = 2;
const MAX_CANDIDATES = 24;
export const MAX_ACTIVE_POLLS = 8;
const SNOWFLAKE = /^\d{17,20}$/;
const GOLD = 0xd9b26a;

// ---------------------------------------------------------------- config

export function pollConfig(env) {
  const managerRoles = String(env.POLL_MANAGER_ROLE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const problems = [];
  if (!env.DB) problems.push('DB binding');
  if (!env.DISCORD_BOT_TOKEN) problems.push('DISCORD_BOT_TOKEN');
  for (const k of ['DISCORD_GUILD_ID', 'MAIN_STAGE_CHANNEL_ID', 'GENERAL_CHANNEL_ID']) if (!SNOWFLAKE.test(String(env[k] || ''))) problems.push(k);
  if (!managerRoles.length || managerRoles.some((r) => !SNOWFLAKE.test(r))) problems.push('POLL_MANAGER_ROLE_IDS');
  return { ok: problems.length === 0, problems, managerRoles };
}

// ---------------------------------------------------------------- pure helpers (tested)

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Only Steam's own image CDN is trusted for cover art (it's also the only image host the CSP allows).
export function safeArt(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)steamstatic\.com$|(^|\.)akamaihd\.net$/.test(u.hostname) ? u.href : null;
  } catch {
    return null;
  }
}

// Games that can land on the Wheel of Doom: horror, party and every Jackbox game.
export const DOOM_TENTS = new Set(['horror', 'party']);
export const doomEligible = (c) => DOOM_TENTS.has(c.tent) || c.group === 'Jackbox';

// The games a poll can offer: every tracked favorite plus every Jackbox game.
export function buildCatalog(feed, packs) {
  const out = [];
  const seen = new Set();
  const add = (item) => {
    if (!item.name || seen.has(item.key)) return;
    seen.add(item.key);
    out.push(item);
  };
  const tracked = Array.isArray(feed?.tracked) && feed.tracked.length ? feed.tracked : feed?.favorites || [];
  for (const t of tracked) {
    if (Number(t.appid)) add({ key: `steam-${Number(t.appid)}`, name: String(t.name), group: 'Tracked games', tent: t.tent || 'other', image: safeArt(t.image) });
  }
  const art = feed?.jackbox?.images || {};
  for (const p of packs?.packs || []) {
    for (const g of p.games || []) {
      const single = (p.games || []).length === 1;
      add({ key: `jb-${Number(p.appid)}-${slug(g.name)}`, name: single ? String(g.name) : `${g.name} (${p.short || p.name})`, group: 'Jackbox', tent: 'party', players: `${g.min}–${g.max}`, image: safeArt(art[p.appid]) });
    }
  }
  return out;
}

// Fisher–Yates with crypto randomness: the server, not the browser, decides where the wheel lands.
export function doomPicks(candidates, count = MAX_RANK, rand = cryptoRandom) {
  const pool = candidates.filter(doomEligible).map((c) => c.key);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
function cryptoRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

export function cleanTitle(s) {
  const t = String(s || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || 'Game Night';
}

// A ballot is 1–4 distinct candidate keys, best first.
export function validRanking(ranking, candidateKeys) {
  if (!Array.isArray(ranking) || ranking.length < 1 || ranking.length > MAX_RANK) return false;
  const keys = new Set(candidateKeys);
  return new Set(ranking).size === ranking.length && ranking.every((k) => typeof k === 'string' && keys.has(k));
}

// Ranked choice by points (1st = 4 … 4th = 1). Ties: more first-place votes, then more ballots naming it, then A–Z.
export function tally(candidates, ballots) {
  const rows = new Map(candidates.map((c) => [c.key, { key: c.key, name: c.name, points: 0, firsts: 0, mentions: 0 }]));
  for (const ranking of ballots) {
    ranking.slice(0, MAX_RANK).forEach((key, i) => {
      const row = rows.get(key);
      if (!row) return;
      row.points += POINTS[i];
      row.mentions += 1;
      if (i === 0) row.firsts += 1;
    });
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.firsts - a.firsts || b.mentions - a.mentions || a.name.localeCompare(b.name));
}

export const winners = (standings) => standings.filter((r) => r.points > 0).slice(0, MAX_RANK);

// Accepts an ISO time with an explicit offset; must be 5 minutes to 180 days out.
export function validStart(iso, now = Date.now()) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t < now + 5 * 60 * 1000 || t > now + 180 * 86400 * 1000) return null;
  return new Date(t).toISOString();
}

const lineup = (top) => top.map((r, i) => `${i + 1}. ${r.name}`).join('\n');

export function resultsMessage(poll, standings, voters) {
  const top = winners(standings);
  return {
    embeds: [{
      title: `${poll.title}: the votes are in`,
      color: GOLD,
      description: top.length
        ? `${top.map((r, i) => `**${i + 1}. ${r.name}**  ·  ${r.points} ${r.points === 1 ? 'pt' : 'pts'}`).join('\n')}\n\n${voters} ${voters === 1 ? 'member' : 'members'} voted on belpire.com. Date and time are coming soon from the RingMaster.`
        : 'Nobody voted this time, so there is no lineup yet.',
      footer: { text: 'Belpire Carnival · Game Night poll' }
    }]
  };
}

export function eventPayload(poll) {
  const top = winners(poll.results || []);
  const names = top.map((r) => r.name).join(' · ');
  return {
    name: `${poll.title}: ${names}`.slice(0, 100),
    description: `Tonight's lineup, voted on belpire.com:\n${lineup(top)}\n\nJoin us in The Main Stage.`.slice(0, 1000)
  };
}

export function eventMessage(env, poll, eventId, startIso) {
  const unix = Math.floor(Date.parse(startIso) / 1000);
  const top = winners(poll.results || []);
  return {
    content: `Game night is set for <t:${unix}:F> (<t:${unix}:R>) in The Main Stage.`,
    embeds: [{
      title: poll.title,
      url: eventUrl(env, eventId),
      color: GOLD,
      description: `${lineup(top)}\n\nTap the event to mark yourself interested.`,
      footer: { text: 'Belpire Carnival · Game Night' }
    }]
  };
}

// ---------------------------------------------------------------- request helpers

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (status, error, message) => json({ error, message }, status);

// Same-site JSON posts only: blocks cross-site form posts and other sites' scripts.
function sameSitePost(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  return origin === url.origin && (request.headers.get('Content-Type') || '').startsWith('application/json');
}

async function readBody(request) {
  const text = await request.text();
  if (text.length > 8000) return null;
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
}

// Short per-isolate cache so a page load doesn't ask Discord about the same person repeatedly.
const memberCache = new Map();
export function _clearMemberCache() {
  memberCache.clear();
}
export function _forgetMember(uid) {
  memberCache.delete(uid);
}

async function whoIs(env, cfg, session, { fresh = false } = {}) {
  const hit = memberCache.get(session.uid);
  if (!fresh && hit && hit.until > Date.now()) return hit.value;
  const m = await getMember(env, session.uid);
  const value = m
    ? { member: true, manager: (m.roles || []).some((r) => cfg.managerRoles.includes(r)), roles: m.roles || [], name: String(m.nick || m.user?.global_name || m.user?.username || session.name).slice(0, 64) }
    : { member: false, manager: false, roles: [], name: session.name };
  memberCache.set(session.uid, { value, until: Date.now() + 2 * 60 * 1000 });
  return value;
}

// Membership and Ringleader status for other features (Hall of Oddities), with the same short cache.
export function memberInfo(env, session, opts) {
  return whoIs(env, pollConfig(env), session, opts);
}

// Ballots cast before names were recorded get their name looked up once (server nickname or display name)
// and saved, so the list fills in by itself. Never returns user IDs.
async function votersWithNames(env, store, pollId) {
  const rows = await store.voters(pollId);
  let lookups = 0;
  for (const v of rows) {
    if (v.name || lookups >= 10) continue;
    lookups++;
    try {
      const m = await getMember(env, v.userId);
      const name = m ? String(m.nick || m.user?.global_name || m.user?.username || '').slice(0, 64) : '';
      if (name) {
        v.name = name;
        await store.setVoterName(pollId, v.userId, name);
      }
    } catch (err) {
      console.warn(`Voter name lookup failed: ${err.message}`);
    }
  }
  return rows.map((v) => ({ name: v.name || 'A member', doom: v.doom }));
}

let catalogCache = null;
export async function loadCatalog(env, origin) {
  if (catalogCache && catalogCache.until > Date.now()) return catalogCache.value;
  const get = async (path) => {
    try {
      const res = await env.ASSETS.fetch(new Request(origin + path));
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const [feed, packs] = await Promise.all([get('/data/feed.json'), get('/jackbox/packs.json')]);
  const value = buildCatalog(feed, packs);
  catalogCache = { value, until: Date.now() + 10 * 60 * 1000 };
  return value;
}
export function _clearCatalogCache() {
  catalogCache = null;
}

function publicPoll(poll, extra = {}) {
  if (!poll) return null;
  const closed = poll.status !== 'open';
  return {
    id: poll.id,
    title: poll.title,
    status: poll.status,
    candidates: poll.candidates,
    createdByName: poll.created_by_name,
    createdAt: new Date(poll.created_at).toISOString(),
    closedByName: poll.closed_by_name || null,
    results: closed ? poll.results : null, // hidden while voting, so nobody piles onto the leader
    resultsPosted: poll.results_posted,
    eventStart: poll.event_start || null,
    eventPosted: poll.event_posted,
    ...extra
  };
}

export const BALLOT_RETENTION_DAYS = 90;

// Called from the Cron Trigger. Quietly does nothing until polls are set up.
export async function purgeOldBallots(env, now = Date.now()) {
  if (!env.DB) return 0;
  return pollStore(env.DB).purgeBallots(now - BALLOT_RETENTION_DAYS * 86400 * 1000);
}

// ---------------------------------------------------------------- handlers

export async function handlePolls(request, env, ctx) {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(3); // after /api/polls
  const cfg = pollConfig(env);
  if (!cfg.ok) {
    console.warn('Game-night polls not configured:', cfg.problems.join(', '));
    return fail(503, 'unavailable', 'Game-night polls are being set up. Check back soon.');
  }
  const store = pollStore(env.DB);
  const session = await readSession(request, env);

  try {
    // GET /api/polls/current
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'current') {
      const active = await store.active();
      let me = { signedIn: false, member: false, manager: false };
      if (session) {
        const who = await whoIs(env, cfg, session);
        me = { signedIn: true, name: who.name, member: who.member, manager: who.manager };
      }
      const polls = [];
      for (const poll of active) {
        const extra = { voteCount: await store.voteCount(poll.id) };
        if (me.member) {
          extra.voters = await votersWithNames(env, store, poll.id); // names for members only; picks stay secret
          const mine = await store.ballot(poll.id, session.uid);
          extra.myBallot = mine?.ranking || null;
          extra.myBallotLocked = Boolean(mine?.locked);
        }
        polls.push(publicPoll(poll, extra));
      }
      const upcoming = (await store.upcoming(new Date().toISOString())).map((p) => ({
        id: p.id,
        title: p.title,
        eventStart: p.event_start,
        lineup: winners(p.results || []).map((r) => r.name),
        eventUrl: me.member && p.event_id ? eventUrl(env, p.event_id) : null,
        eventPosted: p.event_posted
      }));
      const catalog = me.manager ? await loadCatalog(env, url.origin) : undefined;
      // Prize Booth "Put a game on the ballot" orders, pre-ticked in the Backstage poll form.
      const picks = me.manager ? await prizePicks(env).catch(() => []) : undefined;
      // `poll` is the newest active poll, kept for older pages; `polls` is every active one.
      return json({ me, polls, poll: polls.at(-1) || null, upcoming, catalog, prizePicks: picks });
    }

    // GET /api/polls/discord-check (Ringleaders only)
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'discord-check') {
      if (!session) return fail(401, 'signin', 'Sign in with Discord first.');
      const who = await whoIs(env, cfg, session, { fresh: true });
      if (!who.manager) return fail(403, 'not_manager', 'Only the RingMaster, RingMistress, Carnival Guards and the Fortune Teller can run this check.');
      return json({ checks: await checkSetup(env) });
    }

    if (request.method !== 'POST') return fail(405, 'method', 'Not allowed.');
    if (!sameSitePost(request)) return fail(403, 'forbidden', 'Blocked.');
    if (!session) return fail(401, 'signin', 'Sign in with Discord first.');
    const body = await readBody(request);
    if (!body) return fail(400, 'bad_request', 'That request was malformed.');

    // POST /api/polls  (open a poll)
    if (parts.length === 0) {
      const who = await whoIs(env, cfg, session, { fresh: true });
      if (!who.manager) return fail(403, 'not_manager', 'Only the RingMaster, RingMistress, Carnival Guards and the Fortune Teller can start a poll.');
      if ((await store.active(MAX_ACTIVE_POLLS + 1)).length >= MAX_ACTIVE_POLLS) return fail(409, 'active', `${MAX_ACTIVE_POLLS} polls are already running. Close or cancel one first.`);
      const catalog = await loadCatalog(env, url.origin);
      const byKey = new Map(catalog.map((c) => [c.key, c]));
      const keys = Array.isArray(body.candidates) ? [...new Set(body.candidates)] : [];
      if (keys.length < MIN_CANDIDATES || keys.length > MAX_CANDIDATES || !keys.every((k) => byKey.has(k))) {
        return fail(400, 'candidates', `Pick between ${MIN_CANDIDATES} and ${MAX_CANDIDATES} games from the list.`);
      }
      const poll = {
        id: crypto.randomUUID(),
        title: cleanTitle(body.title),
        candidates: keys.map((k) => { const c = byKey.get(k); return { key: k, name: c.name, tent: c.tent, group: c.group, image: c.image || null }; }),
        created_by: session.uid,
        created_by_name: who.name,
        created_at: Date.now()
      };
      await store.create(poll);
      const picked = await fulfilPicks(env, poll.title, keys, who.name).catch((err) => {
        console.warn(`Ballot-pick prizes not updated: ${err.message}`);
        return 0;
      });
      return json({ ok: true, id: poll.id, prizePicks: picked }, 201);
    }

    const poll = await store.get(parts[0]);
    if (!poll || poll.status === 'cancelled') return fail(404, 'not_found', 'That poll no longer exists.');
    const action = parts[1];
    const who = await whoIs(env, cfg, session, { fresh: action !== 'ballot' });

    if (action === 'ballot') {
      if (!who.member) return fail(403, 'not_member', 'Join the Belpire Discord to vote.');
      if (poll.status !== 'open') return fail(409, 'closed', 'Voting has closed.');
      if (!validRanking(body.ranking, poll.candidates.map((c) => c.key))) return fail(400, 'ranking', `Rank between 1 and ${MAX_RANK} different games from this poll.`);
      const saved = await store.saveBallot(poll.id, session.uid, body.ranking, Date.now(), { name: who.name });
      if (!saved) return fail(409, 'locked', 'The Wheel of Doom already chose for you. No take-backs.');
      return json({ ok: true });
    }

    // The Wheel of Doom: four random horror/party/Jackbox picks, saved and locked in one step.
    if (action === 'doom') {
      if (!who.member) return fail(403, 'not_member', 'Join the Belpire Discord to vote.');
      if (poll.status !== 'open') return fail(409, 'closed', 'Voting has closed.');
      const ranking = doomPicks(poll.candidates);
      if (!ranking.length) return fail(400, 'no_doom', 'No horror, party or Jackbox games on this ballot, so the wheel has nothing to spin.');
      const saved = await store.saveBallot(poll.id, session.uid, ranking, Date.now(), { locked: true, name: who.name });
      if (!saved) return fail(409, 'locked', 'The Wheel of Doom already chose for you. No take-backs.');
      return json({ ok: true, ranking, locked: true });
    }

    if (!who.manager) return fail(403, 'not_manager', 'Only the RingMaster, RingMistress, Carnival Guards and the Fortune Teller can do that.');

    if (action === 'close') {
      const ballots = await store.ballots(poll.id);
      const standings = tally(poll.candidates, ballots);
      const closed = await store.close(poll.id, { results: standings, closedAt: Date.now(), closedByName: who.name });
      if (!closed) return fail(409, 'state', 'This poll was already closed.');
      let posted = false;
      let reason = null;
      try {
        await postMessage(env, env.GENERAL_CHANNEL_ID, resultsMessage(poll, standings, ballots.length));
        await store.markResultsPosted(poll.id);
        posted = true;
      } catch (err) {
        console.warn(`Results post failed: ${err.message}`);
        reason = explain(err);
      }
      return json({ ok: true, posted, reason });
    }

    if (action === 'schedule') {
      if (poll.status !== 'closed') return fail(409, 'state', 'Close voting before setting the date.');
      const start = validStart(body.start);
      if (!start) return fail(400, 'start', 'Pick a date and time between 5 minutes and 6 months from now.');
      if (!winners(poll.results || []).length) return fail(409, 'empty', 'Nobody voted, so there is no lineup to schedule.');
      let event;
      try {
        event = await createVoiceEvent(env, { ...eventPayload(poll), start });
      } catch (err) {
        console.warn(`Event creation failed: ${err.message}`);
        return fail(502, 'discord', `Discord did not create the event. ${explain(err)}`);
      }
      const ok = await store.schedule(poll.id, { eventId: event.id, start, scheduledByName: who.name });
      if (!ok) return fail(409, 'state', 'This poll was already scheduled.');
      let posted = false;
      let reason = null;
      try {
        await postMessage(env, env.GENERAL_CHANNEL_ID, eventMessage(env, poll, event.id, start));
        await store.markEventPosted(poll.id);
        posted = true;
      } catch (err) {
        console.warn(`Event announcement failed: ${err.message}`);
        reason = explain(err);
      }
      return json({ ok: true, posted, reason, eventUrl: eventUrl(env, event.id) });
    }

    if (action === 'announce') {
      try {
        if (poll.status === 'closed' && !poll.results_posted) {
          const voters = (await store.ballots(poll.id)).length;
          await postMessage(env, env.GENERAL_CHANNEL_ID, resultsMessage(poll, poll.results || [], voters));
          await store.markResultsPosted(poll.id);
          return json({ ok: true, posted: 'results' });
        }
        if (poll.status === 'scheduled' && !poll.event_posted) {
          await postMessage(env, env.GENERAL_CHANNEL_ID, eventMessage(env, poll, poll.event_id, poll.event_start));
          await store.markEventPosted(poll.id);
          return json({ ok: true, posted: 'event' });
        }
      } catch (err) {
        console.warn(`Retry post failed: ${err.message}`);
        return fail(502, 'discord', `Discord did not take the post. ${explain(err)}`);
      }
      return json({ ok: true, posted: null });
    }

    if (action === 'cancel') {
      const ok = await store.cancel(poll.id);
      return ok ? json({ ok: true }) : fail(409, 'state', 'Only open or closed polls can be cancelled.');
    }

    return fail(404, 'not_found', 'Unknown action.');
  } catch (err) {
    console.warn(`Poll request failed: ${err.message}`);
    return fail(503, 'unavailable', 'Discord or the database did not answer. Try again in a moment.');
  }
}
