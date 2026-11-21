#!/usr/bin/env node
// Crew overlap: which games does the crew share, and what upcoming games match how we play?
//
// Runs on your own PC, never in CI or on the site. Reads:
//   - crew.local.json   (git-ignored) the crew's Steam profile links, see crew.example.json
//   - STEAM_API_KEY     from the environment or a git-ignored .env file
// Writes crew-report.md (git-ignored) with:
//   1. Multiplayer games owned by at least `minOwners` crew members, ranked by crew playtime,
//      with a suggested tent and whether config/games.json already tracks them.
//   2. Suggested "Sideshow" upcoming searches built from the crew's most-played tags,
//      leaving out horror and party (those tents have their own searches).
// Nothing here edits config/games.json; you pick what to add in a PR.
// Each member needs Steam › Privacy Settings › Game details set to Public.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'BelpireCarnivalCrew/1.0 (+https://belpire.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Steam store categories that mean "we can play this together".
const MULTIPLAYER_CATEGORIES = new Set([1, 9, 20, 27, 36, 37, 38, 39, 47, 48, 49]);
const HORROR_TAGS = new Set(['horror', 'psychological horror', 'survival horror', 'lovecraftian', 'gore', 'zombies', 'supernatural', 'thriller']);
const PARTY_TAGS = new Set(['party game', 'party', 'social deduction', 'trivia', 'local multiplayer', 'mini golf']);
// Tags too broad to steer a search.
const GENERIC_TAGS = new Set([
  'multiplayer', 'singleplayer', 'online co-op', 'co-op', 'pvp', 'online pvp', 'action', 'adventure', 'indie', 'casual',
  'free to play', 'early access', 'great soundtrack', 'atmospheric', 'funny', 'difficult', 'first-person', 'third person',
  '3d', '2d', 'realistic', 'stylized', 'colorful', 'cute', 'family friendly', 'controller', 'massively multiplayer', 'simulation',
  'strategy', 'rpg', 'shooter', 'mature', 'violent', 'sexual content', 'nudity', 'masterpiece', 'classic', 'replay value'
]);

// ---------------------------------------------------------------- pure helpers (tested)

// Accepts a profile URL, /id/<vanity>, /profiles/<id64>, a bare id64 or a bare vanity name.
export function parseProfile(input) {
  const s = String(input || '').trim();
  let m = s.match(/steamcommunity\.com\/profiles\/(\d{17})/i) || s.match(/^(\d{17})$/);
  if (m) return { steamid: m[1] };
  m = s.match(/steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})/i) || s.match(/^([A-Za-z0-9_-]{2,32})$/);
  if (m) return { vanity: m[1] };
  return null;
}

export function dedupeMembers(members) {
  const seen = new Set();
  const out = [];
  const dupes = [];
  for (const m of members) {
    const key = m.steamid || `vanity:${String(m.vanity).toLowerCase()}`;
    if (seen.has(key)) dupes.push(m);
    else {
      seen.add(key);
      out.push(m);
    }
  }
  return { members: out, dupes };
}

// libraries: [{ name, games: [{ appid, name, playtime_forever (minutes) }] }]
export function overlap(libraries, minOwners) {
  const byApp = new Map();
  for (const lib of libraries) {
    for (const g of lib.games || []) {
      const appid = Number(g.appid);
      if (!appid) continue;
      if (!byApp.has(appid)) byApp.set(appid, { appid, name: g.name || `App ${appid}`, owners: [], minutes: 0, players: 0 });
      const row = byApp.get(appid);
      row.owners.push(lib.name);
      row.minutes += Number(g.playtime_forever) || 0;
      if ((Number(g.playtime_forever) || 0) >= 60) row.players += 1; // played at least an hour
    }
  }
  return [...byApp.values()]
    .filter((r) => r.owners.length >= minOwners)
    .sort((a, b) => b.owners.length - a.owners.length || b.players - a.players || b.minutes - a.minutes);
}

export function isMultiplayer(details) {
  return (details?.categories || []).some((c) => MULTIPLAYER_CATEGORIES.has(Number(c.id)));
}

export function suggestTent(tags) {
  const t = (tags || []).map((x) => String(x).toLowerCase());
  if (t.some((x) => HORROR_TAGS.has(x))) return 'horror';
  if (t.some((x) => PARTY_TAGS.has(x))) return 'party';
  return 'other';
}

