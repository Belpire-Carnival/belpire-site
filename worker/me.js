// GET /api/me: everything the sign-in menu and the Ticket Booth page need about the person signed in,
// in one call. Ringleaders also get counts of what's waiting Backstage.

import { readSession } from './auth.js';
import { memberInfo, pollConfig } from './polls.js';
import { pollStore } from './poll-db.js';
import { passStatus, passStore, passConfig } from './passes.js';
import { oddityStore } from './oddity-db.js';
import { staffStore } from './staff-chat.js';
import { ticketStore } from './ticket-db.js';
import { summary } from './tickets.js';
import { liveStatus } from './live.js';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
  'X-Content-Type-Options': 'nosniff'
};
const json = (body) => new Response(JSON.stringify(body), { headers: HEADERS });
const quiet = (p, fallback) => p.catch((err) => {
  console.warn(`/api/me part failed: ${err.message}`);
  return fallback;
});

export async function handleMe(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ signedIn: false });
  if (!pollConfig(env).ok) return json({ signedIn: true, name: session.name, member: null });
  const who = await memberInfo(env, session);
  const body = { signedIn: true, name: who.name, member: who.member, manager: who.manager };
  if (!who.member) return json(body);

  body.pass = passStatus(env, who);
  const live = await quiet(liveStatus(env), { live: false });
  body.live = { live: Boolean(live.live), canJoin: Boolean(live.live) && (body.pass === 'has_pass' || body.pass === 'not_required') };
  if (!env.DB) return json(body);

  body.tickets = await quiet(summary(env, session.uid), null);
  const polls = pollStore(env.DB);
  const unvoted = [];
  let open = 0;
  for (const p of await quiet(polls.active(), [])) {
    if (p.status !== 'open') continue;
    open++;
    if (!(await polls.ballot(p.id, session.uid))) unvoted.push({ id: p.id, title: p.title });
  }
  body.polls = { open, unvoted };

  if (who.manager) {
    const [passes, oddities, orders, chat] = await Promise.all([
      passConfig(env).ok ? quiet(passStore(env.DB).pending(), []) : [],
      quiet(oddityStore(env.DB).list('pending', 50), []),
      quiet(ticketStore(env.DB).pendingOrders(100), []),
      quiet(staffStore(env.DB).latest(1), [])
    ]);
    body.staff = { passes: passes.length, oddities: oddities.length, prizes: orders.length, chatLatest: chat[0]?.created_at || null };
  }
  return json(body);
}
