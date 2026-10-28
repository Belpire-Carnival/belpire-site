// The Belpire Usher's slash commands. Discord sends each command to POST /api/discord/interactions (the
// app's Interactions Endpoint URL); we check Discord's signature and answer straight away. No always-on
// connection needed. Tickets use the same bank as belpire.com, so both always agree.
//
// Commands are registered once with `npm run commands` (scripts/register-commands.mjs).
// Runtime secret: DISCORD_PUBLIC_KEY (the app's public key, used to verify each request).

import { pollConfig } from './polls.js';
import { PRIZES, prizeById } from './prizes.js';
import { punch, playShell, checkIn, redeem, award, summary, highScores, ticketsText, RULES, TicketError } from './tickets.js';

const EPHEMERAL = 64;
const enc = new TextEncoder();
const PEA_SHELLS = ['🥫', '🥫', '🥫'];

export const COMMANDS = [
  { name: 'tickets', description: 'Your Belpire ticket balance, streak and rank', type: 1 },
  { name: 'punch-card', description: 'Punch your daily card for free tickets (streaks pay more)', type: 1 },
  {
    name: 'find-the-pea', description: 'The shell game: pick a shell and win tickets if the pea is under it', type: 1,
    options: [{ type: 4, name: 'shell', description: 'Which shell?', required: true, choices: [{ name: 'Left', value: 1 }, { name: 'Middle', value: 2 }, { name: 'Right', value: 3 }] }]
  },
  { name: 'checkin', description: 'Check in to tonight\'s show from The Main Stage to earn attendance tickets', type: 1 },
  { name: 'high-scores', description: 'The Midway High Scores: most tickets won', type: 1 },
  { name: 'prizes', description: 'What\'s in the Prize Booth', type: 1 },
  {
    name: 'redeem', description: 'Spend tickets at the Prize Booth', type: 1,
    options: [
      { type: 3, name: 'prize', description: 'Which prize?', required: true, choices: PRIZES.map((p) => ({ name: `${p.name} (${p.cost})`, value: p.id })) },
      { type: 3, name: 'note', description: 'What you want (which oddity, which colour…)', required: false, max_length: 200 }
    ]
  },
  {
    name: 'give-tickets', description: 'Ringleaders: hand out (or take back) tickets', type: 1,
    options: [
      { type: 6, name: 'member', description: 'Who?', required: true },
      { type: 4, name: 'amount', description: 'How many (negative takes back)', required: true, min_value: -RULES.awardMax, max_value: RULES.awardMax },
      { type: 3, name: 'reason', description: 'Why (they see this)', required: false, max_length: 120 }
    ]
  }
];

function hex(s) {
  if (!/^[0-9a-f]+$/i.test(s || '') || s.length % 2) return null;
  return Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
}
let keyPromise = null;
let keyFor = null;
async function publicKey(env) {
  if (keyFor !== env.DISCORD_PUBLIC_KEY) {
    keyFor = env.DISCORD_PUBLIC_KEY;
    const raw = hex(env.DISCORD_PUBLIC_KEY);
    keyPromise = raw && raw.length === 32
      ? crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify'])
        .catch(() => crypto.subtle.importKey('raw', raw, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, false, ['verify']))
      : Promise.resolve(null);
  }
  return keyPromise;
}

export async function verifyDiscord(env, signature, timestamp, body, now = Date.now()) {
  const sig = hex(signature);
  if (!sig || sig.length !== 64 || !/^\d{1,12}$/.test(timestamp || '')) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const key = await publicKey(env);
  if (!key) return false;
  try {
    return await crypto.subtle.verify(key.algorithm.name === 'NODE-ED25519' ? { name: 'NODE-ED25519' } : { name: 'Ed25519' }, key, sig, enc.encode(timestamp + body));
  } catch {
    return false;
  }
}

const reply = (content, { ephemeral = true } = {}) =>
  Response.json({ type: 4, data: { content: content.slice(0, 2000), flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } } });
const opt = (data, name) => data?.options?.find((o) => o.name === name)?.value;
const nameOf = (member) => String(member?.nick || member?.user?.global_name || member?.user?.username || 'A member').slice(0, 64);

