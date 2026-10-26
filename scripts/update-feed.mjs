#!/usr/bin/env node
// Pulls Steam data into site/data/feed.json for the Belpire Carnival site.
//  - "favorites": latest official news/patches for the games listed in config/games.json
//  - "upcoming":  coming-soon games from Steam store searches (by tag), sorted into tents
//  - "jackbox":   store art and recent official news for the boxes in site/jackbox/packs.json
// Optionally posts new items to Discord when DISCORD_WEBHOOK_URL is set.
// The Cloudflare build (scripts/cf-build.mjs) downloads the live site's feed.json first,
// so "previous" is whatever is currently published — nothing is committed back to the repo.
// Uses only Node 20+ built-ins (global fetch). No dependencies.
//
// Note: ISteamNews/GetNewsForApp is a documented Steam Web API call. The store
// endpoints (search, appdetails, tag list) are public but undocumented and can change.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'config/games.json');
const FEED_PATH = resolve(ROOT, 'site/data/feed.json');
const JACKBOX_PATH = resolve(ROOT, 'site/jackbox/packs.json');
const TENTS = new Set(['horror', 'party', 'other']);
const UA = 'BelpireCarnivalFeed/1.0 (+https://belpire.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (res.status === 429 && attempt < retries) {
        await sleep(15000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
}

// ---------- text cleanup ----------

export function cleanText(raw = '', max = 220) {
  let s = String(raw)
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/g, ' ')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?[a-z0-9*]+(?:=[^\]]*)?\]/gi, ' ') // remaining BBCode tags
    .replace(/<[^>]*>/g, ' ') // HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return s;
}

export function classifyNews(item) {
  const tags = (item.tags || []).map((t) => String(t).toLowerCase());
  const title = String(item.title || '');
  if (tags.includes('patchnotes') || /\b(patch|hotfix|update|v\d+(\.\d+)+|build \d+)\b/i.test(title)) return 'PATCH';
  if (/\b(event|halloween|festival|season|weekend|anniversary|sale|free to play)\b/i.test(title)) return 'EVENT';
  return 'NEWS';
}

