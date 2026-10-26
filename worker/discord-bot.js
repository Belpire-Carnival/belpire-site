// Minimal Discord REST client for the Belpire bot: read a member's roles, post a message, create an event.
// The bot token is a runtime secret (DISCORD_BOT_TOKEN) and never leaves the Worker.

const API = 'https://discord.com/api/v10';

export class DiscordError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(env, method, path, body, { fetchImpl = fetch } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://belpire.com, 1.0)'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Number((await res.json().catch(() => ({}))).retry_after) || 1;
      await new Promise((r) => setTimeout(r, Math.min(5, wait) * 1000));
      continue;
    }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new DiscordError(res.status, `Discord ${method} ${path.replace(/\d{17,20}/g, ':id')} failed: HTTP ${res.status}${data?.code ? ` (code ${data.code})` : ''}`);
    return data;
  }
  throw new DiscordError(429, 'Discord rate limit');
}

// → member object, or null when the user isn't in the server.
export async function getMember(env, userId, opts) {
  try {
    return await call(env, 'GET', `/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, null, opts);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export function postMessage(env, channelId, payload, opts) {
  return call(env, 'POST', `/channels/${channelId}/messages`, { allowed_mentions: { parse: [] }, ...payload }, opts);
}

// A scheduled event in a voice channel (entity_type 2), visible under the server's Events.
export function createVoiceEvent(env, { name, description, start }, opts) {
  return call(env, 'POST', `/guilds/${env.DISCORD_GUILD_ID}/scheduled-events`, {
    name,
    description,
    scheduled_start_time: start,
    privacy_level: 2,
    entity_type: 2,
    channel_id: env.MAIN_STAGE_CHANNEL_ID
  }, opts);
}

export const eventUrl = (env, id) => `https://discord.com/events/${env.DISCORD_GUILD_ID}/${id}`;
