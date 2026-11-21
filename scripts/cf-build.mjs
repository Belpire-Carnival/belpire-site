#!/usr/bin/env node
// Build step: loads the live feed.json (so already-posted items aren't repeated),
// then refreshes it from Steam. Discord posts only happen on production builds.

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEED_PATH = resolve(ROOT, 'site/data/feed.json');
const SITE_URL = (process.env.SITE_URL || 'https://belpire.com').replace(/\/+$/, '');
const branch = process.env.WORKERS_CI_BRANCH || process.env.CF_PAGES_BRANCH || 'local';
const isProduction = branch === (process.env.PRODUCTION_BRANCH || 'main');

console.log(`Belpire build — branch: ${branch} (${isProduction ? 'production' : 'preview'})`);

await mkdir(dirname(FEED_PATH), { recursive: true });
try {
  const res = await fetch(`${SITE_URL}/data/feed.json`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.upcoming) || !Array.isArray(data.favorites)) throw new Error('unexpected shape');
  await writeFile(FEED_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Loaded live feed from ${SITE_URL}`);
} catch (err) {
  await rm(FEED_PATH, { force: true });
  console.log(`No live feed (${err.message}); starting fresh. Discord posts are skipped on a fresh start.`);
}

const env = { ...process.env };
if (!isProduction) delete env.DISCORD_WEBHOOK_URL;

const result = spawnSync(process.execPath, [resolve(ROOT, 'scripts/update-feed.mjs')], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