export function parseSearchAppIds(html = '') {
  const ids = [];
  for (const m of String(html).matchAll(/data-ds-appid="(\d+)"/g)) {
    const id = Number(m[1]);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

const shortCategory = new Map([
  ['Online Co-op', 'Online Co-op'],
  ['Online PvP', 'Online PvP'],
  ['Co-op', 'Co-op'],
  ['Multi-player', 'Multiplayer'],
  ['Shared/Split Screen', 'Split screen'],
  ['Remote Play Together', 'Remote Play']
]);

export function pickChips(categories = []) {
  const names = categories.map((c) => c.description);
  const chips = [];
  for (const [steamName, label] of shortCategory) {
    if (names.includes(steamName) && !chips.includes(label)) chips.push(label);
  }
  if (chips.includes('Online Co-op')) return chips.filter((c) => c !== 'Co-op' && c !== 'Multiplayer').slice(0, 3);
  return chips.slice(0, 3);
}

// ---------- Steam calls ----------

const detailsCache = new Map();
async function appDetails(appid) {
  if (detailsCache.has(appid)) return detailsCache.get(appid);
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`;
  const json = await getJson(url);
  const entry = json?.[appid];
  const data = entry?.success ? entry.data : null;
  detailsCache.set(appid, data);
  await sleep(1600); // appdetails is rate limited (~200 requests / 5 min)
  return data;
}

async function resolveTagIds(names) {
  const list = await getJson('https://store.steampowered.com/tagdata/populartags/english');
  const byName = new Map(list.map((t) => [String(t.name).toLowerCase(), t.tagid]));
  return names.map((n) => {
    if (typeof n === 'number') return n;
    const id = byName.get(String(n).toLowerCase());
    if (!id) throw new Error(`Unknown Steam tag "${n}" in config/games.json`);
    return id;
  });
}

async function fetchFavorites(config, previous) {
  const { perGame = 2, maxAgeDays = 45, officialOnly = true } = config.news || {};
  const cutoff = Date.now() / 1000 - maxAgeDays * 86400;
  const out = [];
  for (const game of config.favorites || []) {
    const appid = Number(game.appid);
    const tent = TENTS.has(game.tent) ? game.tent : 'other';
    if (!appid) continue;
    try {
      const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=10&maxlength=600&format=json`;
      const json = await getJson(url);
      let items = json?.appnews?.newsitems || [];
      if (officialOnly) items = items.filter((n) => n.feedname === 'steam_community_announcements');
      items = items.filter((n) => n.date >= cutoff).slice(0, perGame);
      const details = items.length ? await appDetails(appid).catch(() => null) : null;
      for (const n of items) {
        out.push({
          id: `news-${n.gid}`,
          appid,
          name: game.name || details?.name || `App ${appid}`,
          tent,
          kind: classifyNews(n),
          title: cleanText(n.title, 120),
          summary: cleanText(n.contents),
          date: new Date(n.date * 1000).toISOString(),
          url: n.url,
          image: details?.header_image || null
        });
      }
    } catch (err) {
      console.warn(`News failed for ${appid}: ${err.message} (keeping previous items)`);
      out.push(...previous.filter((p) => p.appid === appid));
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

async function fetchUpcoming(config, previous) {
  const up = config.upcoming || {};
  const searches = up.searches || [];
  if (!searches.length) return [];
  const exclude = new Set(up.excludeContentDescriptors || []);
  const max = up.maxPerSearch || 8;
  const favoriteIds = new Set((config.favorites || []).map((f) => Number(f.appid)));
  const seen = new Set();
  const out = [];
  let failed = false;

  for (const search of searches) {
    const tent = TENTS.has(search.tent) ? search.tent : 'other';
    try {
      const tagIds = await resolveTagIds(search.tags || []);
      const url =
        'https://store.steampowered.com/search/results/?filter=comingsoon&infinite=1&cc=us&l=english' +
        `&count=${max * 3}&tags=${tagIds.join(',')}`;
      const json = await getJson(url);
      const ids = parseSearchAppIds(json?.results_html);
      let added = 0;
      for (const appid of ids) {
        if (added >= max) break;
        if (seen.has(appid) || favoriteIds.has(appid)) continue;
        const d = await appDetails(appid).catch(() => null);
        if (!d || d.type !== 'game') continue;
        const descriptors = d.content_descriptors?.ids || [];
        if (descriptors.some((id) => exclude.has(id))) continue;
        seen.add(appid);
        added++;
        out.push({
          id: `app-${appid}`,
          appid,
          name: d.name,
          tent,
          releaseDate: d.release_date?.date || 'Coming soon',
          tags: pickChips(d.categories || []),
          url: `https://store.steampowered.com/app/${appid}/`,
          image: d.header_image || null
        });
      }
    } catch (err) {
      failed = true;
      console.warn(`Upcoming search failed (${(search.tags || []).join(' + ')}): ${err.message}`);
    }
  }
  // If every search failed, keep the last good list rather than blanking the section.
  if (failed && !out.length) return previous;
  return out;
}

// ---------- tracked games (search + Big Tent polls) ----------

// Name, tent and store art for every favorite. Art is looked up once and then reused from the live feed.
async function fetchTracked(config, previous, news) {
  const known = new Map(previous.filter((t) => t.image).map((t) => [Number(t.appid), t.image]));
  for (const n of news) if (n.image && !known.has(Number(n.appid))) known.set(Number(n.appid), n.image);
  const out = [];
  for (const f of config.favorites || []) {
    const appid = Number(f.appid);
    if (!appid) continue;
    let image = known.get(appid) || null;
    if (!image) image = (await appDetails(appid).catch(() => null))?.header_image || null;
    out.push({ appid, name: f.name, tent: TENTS.has(f.tent) ? f.tent : 'other', image });
  }
  return out;
}

// ---------- Jackbox page ----------

// Store art (looked up once, then reused) and the latest official news for each box on the Jackbox page.
async function fetchJackbox(previous) {
  const data = await readJson(JACKBOX_PATH, null);
  const packs = data?.packs || [];
  if (!packs.length) return previous;
  const images = { ...(previous?.images || {}) };
  for (const p of packs) {
    if (images[p.appid]) continue;
    const d = await appDetails(p.appid).catch(() => null);
    if (d?.header_image) images[p.appid] = d.header_image;
  }
  const config = { news: { perGame: 1, maxAgeDays: 180, officialOnly: true }, favorites: packs.map((p) => ({ appid: p.appid, name: p.name, tent: 'party' })) };
  const news = await fetchFavorites(config, previous?.news || []);
  return { images, news: news.slice(0, 8) };
}

// ---------- Discord ----------

const TENT_COLORS = { horror: 0x7a1625, party: 0xd9b26a, other: 0x34404c };
const TENT_LABELS = { horror: 'Horror Tent', party: 'Party Tent', other: 'The Sideshow' };

async function postToDiscord(webhook, items, limit) {
  let posted = 0;
  for (const item of items.slice(0, limit)) {
    const isNews = item.id.startsWith('news-');
    const embed = {
      title: isNews ? `${item.name} — ${item.title}` : `Coming soon: ${item.name}`,
      url: item.url,
      description: isNews ? item.summary : `Releases: ${item.releaseDate}${item.tags?.length ? ` · ${item.tags.join(' · ')}` : ''}`,
      color: TENT_COLORS[item.tent],
      footer: { text: TENT_LABELS[item.tent] },
      ...(item.image ? { image: { url: item.image } } : {})
    };
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Belpire Barker', embeds: [embed], allowed_mentions: { parse: [] } })
    });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      await sleep(Math.ceil((body.retry_after || 2) * 1000));
    } else if (!res.ok) {
      console.warn(`Discord post failed: HTTP ${res.status}`);
    } else {
      posted++;
    }
    await sleep(1200);
  }
  return posted;
}