async function run(env, interaction) {
  const member = interaction.member;
  const uid = member?.user?.id;
  if (interaction.guild_id !== env.DISCORD_GUILD_ID || !uid) return reply('🎪 The ticket booth only opens inside the Belpire server.');
  const name = nameOf(member);
  const manager = (member.roles || []).some((r) => pollConfig(env).managerRoles.includes(r));
  const data = interaction.data;
  const site = 'https://belpire.com/me/';

  switch (data.name) {
    case 'tickets': {
      const s = await summary(env, uid);
      return reply(`🎟️ **${ticketsText(s.balance)}** in your pocket · ${ticketsText(s.lifetime)} won all-time${s.rank ? ` · #${s.rank} on the High Scores` : ''}\n${s.punchedToday ? `Punch card done today (streak ${s.streak}).` : `Your punch card is waiting: \`/punch-card\` for ${ticketsText(s.nextPunch)}.`}\nMore at ${site}`);
    }
    case 'punch-card': {
      const r = await punch(env, uid, name);
      return reply(`🕳️ *Ka-chunk.* Card punched: **+${ticketsText(r.amount)}**${r.streak > 1 ? ` (${r.streak}-day streak!)` : ''}. Balance: ${ticketsText(r.balance)}.`);
    }
    case 'find-the-pea': {
      const pick = Number(opt(data, 'shell')) - 1;
      const r = await playShell(env, uid, name, pick);
      const shells = PEA_SHELLS.map((s, i) => (i === r.pea ? '🟢' : s)).join(' ');
      return reply(`${shells}\n${r.win ? `**Found it!** +${ticketsText(r.amount)}.` : 'Not under that one. The barker grins.'} Balance: ${ticketsText(r.balance)}. ${r.playsLeft ? `${r.playsLeft} ${r.playsLeft === 1 ? 'game' : 'games'} left today.` : 'That\'s all your games for today.'}`);
    }
    case 'checkin': {
      const r = await checkIn(env, uid, name);
      return reply(`🎪 You're checked in to **${r.show}**. ${r.earned ? `+${ticketsText(r.earned)} now, and` : 'You'} earn ${RULES.attendPerCheck} every 10 minutes you're in The Main Stage (up to ${r.cap} a show; ${r.paid} so far).`);
    }
    case 'high-scores': {
      const rows = await highScores(env, uid);
      if (!rows.length) return reply('🏆 The High Scores board is empty. Be the first: `/punch-card`.', { ephemeral: false });
      return reply(`🏆 **Midway High Scores** (tickets won)\n${rows.map((r) => `${r.rank}. ${r.name.replace(/[*_`~|>\\]/g, '')}${r.badge ? ' ✦' : ''}: ${r.lifetime}`).join('\n')}\nFull board: ${site}`, { ephemeral: false });
    }
    case 'prizes':
      return reply(`🎁 **The Prize Booth**\n${PRIZES.map((p) => `• **${p.name}**: ${ticketsText(p.cost)}. ${p.blurb}`).join('\n')}\nRedeem with \`/redeem\` or at ${site}`);
    case 'redeem': {
      const prize = prizeById(opt(data, 'prize'));
      if (prize?.needs === 'game') return reply(`🗳️ Picking a game needs the list, so redeem **${prize.name}** at ${site}`);
      const r = await redeem(env, uid, name, { prize: prize?.id, detail: opt(data, 'note') });
      return reply(`🎁 **${r.order.name}** ordered for ${ticketsText(r.order.cost)}. A Ringleader will sort it out and the Usher will DM you. Balance: ${ticketsText(r.balance)}.`);
    }
    case 'give-tickets': {
      if (!manager) return reply('🎪 Only the Ringleaders can hand out tickets.');
      const r = await award(env, name, opt(data, 'member'), opt(data, 'amount'), opt(data, 'reason'));
      return reply(`🎟️ ${r.amount > 0 ? `Gave **${r.name}** ${ticketsText(r.amount)}` : `Took ${ticketsText(-r.amount)} back from **${r.name}**`}. Their balance: ${ticketsText(r.balance)}.`);
    }
    default:
      return reply('🎪 The Usher doesn\'t know that one.');
  }
}

export async function handleInteraction(request, env) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await request.text();
  if (body.length > 64 * 1024 || !(await verifyDiscord(env, request.headers.get('X-Signature-Ed25519'), request.headers.get('X-Signature-Timestamp'), body))) {
    return new Response('Bad signature', { status: 401 });
  }
  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (interaction.type === 1) return Response.json({ type: 1 }); // PING
  if (interaction.type !== 2) return reply('🎪 Not sure what to do with that.');
  if (!env.DB || !pollConfig(env).ok) return reply('🎪 The ticket booth is being set up. Try again soon.');
  try {
    return await run(env, interaction);
  } catch (err) {
    if (err instanceof TicketError) return reply(`🎪 ${err.message}`);
    console.error(`Interaction error: ${err.stack || err.message}`);
    return reply('🎪 The ticket booth jammed. Try again in a moment.');
  }
}
