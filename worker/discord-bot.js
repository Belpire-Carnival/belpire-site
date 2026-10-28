// Minimal Discord REST client for the Belpire bot: read a member's roles, post a message, create an event,
// and work out what the bot is actually allowed to do (for the Ringleaders' "Check Discord setup").
// The bot token is a runtime secret (DISCORD_BOT_TOKEN) and never leaves the Worker.

const API = 'https://discord.com/api/v10';

export class DiscordError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
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
    if (!res.ok) {
      throw new DiscordError(res.status, `Discord ${method} ${path.replace(/\d{17,20}/g, ':id')} failed: HTTP ${res.status}${data?.code ? ` (code ${data.code})` : ''}`, data?.code ?? null);
    }
    return data;
  }
  throw new DiscordError(429, 'Discord rate limit');
}

// Plain-language reason for a failed Discord call, for Ringleaders on the page.
export function explain(err) {
  const code = err?.code;
  if (err?.status === 401) return 'Discord rejected the bot token. Reset it in the Developer Portal and update DISCORD_BOT_TOKEN.';
  if (code === 10003) return 'Discord says that channel does not exist. Check the channel ID secret.';
  if (code === 10004) return 'Discord says the server ID is wrong. Check DISCORD_GUILD_ID.';
  if (code === 50001) return 'The bot cannot see that channel. Give its role View Channel there.';
  if (code === 50013) return 'The bot is missing a permission there. Use "Check Discord setup" to see which one.';
  if (code === 50035) return 'Discord rejected the event details. Use "Check Discord setup" to confirm The Main Stage channel type.';
  if (err?.status === 429) return 'Discord is rate limiting the bot. Wait a minute and try again.';
  return `Discord answered HTTP ${err?.status ?? '?'}${code ? ` (code ${code})` : ''}.`;
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

// → voice state ({ channel_id, self_stream, … }) or null when the user isn't in a voice channel.
export async function getVoiceState(env, userId, opts) {
  try {
    return await call(env, 'GET', `/guilds/${env.DISCORD_GUILD_ID}/voice-states/${userId}`, null, opts);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

export function addRole(env, userId, roleId, reason, opts) {
  return call(env, 'PUT', `/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, null, opts);
}
export function removeRole(env, userId, roleId, opts) {
  return call(env, 'DELETE', `/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, null, opts);
}
// Every member of the server, 1000 at a time. Needs the Server Members intent switched on for the bot.
export async function listMembers(env, opts, max = 10000) {
  const out = [];
  let after = '0';
  while (out.length < max) {
    const page = await call(env, 'GET', `/guilds/${env.DISCORD_GUILD_ID}/members?limit=1000&after=${after}`, null, opts);
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  return out;
}
// Members whose username or nickname starts with the query (for Ringleaders handing out tickets).
export async function searchMembers(env, query, limit = 10, opts) {
  const q = encodeURIComponent(String(query).slice(0, 32));
  const r = await call(env, 'GET', `/guilds/${env.DISCORD_GUILD_ID}/members/search?query=${q}&limit=${limit}`, null, opts);
  return Array.isArray(r) ? r : [];
}

// A direct message from the bot. Returns false when the person has DMs from server members turned off.
export async function sendDm(env, userId, content, opts) {
  try {
    const ch = await call(env, 'POST', '/users/@me/channels', { recipient_id: userId }, opts);
    await call(env, 'POST', `/channels/${ch.id}/messages`, { content, allowed_mentions: { parse: [] } }, opts);
    return true;
  } catch (err) {
    if (err.code === 50007 || err.status === 403) return false;
    throw err;
  }
}

export function getChannel(env, channelId, opts) {
  return call(env, 'GET', `/channels/${channelId}`, null, opts);
}

export function postMessage(env, channelId, payload, opts) {
  return call(env, 'POST', `/channels/${channelId}/messages`, { allowed_mentions: { parse: [] }, ...payload }, opts);
}

// The bot can always delete its own messages; 404 means it's already gone.
export async function deleteMessage(env, channelId, messageId, opts) {
  try {
    await call(env, 'DELETE', `/channels/${channelId}/messages/${messageId}`, null, opts);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
}

export const CHANNEL_VOICE = 2;
export const CHANNEL_STAGE = 13;

// A scheduled event in The Main Stage, visible under the server's Events. Discord needs entity_type 1
// for a Stage channel and 2 for a regular voice channel, so look the channel up first.
export async function createVoiceEvent(env, { name, description, start }, opts) {
  const channel = await getChannel(env, env.MAIN_STAGE_CHANNEL_ID, opts);
  const entityType = channel?.type === CHANNEL_STAGE ? 1 : 2;
  return call(env, 'POST', `/guilds/${env.DISCORD_GUILD_ID}/scheduled-events`, {
    name,
    description,
    scheduled_start_time: start,
    privacy_level: 2,
    entity_type: entityType,
    channel_id: env.MAIN_STAGE_CHANNEL_ID
  }, opts);
}

export const eventUrl = (env, id) => `https://discord.com/events/${env.DISCORD_GUILD_ID}/${id}`;

// ---------------------------------------------------------------- permissions

export const PERMS = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  CONNECT: 1n << 20n,
  MANAGE_ROLES: 1n << 28n,
  MUTE_MEMBERS: 1n << 22n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_EVENTS: 1n << 33n,
  CREATE_EVENTS: 1n << 44n
};
const ALL = (1n << 64n) - 1n;

// Discord's documented order: server-wide role permissions, then the channel's @everyone overwrite,
// then all role overwrites together, then a member-specific overwrite.
export function channelPermissions({ guildId, roles, memberRoles, memberId, overwrites = [] }) {
  const roleById = new Map(roles.map((r) => [r.id, BigInt(r.permissions)]));
  let perms = roleById.get(guildId) || 0n;
  for (const id of memberRoles) perms |= roleById.get(id) || 0n;
  if (perms & PERMS.ADMINISTRATOR) return ALL;
  const ow = new Map(overwrites.map((o) => [o.id, o]));
  const everyone = ow.get(guildId);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let deny = 0n;
  let allow = 0n;
  for (const id of memberRoles) {
    const o = ow.get(id);
    if (o) {
      deny |= BigInt(o.deny);
      allow |= BigInt(o.allow);
    }
  }
  perms = (perms & ~deny) | allow;
  const mine = ow.get(memberId);
  if (mine) perms = (perms & ~BigInt(mine.deny)) | BigInt(mine.allow);
  return perms;
}

const has = (perms, bit) => (perms & bit) === bit;

// Everything the Big Tent needs from Discord, as a checklist with fixes.
export async function checkSetup(env, opts) {
  const checks = [];
  const add = (ok, label, fix) => checks.push({ ok: Boolean(ok), label, fix: ok ? null : fix });
  let me;
  try {
    me = await call(env, 'GET', '/users/@me', null, opts);
    add(true, 'Bot token works');
  } catch (err) {
    add(false, 'Bot token works', explain(err));
    return checks;
  }
  let member;
  let roles;
  try {
    member = await call(env, 'GET', `/guilds/${env.DISCORD_GUILD_ID}/members/${me.id}`, null, opts);
    roles = await call(env, 'GET', `/guilds/${env.DISCORD_GUILD_ID}/roles`, null, opts);
    add(true, 'Bot is in the Belpire server');
  } catch (err) {
    add(false, 'Bot is in the Belpire server', err.status === 404 ? 'Add the bot to the server with the OAuth2 URL Generator (scope: bot).' : explain(err));
    return checks;
  }
  const permsIn = (channel) =>
    channelPermissions({ guildId: env.DISCORD_GUILD_ID, roles, memberRoles: member.roles || [], memberId: me.id, overwrites: channel?.permission_overwrites || [] });

  let general = null;
  try {
    general = await getChannel(env, env.GENERAL_CHANNEL_ID, opts);
  } catch (err) {
    add(false, '#general channel found', explain(err));
  }
  if (general) {
    const p = permsIn(general);
    add(has(p, PERMS.VIEW_CHANNEL), `Bot can see #${general.name}`, `Allow View Channel for the bot's role in #${general.name}.`);
    add(has(p, PERMS.SEND_MESSAGES), `Bot can post in #${general.name}`, `Allow Send Messages for the bot's role in #${general.name}.`);
    add(has(p, PERMS.EMBED_LINKS), `Bot can post embeds in #${general.name}`, `Allow Embed Links for the bot's role in #${general.name}. Results and announcements are embeds.`);
  }

  let stage = null;
  try {
    stage = await getChannel(env, env.MAIN_STAGE_CHANNEL_ID, opts);
  } catch (err) {
    add(false, 'The Main Stage channel found', explain(err));
  }
  if (stage) {
    const isStage = stage.type === CHANNEL_STAGE;
    const isVoice = stage.type === CHANNEL_VOICE;
    add(isStage || isVoice, `${stage.name} is a voice or Stage channel`, 'MAIN_STAGE_CHANNEL_ID must point at a voice or Stage channel, not a text channel.');
    const p = permsIn(stage);
    add(has(p, PERMS.VIEW_CHANNEL), `Bot can see ${stage.name}`, `Allow View Channel for the bot's role in ${stage.name}.`);
    add(has(p, PERMS.CONNECT), `Bot can connect to ${stage.name}`, `Allow Connect for the bot's role in ${stage.name} (Discord requires it to schedule events there).`);
    add(has(p, PERMS.CREATE_EVENTS) || has(p, PERMS.MANAGE_EVENTS), 'Bot can create events', 'Give the bot\'s role Create Events (Server Settings › Roles), and make sure The Main Stage doesn\'t deny it.');
    if (isStage) {
      add(has(p, PERMS.MANAGE_CHANNELS) && has(p, PERMS.MUTE_MEMBERS) && has(p, PERMS.MOVE_MEMBERS),
        `Bot has Stage permissions in ${stage.name}`,
        `${stage.name} is a Stage channel, so Discord also requires Manage Channels, Mute Members and Move Members for the bot there.`);
    }
  }
  // Game Night passes: the bot hands out the role, so it needs Manage Roles and must sit above both roles.
  if (env.GAME_NIGHT_ROLE_ID) {
    const base = channelPermissions({ guildId: env.DISCORD_GUILD_ID, roles, memberRoles: member.roles || [], memberId: me.id, overwrites: [] });
    add(has(base, PERMS.MANAGE_ROLES), 'Bot can manage roles', 'Give the bot\'s role Manage Roles (Server Settings › Roles).');
    const pos = new Map(roles.map((r) => [r.id, r.position]));
    const top = Math.max(0, ...(member.roles || []).map((r) => pos.get(r) ?? 0));
    for (const [id, label] of [[env.GAME_NIGHT_ROLE_ID, 'Game Night'], [env.GAME_NIGHT_PENDING_ROLE_ID, 'Game Night (Pending)']]) {
      if (!id) continue;
      if (!pos.has(id)) add(false, `${label} role found`, `GAME_NIGHT${label.includes('Pending') ? '_PENDING' : ''}_ROLE_ID doesn't match a role in the server.`);
      else add(top > pos.get(id), `Bot's role is above ${label}`, `Drag the bot's role above ${label} in Server Settings › Roles. Discord only lets a bot hand out roles below its own.`);
    }
    if (env.GAME_NIGHT_PENDING_ROLE_ID) {
      try {
        await call(env, 'GET', `/guilds/${env.DISCORD_GUILD_ID}/members?limit=1`, null, opts);
        add(true, 'Bot can see the member list (for onboarding answers)');
      } catch {
        add(false, 'Bot can see the member list (for onboarding answers)', 'In the Developer Portal › Bot, turn on Server Members Intent so people who answer Yes in onboarding reach the queue.');
      }
    }
  }
  return checks;
}
