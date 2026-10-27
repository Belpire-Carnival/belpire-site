// "Your Ringleaders" on the home page: the RingMaster, RingMistress and Carnival Guard as they appear
// in the Belpire server (server nickname or display name, and avatar). The bot reads each one by user ID
// from the RINGLEADER_IDS runtime secret (comma-separated, in card order). Nothing about visitors is involved.
//
// Avatars are proxied through /api/ringleaders/avatar/:slot so visitors' browsers never contact Discord.

import { getMember } from './discord-bot.js';

export const ROLES = ['RingMaster', 'RingMistress', 'Carnival Guard'];
const CACHE_KEY = 'ringleaders:v1';
const CACHE_TTL = 6 * 60 * 60; // seconds
const CDN = 'https://cdn.discordapp.com';
const SNOWFLAKE = /^\d{17,20}$/;

// Only ever fetch avatars over https from Discord's CDN host itself.
export function isDiscordCdn(src) {
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && u.host === 'cdn.discordapp.com';
  } catch {
    return false;
  }
}

export function ringleaderIds(env) {
  return String(env.RINGLEADER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .slice(0, ROLES.length);
}

// Discord member → what the page shows. Avatar order: server avatar, then account avatar, then default.
export function profileFrom(member, guildId, slot) {
  const u = member?.user || {};
  const name = (member?.nick || u.global_name || u.username || ROLES[slot]).slice(0, 40);
  let src;
  if (member?.avatar) src = `${CDN}/guilds/${guildId}/users/${u.id}/avatars/${member.avatar}`;
  else if (u.avatar) src = `${CDN}/avatars/${u.id}/${u.avatar}`;
  const hash = member?.avatar || u.avatar || null;
  const animated = Boolean(hash && hash.startsWith('a_'));
  const avatarSrc = src
    ? `${src}.${animated ? 'gif' : 'png'}?size=256`
    : `${CDN}/embed/avatars/${Number((BigInt(u.id || 0) >> 22n) % 6n)}.png`;
  return { role: ROLES[slot], name, id: u.id, avatarSrc, version: hash || 'default' };
}

async function load(env, ctx) {
  const cached = await env.SC_DATA?.get(CACHE_KEY, 'json').catch(() => null);
  if (cached) return cached;
  const ids = ringleaderIds(env);
  const leaders = [];
  for (let slot = 0; slot < ids.length; slot++) {
    if (!SNOWFLAKE.test(ids[slot])) continue;
    try {
      const member = await getMember(env, ids[slot]);
      if (member) leaders.push({ slot, ...profileFrom(member, env.DISCORD_GUILD_ID, slot) });
    } catch (err) {
      console.warn(`Ringleader ${slot} lookup failed: ${err.message}`);
    }
  }
  if (leaders.length && env.SC_DATA) {
    const put = env.SC_DATA.put(CACHE_KEY, JSON.stringify(leaders), { expirationTtl: CACHE_TTL });
    ctx?.waitUntil ? ctx.waitUntil(put) : await put;
  }
  return leaders;
}

// Public shape: no CDN URLs, no internal fields beyond the public profile link.
export function publicView(leaders) {
  return leaders.map((l) => ({
    slot: l.slot,
    role: l.role,
    name: l.name,
    profile: `https://discord.com/users/${l.id}`,
    avatar: `/api/ringleaders/avatar/${l.slot}?v=${encodeURIComponent(l.version)}`
  }));
}

export async function handleRingleaders(request, env, ctx, json) {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/ringleaders') {
    const leaders = await load(env, ctx);
    return json({ leaders: publicView(leaders) }, 200, { 'Cache-Control': 'public, max-age=600' });
  }
  const m = pathname.match(/^\/api\/ringleaders\/avatar\/(\d)$/);
  if (!m) return json({ error: 'not found' }, 404);
  const leader = (await load(env, ctx)).find((l) => l.slot === Number(m[1]));
  if (!leader || !isDiscordCdn(leader.avatarSrc)) return json({ error: 'not found' }, 404);
  const res = await fetch(leader.avatarSrc, { cf: { cacheTtl: 86400, cacheEverything: true } });
  const type = res.headers.get('Content-Type') || '';
  if (!res.ok || !/^image\/(png|gif|webp|jpeg)$/.test(type)) return json({ error: 'avatar unavailable' }, 502);
  return new Response(res.body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'"
    }
  });
}
