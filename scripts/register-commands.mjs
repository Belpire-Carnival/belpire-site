// Registers the Belpire Usher's slash commands in the Belpire server. Run once, and again after changing
// worker/interactions.js or worker/prizes.js:   npm run commands
// Reads DISCORD_APP_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID from the environment or the git-ignored .env.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../worker/interactions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

const app = await setting('DISCORD_APP_ID');
const token = await setting('DISCORD_BOT_TOKEN');
const guild = await setting('DISCORD_GUILD_ID');
if (!/^\d{17,20}$/.test(app || '') || !/^\d{17,20}$/.test(guild || '') || !token) {
  console.error('Set DISCORD_APP_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in your environment or in .env (never commit it).');
  process.exit(1);
}
const res = await fetch(`https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(COMMANDS)
});
const out = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`Discord said HTTP ${res.status}:`, JSON.stringify(out));
  process.exit(1);
}
console.log(`Registered ${out.length} commands: ${out.map((c) => '/' + c.name).join(', ')}`);
