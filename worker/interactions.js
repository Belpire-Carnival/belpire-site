// The Belpire Usher's slash commands. Discord sends each command to POST /api/discord/interactions (the
// app's Interactions Endpoint URL); we check Discord's signature and answer straight away. No always-on
// connection needed. Tickets use the same bank as belpire.com, so both always agree.
//
// Buttons and forms for alpha tester sign-ups are handled in alpha.js.
// Commands are registered once with `npm run commands` (scripts/register-commands.mjs).
// Runtime secret: DISCORD_PUBLIC_KEY (the app's public key, used to verify each request).

import { pollConfig, sendOpenPost } from './polls.js';
import { handleAlpha, isAlphaInteraction } from './alpha.js';
import { pollStore } from './poll-db.js';
import { PRIZES, prizeById } from './prizes.js';
import { punch, playShell, playRings, swingStriker, checkIn, redeem, award, awardEveryone, summary, highScores, concession, ticketsText, RULES, TicketError } from './tickets.js';

const EPHEMERAL = 64;
const enc = new TextEncoder();
const PEA_SHELLS = ['🥫', '🥫', '🥫'];

export const COMMANDS = [
  { name: 'slivers', description: 'Your Slivers: balance, streak and rank', type: 1 },
  { name: 'punch-card', description: 'Punch your daily card for free Slivers (streaks pay more)', type: 1 },
  {
    name: 'find-the-pea', description: 'The shell game: pick a shell and win Slivers if the pea is under it', type: 1,
    options: [{ type: 4, name: 'shell', description: 'Which shell?', required: true, choices: [{ name: 'Left', value: 1 }, { name: 'Middle', value: 2 }, { name: 'Right', value: 3 }] }]
  },
  {
    name: 'ring-toss', description: 'Toss a ring at the bottles: near rows are easier, far rows pay more', type: 1,
    options: [{ type: 3, name: 'row', description: 'Which row?', required: true, choices: [
      { name: `Front (${RULES.ringRows.front.odds / 10}% · ${RULES.ringRows.front.prize} Slivers)`, value: 'front' },
      { name: `Middle (${RULES.ringRows.middle.odds / 10}% · ${RULES.ringRows.middle.prize} Slivers)`, value: 'middle' },
      { name: `Back (${RULES.ringRows.back.odds / 10}% · ${RULES.ringRows.back.prize} Slivers)`, value: 'back' }
    ] }]
  },
  { name: 'high-striker', description: 'Swing the mallet. Ring the bell for the jackpot', type: 1 },
  {
    name: 'concession', description: 'The Concession Tent: spend Slivers on a snack', type: 1,
    options: [
      { type: 3, name: 'snack', description: 'What are you having?', required: true, choices: Object.entries(RULES.snacks).map(([value, x]) => ({ name: `${x.name} (${x.cost} Slivers)`, value })) },
      { type: 5, name: 'leave-it', description: 'Leave it on the counter instead of eating it', required: false }
    ]
  },
  { name: 'checkin', description: 'Check in to tonight\'s show from The Main Stage to earn attendance Slivers', type: 1 },
  { name: 'high-scores', description: 'The Midway High Scores: most Slivers won', type: 1 },
  { name: 'prizes', description: 'What\'s in the Prize Booth', type: 1 },
  {
    name: 'redeem', description: 'Spend Slivers at the Prize Booth', type: 1,
    options: [
      { type: 3, name: 'prize', description: 'Which prize?', required: true, choices: PRIZES.map((p) => ({ name: `${p.name} (${p.cost})`, value: p.id })) },
      { type: 3, name: 'note', description: 'What you want (which oddity, which colour…)', required: false, max_length: 200 }
    ]
  },
  { name: 'poll', description: 'Ringleaders: post the open game-night poll to #general again', type: 1 },
  {
    name: 'give-everyone', description: 'Ringleaders: give every member of the server some Slivers', type: 1,
    options: [
      { type: 4, name: 'amount', description: 'How many each', required: true, min_value: 1, max_value: RULES.awardMax },
      { type: 3, name: 'reason', description: 'Why (everyone sees this in their Sliver ledger)', required: true, max_length: 120 }
    ]
  },
  {
    name: 'give-slivers', description: 'Ringleaders: hand out (or take back) Slivers', type: 1,
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
// The same reply with the member's Sliver coin as a small picture beside it.
const replyCoin = (coin, content) =>
  Response.json({ type: 4, data: { content: content.slice(0, 2000), flags: EPHEMERAL, allowed_mentions: { parse: [] }, embeds: [{ color: 0xd9b26a, thumbnail: { url: `https://belpire.com${coin.image}` }, description: `${coin.name} · tier ${coin.tier} of 15` }] } });
const opt = (data, name) => data?.options?.find((o) => o.name === name)?.value;
const nameOf = (member) => String(member?.nick || member?.user?.global_name || member?.user?.username || 'A member').slice(0, 64);

async function run(env, interaction, ctx) {
  const member = interaction.member;
  const uid = member?.user?.id;
  if (interaction.guild_id !== env.DISCORD_GUILD_ID || !uid) return reply('🎪 The ticket booth only opens inside the Belpire server.');
  const name = nameOf(member);
  const manager = (member.roles || []).some((r) => pollConfig(env).managerRoles.includes(r));
  const data = interaction.data;
  const site = 'https://belpire.com/me/';

  switch (data.name) {
    case 'slivers': {
      const s = await summary(env, uid);
      return replyCoin(s.coin, `🪙 **${s.coin.name}** coin${s.coin.next ? ` · win ${s.coin.next.need.toLocaleString()} more to reach ${s.coin.next.name}` : ''}\n🎟️ **${ticketsText(s.balance)}** in your pocket · ${ticketsText(s.lifetime)} won all-time${s.rank ? ` · #${s.rank} on the High Scores` : ''}\n${s.punchedToday ? `Punch card done today (streak ${s.streak}).` : `Your punch card is waiting: \`/punch-card\` for ${ticketsText(s.nextPunch)}.`}\nMore at ${site}`);
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
    case 'ring-toss': {
      const r = await playRings(env, uid, name, String(opt(data, 'row') || ''));
      const left = r.playsLeft ? `${r.playsLeft} ${r.playsLeft === 1 ? 'ring' : 'rings'} left today.` : 'That\'s all your rings for today.';
      return reply(`⭕ You toss at the **${r.row}** row… ${r.win ? `*clink!* **Ringer!** +${ticketsText(r.amount)}.` : 'it bounces off the bottle necks.'} Balance: ${ticketsText(r.balance)}. ${left}`);
    }
    case 'high-striker': {
      const r = await swingStriker(env, uid, name);
      const meter = `${'▰'.repeat(r.height)}${'▱'.repeat(10 - r.height)}`;
      const left = r.playsLeft ? `${r.playsLeft} ${r.playsLeft === 1 ? 'swing' : 'swings'} left today.` : 'That\'s all your swings for today.';
      return reply(`🔨 *WHAM!* ${meter} ${r.bell ? '🔔 **DING DING DING!**' : `**${r.label}**`}${r.amount ? ` +${ticketsText(r.amount)}.` : '.'} Balance: ${ticketsText(r.balance)}. ${left}`);
    }
    case 'checkin': {
      const r = await checkIn(env, uid, name);
      return reply(`🎪 You're checked in to **${r.show}**. ${r.earned ? `+${ticketsText(r.earned)} now, and` : 'You'} earn ${RULES.attendPerCheck} every 10 minutes you're in The Main Stage (up to ${r.cap} a show; ${r.paid} so far).`);
    }
    case 'high-scores': {
      const rows = await highScores(env, uid);
      if (!rows.length) return reply('🏆 The High Scores board is empty. Be the first: `/punch-card`.', { ephemeral: false });
      return reply(`🏆 **Midway High Scores** (Slivers won)\n${rows.map((r) => `${r.rank}. ${r.name.replace(/[*_`~|>\\]/g, '')}${r.badge ? ' ✦' : ''}: ${r.lifetime}`).join('\n')}\nFull board: ${site}`, { ephemeral: false });
    }
    case 'concession': {
      const r = await concession(env, uid, name, opt(data, 'snack'), Boolean(opt(data, 'leave-it')));
      const tail = ` −${ticketsText(r.cost)}. Balance: ${ticketsText(r.balance)}.`;
      if (r.eaten) return reply(`🌙 You leave the ${r.snack.toLowerCase()} on the counter and step out. When you come back, the counter is bare. Something ate it.${tail}`, { ephemeral: false });
      if (r.left) return reply(`🍽️ You leave the ${r.snack.toLowerCase()} on the counter. It's still there. For now.${tail}`);
      const curds = r.curdsAllTime ? ` That's order **#${r.curdsAllTime}** of curds.` : '';
      return reply(`${r.icon} ${r.line}${curds}${tail}`);
    }
    case 'prizes':
      return reply(`🎁 **The Prize Booth**\n${PRIZES.map((p) => `• **${p.name}**: ${ticketsText(p.cost)}. ${p.blurb}`).join('\n')}\nRedeem with \`/redeem\` or at ${site}`);
    case 'redeem': {
      const prize = prizeById(opt(data, 'prize'));
      if (prize?.needs === 'game') return reply(`🗳️ Picking a game needs the list, so redeem **${prize.name}** at ${site}`);
      const r = await redeem(env, uid, name, { prize: prize?.id, detail: opt(data, 'note') });
      return reply(`🎁 **${r.order.name}** ordered for ${ticketsText(r.order.cost)}. A Ringleader will sort it out and the Usher will DM you. Balance: ${ticketsText(r.balance)}.`);
    }
    case 'poll': {
      if (!manager) return reply('🎪 Only the Ringleaders can send out the poll. You can vote at https://belpire.com/big-tent/');
      const open = (await pollStore(env.DB).active()).filter((p) => p.status === 'open');
      if (!open.length) return reply('🗳️ No poll is open right now. Start one in Backstage at https://belpire.com/backstage/');
      const lines = [];
      for (const p of open) {
        const r = await sendOpenPost(env, p, { reminder: Boolean(p.open_posted_at) });
        lines.push(r.posted ? `✅ **${p.title}** posted to #general.` : `⏳ **${p.title}**: ${r.reason}`);
      }
      return reply(`🗳️ ${lines.join('\n')}`);
    }
    case 'give-everyone': {
      if (!manager) return reply('🎪 Only the Ringleaders can hand out Slivers.');
      const amount = Number(opt(data, 'amount'));
      if (!Number.isInteger(amount) || amount < 1 || amount > RULES.awardMax) return reply(`🎪 Give everyone between 1 and ${RULES.awardMax} Slivers.`);
      if (!ctx?.waitUntil) return reply('🎪 The Usher can\'t do that right now. Try again in a moment.');
      // Paying everyone takes longer than Discord waits for an answer, so say "thinking…" now and finish after.
      ctx.waitUntil((async () => {
        let line;
        try {
          const r = await awardEveryone(env, name, amount, opt(data, 'reason'), interaction.id);
          line = `🎟️ Gave **${r.given.toLocaleString()}** members ${ticketsText(r.amount)} each.${r.already ? ` (${r.already} already had this gift.)` : ''} Their coins and coin roles catch up within 10 minutes.`;
        } catch (err) {
          console.error(`give-everyone failed: ${err.stack || err.message}`);
          line = `🎪 That didn't finish: ${err instanceof TicketError ? err.message : 'the ticket booth jammed'}. Running it again is safe for anyone already paid.`;
        }
        await fetch(`https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: line, allowed_mentions: { parse: [] } })
        }).catch(() => {});
      })());
      return Response.json({ type: 5, data: { flags: EPHEMERAL } });
    }
    case 'give-slivers': {
      if (!manager) return reply('🎪 Only the Ringleaders can hand out Slivers.');
      const r = await award(env, name, opt(data, 'member'), opt(data, 'amount'), opt(data, 'reason'));
      return reply(`🎟️ ${r.amount > 0 ? `Gave **${r.name}** ${ticketsText(r.amount)}` : `Took ${ticketsText(-r.amount)} back from **${r.name}**`}. Their balance: ${ticketsText(r.balance)}.`);
    }
    default:
      return reply('🎪 The Usher doesn\'t know that one.');
  }
}

export async function handleInteraction(request, env, ctx) {
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
  // Buttons (3) and forms (5) for alpha tester sign-ups. Approvals arrive from a DM, outside the server.
  if ((interaction.type === 3 || interaction.type === 5) && isAlphaInteraction(interaction)) {
    try {
      return await handleAlpha(env, interaction);
    } catch (err) {
      console.error(`Alpha sign-up error: ${err.stack || err.message}`);
      return reply('🎡 The sign-up desk jammed. Try again in a moment.');
    }
  }
  if (interaction.type !== 2) return reply('🎪 Not sure what to do with that.');
  if (!env.DB || !pollConfig(env).ok) return reply('🎪 The ticket booth is being set up. Try again soon.');
  try {
    return await run(env, interaction, ctx);
  } catch (err) {
    if (err instanceof TicketError) return reply(`🎪 ${err.message}`);
    console.error(`Interaction error: ${err.stack || err.message}`);
    return reply('🎪 The ticket booth jammed. Try again in a moment.');
  }
}