// ---------- main ----------

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// Tells the GitHub workflow whether anything changed, so scheduled runs only deploy when needed.
async function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await writeFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' });
}

async function main() {
  const config = await readJson(CONFIG_PATH, null);
  if (!config) throw new Error(`Could not read ${CONFIG_PATH}`);
  const previous = await readJson(FEED_PATH, null);
  const prevFavorites = previous?.favorites || [];
  const prevUpcoming = previous?.upcoming || [];

  const prevJackbox = previous?.jackbox || { images: {}, news: [] };

  const favorites = await fetchFavorites(config, prevFavorites);
  const upcoming = await fetchUpcoming(config, prevUpcoming);
  const jackbox = await fetchJackbox(prevJackbox); // shown on /jackbox/ only, never posted to Discord

  // Every tracked game (not just ones with fresh news) so the site search and polls can find them all.
  const tracked = await fetchTracked(config, previous?.tracked || [], favorites);

  const content = { tracked, upcoming, favorites, jackbox };
  const prevContent = { tracked: previous?.tracked || [], upcoming: prevUpcoming, favorites: prevFavorites, jackbox: prevJackbox };
  if (previous && JSON.stringify(content) === JSON.stringify(prevContent)) {
    console.log('No changes in the Steam feed.');
    await setOutput('changed', 'false');
    return;
  }
  await setOutput('changed', 'true');

  await mkdir(dirname(FEED_PATH), { recursive: true });
  await writeFile(FEED_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), ...content }, null, 2) + '\n');
  console.log(`Wrote ${upcoming.length} upcoming and ${favorites.length} news items.`);

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (webhook && previous) {
    // Only announce items that weren't in the last feed. Skipped on the very first run to avoid a flood.
    const known = new Set([...prevFavorites, ...prevUpcoming].map((i) => i.id));
    const fresh = [...favorites, ...upcoming].filter((i) => !known.has(i.id));
    const posted = await postToDiscord(webhook, fresh, config.discord?.maxPostsPerRun ?? 10);
    console.log(`Posted ${posted} new item(s) to Discord.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