// Decode the few HTML entities Steam uses in tag names, in a single pass so "&amp;#39;" stays "&#39;".
const ENTITIES = { amp: '&', quot: '"', lt: '<', gt: '>', '#39': "'", apos: "'" };
export const decodeEntities = (s) => String(s).replace(/&(amp|quot|lt|gt|#39|apos);/g, (_, e) => ENTITIES[e]);

// User tags from a store page, in Steam's order (most voted first).
export function parseStoreTags(html) {
  const tags = [];
  const re = /<a[^>]*class="app_tag"[^>]*>\s*([^<]+?)\s*<\/a>/g;
  let m;
  while ((m = re.exec(String(html))) && tags.length < 15) {
    const tag = decodeEntities(m[1]).trim();
    if (tag && tag !== '+') tags.push(tag);
  }
  return tags;
}

// Weight each tag by how much the crew plays the games that carry it; skip horror, party and generic tags.
export function sideshowTags(rows, limit = 6) {
  const score = new Map();
  for (const r of rows) {
    if (!r.multiplayer) continue;
    const weight = Math.max(1, r.minutes / 60) * r.owners.length;
    (r.tags || []).slice(0, 8).forEach((tag, i) => {
      const k = tag.toLowerCase();
      if (HORROR_TAGS.has(k) || PARTY_TAGS.has(k) || GENERIC_TAGS.has(k)) return;
      score.set(tag, (score.get(tag) || 0) + weight * (1 - i * 0.08));
    });
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag);
}

export function searchesFor(tags) {
  return tags.map((tag) => ({ tent: 'other', tags: ['Online Co-Op', tag] }));
}

export function redact(text, key) {
  return key ? String(text).split(key).join('***') : String(text);
}

const hours = (min) => Math.round(min / 60).toLocaleString('en-US');
// Markdown table cells: escape backslashes first, then pipes, and keep everything on one line.
export const escapeMd = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function renderReport({ crew, skipped, dupes, rows, tracked, tags, minOwners, generated }) {
  const lines = [];
  lines.push('# Crew overlap report', '');
  lines.push(`Generated ${generated}. Private: this file is git-ignored; don't commit it.`, '');
  lines.push(`**Crew read:** ${crew.map((c) => `${c.name} (${c.count} games)`).join(', ') || 'nobody'}`);
  if (skipped.length) lines.push(`**Skipped (library private or unreachable):** ${skipped.join(', ')}. Ask them to set Steam › Privacy Settings › Game details to Public.`);
  if (dupes.length) lines.push(`**Duplicate entries ignored:** ${dupes.length}`);
  lines.push(`**"In common" means:** owned by at least ${minOwners} of ${crew.length}.`, '');

  const fresh = rows.filter((r) => r.multiplayer && !tracked.has(r.appid));
  lines.push('## Shared multiplayer games not tracked yet', '');
  if (!fresh.length) lines.push('Nothing new: every shared multiplayer game is already tracked.', '');
  else {
    lines.push('| Game | Owned by | Played (1h+) | Crew hours | Suggested tent | Top tags |', '|---|---|---|---|---|---|');
    for (const r of fresh) lines.push(`| ${escapeMd(r.name)} | ${r.owners.length} | ${r.players} | ${hours(r.minutes)} | ${r.tent} | ${escapeMd((r.tags || []).slice(0, 4).join(', '))} |`);
    lines.push('', 'To track one, add it to `favorites` in `config/games.json`:', '', '```json');
    for (const r of fresh.slice(0, 15)) lines.push(`{ "appid": ${r.appid}, "name": ${JSON.stringify(r.name)}, "tent": "${r.tent}" },`);
    lines.push('```', '');
  }

  const already = rows.filter((r) => tracked.has(r.appid));
  if (already.length) lines.push('## Already tracked and shared', '', already.map((r) => `${r.name} (${r.owners.length} owners, ${hours(r.minutes)} h)`).join(' · '), '');

  lines.push('## Suggested Sideshow upcoming searches', '');
  if (!tags.length) lines.push('Not enough tagged multiplayer games to suggest searches yet.', '');
  else {
    lines.push(`The crew's most-played tags outside horror and party: **${tags.join(', ')}**.`, '', 'Add any of these to `upcoming.searches` in `config/games.json`:', '', '```json');
    for (const s of searchesFor(tags)) lines.push(`${JSON.stringify(s)},`);
    lines.push('```', '');
  }

  const solo = rows.filter((r) => !r.multiplayer).slice(0, 10);
  if (solo.length) lines.push('## Shared but single-player', '', solo.map((r) => r.name).join(' · '), '');
  return lines.join('\n');
}

// ---------------------------------------------------------------- Steam calls

function makeClient(key, fetchImpl = fetch) {
  async function getJson(url, { retries = 2 } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (res.status === 429 && attempt < retries) {
          await sleep(15000 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        if (attempt >= retries) throw new Error(redact(err.message, key));
        await sleep(2000 * (attempt + 1));
      }
    }
  }
  const api = (path, params) => `https://api.steampowered.com/${path}?${new URLSearchParams({ key, format: 'json', ...params })}`;

  return {
    async resolveVanity(vanity) {
      const j = await getJson(api('ISteamUser/ResolveVanityURL/v1/', { vanityurl: vanity }));
      return j?.response?.success === 1 ? j.response.steamid : null;
    },
    async summaries(ids) {
      const j = await getJson(api('ISteamUser/GetPlayerSummaries/v2/', { steamids: ids.join(',') }));
      return new Map((j?.response?.players || []).map((p) => [p.steamid, p]));
    },
    async ownedGames(steamid) {
      const j = await getJson(api('IPlayerService/GetOwnedGames/v1/', { steamid, include_appinfo: 1, include_played_free_games: 1 }));
      return j?.response?.games || null; // null = private
    },
    async details(appid) {
      const j = await getJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`);
      await sleep(1600); // appdetails is rate limited
      return j?.[appid]?.success ? j[appid].data : null;
    },
    async tags(appid) {
      try {
        const res = await fetchImpl(`https://store.steampowered.com/app/${appid}/?l=english`, {
          headers: { 'User-Agent': UA, Cookie: 'birthtime=0; lastagecheckage=1-January-1990; wants_mature_content=1' }
        });
        return res.ok ? parseStoreTags(await res.text()) : [];
      } catch {
        return [];
      }
    }
  };
}

