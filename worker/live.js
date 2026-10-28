// "Live on The Main Stage" banner: shows when a Ringleader is in The Main Stage voice channel and using Go Live.
// Discord has no REST call that lists a voice channel, so the bot checks the voice state of each user in the
// RINGLEADER_IDS runtime secret. The answer is cached for 30 seconds, so Discord is asked at most twice a minute
// however many people have the page open.

import { getVoiceState, getMember } from './discord-bot.js';
import { pollStore } from './poll-db.js';

const SNOWFLAKE = /^\d{17,20}$/;
const CACHE_KEY = 'live:v1';
export const LIVE_TTL_MS = 30_000;
let memo = null; // per-isolate copy, saves a KV read

export const liveIds = (env) =>
  String(env.RINGLEADER_IDS || '').split(',').map((s) => s.trim()).filter((s) => SNOWFLAKE.test(s)).slice(0, 10);

const displayName = (m) => String(m?.nick || m?.user?.global_name || m?.user?.username || 'A Ringleader').slice(0, 64);

export async function liveStatus(env, now = Date.now()) {
  if (memo && now - memo.at < LIVE_TTL_MS) return memo.value;
  const cached = await env.SC_DATA?.get(CACHE_KEY, 'json').catch(() => null);
  if (cached && now - cached.at < LIVE_TTL_MS) {
    memo = cached;
    return cached.value;
  }
  const stage = env.MAIN_STAGE_CHANNEL_ID;
  const streamers = [];
  const onStage = [];
  if (SNOWFLAKE.test(String(stage || '')) && env.DISCORD_BOT_TOKEN) {
    for (const id of liveIds(env)) {
      try {
        const vs = await getVoiceState(env, id);
        if (!vs || vs.channel_id !== stage) continue;
        const name = displayName(vs.member || (await getMember(env, id)));
        (vs.self_stream ? streamers : onStage).push(name);
      } catch (err) {
        console.warn(`Voice state lookup failed: ${err.message}`);
      }
    }
  }
  let event = null;
  if (streamers.length && env.DB) {
    const night = await pollStore(env.DB).tonight(now).catch(() => null);
    if (night) event = { title: night.title, start: night.event_start };
  }
  const value = {
    live: streamers.length > 0,
    streamers,
    onStage: streamers.length ? onStage : [],
    event,
    stage: 'The Main Stage',
    joinUrl: streamers.length ? `https://discord.com/channels/${env.DISCORD_GUILD_ID}/${stage}` : null
  };
  memo = { at: now, value };
  if (env.SC_DATA) await env.SC_DATA.put(CACHE_KEY, JSON.stringify(memo), { expirationTtl: 120 }).catch(() => {});
  return value;
}

export function _clearLiveCache() {
  memo = null;
}
