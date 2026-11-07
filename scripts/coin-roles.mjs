// Makes the 15 Sliver coin roles in the Belpire server (one per tier in worker/coins.js), each with its
// coin as the role icon, and prints the COIN_ROLE_IDS value for the Worker. Safe to run again: roles are
// matched by name and updated, never duplicated, and nobody's roles are changed here (the Worker's cron
// hands them out).
//   npm run coin-roles            show the plan
//   npm run coin-roles -- --apply  make or update the roles
// Reads DISCORD_BOT_TOKEN and DISCORD_GUILD_ID from the environment or the git-ignored .env.
// Role icons need the server to have the Role Icons feature (Boost Level 2); without it the roles are
// made with colours only, and running this again later adds the icons.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COINS } from '../worker/coins.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');

async function setting(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const env = await readFile(resolve(ROOT, '.env'), 'utf8');
    const m = env.match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?\\s*$`, 'm'));
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// Each tier's role colour follows its coin: rust and grime, through bronze and brass, to gold and ruby.
const COLORS = ['5A3A2E', '4A3B30', '6B5440', '4E4A3C', '4F7A63', '5E5546', '8C7448', '9A7E4E', 'B08D57', 'C29A55', 'D4AA55', 'D9B66A', 'E3C06A', 'F0CF6E', 'C0182B'];

const token = await setting('DISCORD_BOT_TOKEN');
const guild = await setting('DISCORD_GUILD_ID');
if (!token || !/^\d{17,20}$/.test(guild || '')) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in your environment or in .env (never commit it).');
  process.exit(1);
}

async function api(method, path, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': 'Sliver coin roles' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (res.status === 429) { const info = await res.json().catch(() => ({})); await new Promise((r) => setTimeout(r, Math.ceil((info.retry_after ?? 1) * 1000) + 250)); continue; }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`Discord said HTTP ${res.status}: ${data?.message || text}`);
    return data;
  }
  throw new Error('Still rate limited');
}

const [server, roles] = await Promise.all([api('GET', `/guilds/${guild}`), api('GET', `/guilds/${guild}/roles`)]);
const icons = (server.features || []).includes('ROLE_ICONS');
console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (add -- --apply to make the roles)'} · ${server.name} · role icons ${icons ? 'available' : 'NOT available (needs Boost Level 2): colours only for now'}\n`);

const ids = [];
for (const [i, coin] of COINS.entries()) {
  const hit = roles.find((r) => !r.managed && r.name === coin.name);
  const want = { name: coin.name, color: parseInt(COLORS[i], 16), hoist: false, mentionable: false, permissions: '0' };
  if (icons) want.icon = `data:image/png;base64,${(await readFile(resolve(ROOT, 'scripts/coin-role-icons', `${coin.slug}.png`))).toString('base64')}`;
  if (!hit) {
    console.log(`  + create  Tier ${String(i + 1).padStart(2)} · ${coin.name}`);
    if (APPLY) ids.push((await api('POST', `/guilds/${guild}/roles`, want)).id);
  } else {
    console.log(`  ~ update  Tier ${String(i + 1).padStart(2)} · ${coin.name}${icons ? ' (icon)' : ''}`);
    if (APPLY) await api('PATCH', `/guilds/${guild}/roles/${hit.id}`, want);
    ids.push(hit.id);
  }
}

if (!APPLY) process.exit(0);
console.log(`\nDone. Give the Worker the role IDs (paste this line when asked):\n\n  npx wrangler secret put COIN_ROLE_IDS\n  ${ids.join(',')}\n`);
console.log('Keep the Usher\'s role above all 15 coin roles (Server Settings → Roles) so it can hand them out.');