async function loadKey() {
  if (process.env.STEAM_API_KEY) return process.env.STEAM_API_KEY.trim();
  try {
    const env = await readFile(resolve(ROOT, '.env'), 'utf8');
    const m = env.match(/^\s*STEAM_API_KEY\s*=\s*"?([A-Za-z0-9]+)"?\s*$/m);
    if (m) return m[1];
  } catch {
    /* no .env */
  }
  return null;
}

async function main() {
  const key = await loadKey();
  if (!key || !/^[A-Za-z0-9]{32}$/.test(key)) {
    console.error('Set STEAM_API_KEY (32 characters) in your environment or in a .env file. Get one at https://steamcommunity.com/dev/apikey');
    process.exit(1);
  }
  const crewPath = resolve(ROOT, process.env.CREW_FILE || 'crew.local.json');
  let crewFile;
  try {
    crewFile = JSON.parse(await readFile(crewPath, 'utf8'));
  } catch {
    console.error('Missing or invalid crew.local.json. Copy crew.example.json to crew.local.json and fill in the crew.');
    process.exit(1);
  }

  const parsed = [];
  for (const m of crewFile.members || []) {
    const p = parseProfile(m.profile);
    if (!p) console.warn(`Skipping ${m.name || '(unnamed)'}: not a Steam profile link`);
    else parsed.push({ ...p, name: m.name || null });
  }
  const { members, dupes } = dedupeMembers(parsed);
  const client = makeClient(key);

  for (const m of members) if (!m.steamid) m.steamid = await client.resolveVanity(m.vanity).catch(() => null);
  const ids = members.filter((m) => m.steamid).map((m) => m.steamid);
  const people = ids.length ? await client.summaries(ids) : new Map();

  const libraries = [];
  const skipped = [];
  for (const m of members) {
    const label = m.name || people.get(m.steamid)?.personaname || m.vanity || 'unknown';
    const games = m.steamid ? await client.ownedGames(m.steamid).catch(() => null) : null;
    if (!games || !games.length) skipped.push(label);
    else libraries.push({ name: label, games });
    console.log(`${label}: ${games ? `${games.length} games` : 'library not readable'}`);
  }
  if (libraries.length < 2) {
    console.error('Need at least two readable libraries to compare.');
    process.exit(1);
  }

  const minOwners = Math.min(libraries.length, Math.max(2, Number(crewFile.minOwners) || Math.ceil(libraries.length / 2)));
  const maxLookups = Number(crewFile.maxLookups) || 40;
  const rows = overlap(libraries, minOwners).slice(0, maxLookups);
  console.log(`${rows.length} shared games; looking up store details (this takes a minute)…`);
  for (const r of rows) {
    const d = await client.details(r.appid).catch(() => null);
    r.multiplayer = isMultiplayer(d);
    r.tags = await client.tags(r.appid);
    r.tent = suggestTent(r.tags);
  }

  const config = JSON.parse(await readFile(resolve(ROOT, 'config/games.json'), 'utf8'));
  const tracked = new Set((config.favorites || []).map((f) => Number(f.appid)));
  const report = renderReport({
    crew: libraries.map((l) => ({ name: l.name, count: l.games.length })),
    skipped,
    dupes,
    rows,
    tracked,
    tags: sideshowTags(rows),
    minOwners,
    generated: new Date().toISOString().slice(0, 16).replace('T', ' ')
  });
  const out = resolve(ROOT, 'crew-report.md');
  await writeFile(out, report);
  console.log(`Wrote ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
