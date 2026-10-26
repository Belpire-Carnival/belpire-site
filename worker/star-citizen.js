// The Star Citizen page (belpire.com/star-citizen/).
//
//  • Every 10 minutes (Cron Trigger) refresh() reads RSI's status page JSON and the Comm-Link hub
//    (plus, hourly, the GitHub release feeds of tracked community tools), stores one snapshot in KV,
//    and posts new Comm-Links, new incidents and status changes to Discord.
//  • GET /api/star-citizen serves that snapshot to the page.
//
// Bindings (wrangler.jsonc): SC_DATA (KV).
// Runtime secret (Cloudflare dashboard, optional): SC_DISCORD_WEBHOOK_URL.

import { RSI_BASE, STATUS_BASE, parseStatus, parseIssues, parseCommLink } from './rsi.js';
import { postEmbeds, newsEmbed, incidentEmbed, systemEmbed } from './discord.js';
import { releasesFeedUrl, parseReleasesAtom } from './github.js';

const UA = 'BelpireCarnival/1.0 (+https://belpire.com/star-citizen/)';
const SNAPSHOT_KEY = 'sc:snapshot';
const SEEN_KEY = 'sc:seen';
const STALE_MS = 30 * 60 * 1000;
const MAX_POSTS_PER_RUN = 6;

async function getText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/html;q=0.9' },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.text();
}

async function readJson(kv, key) {
  try {
    return (await kv.get(key, 'json')) || null;
  } catch {
    return null;
  }
}

// Community tools whose GitHub releases are shown on the page (see site/star-citizen/tools.json).
// Release feeds are checked at most hourly — they change rarely and GitHub is shared by everyone.
export const TRACKED_REPOS = ['Osiris-DevWorks/smart-citizen', 'MrKraken/StarStrings'];
const RELEASES_EVERY_MS = 55 * 60 * 1000;

async function fetchReleases(previous, errors) {
  const fresh = previous?.releasesCheckedAt && Date.now() - Date.parse(previous.releasesCheckedAt) < RELEASES_EVERY_MS;
  if (fresh && previous.releases) return { releases: previous.releases, releasesCheckedAt: previous.releasesCheckedAt };
  const releases = { ...(previous?.releases || {}) };
  const results = await Promise.allSettled(TRACKED_REPOS.map((repo) => getText(releasesFeedUrl(repo)).then((xml) => parseReleasesAtom(xml, repo))));
  results.forEach((r, i) => {
    const repo = TRACKED_REPOS[i];
    if (r.status === 'fulfilled' && r.value.length) releases[repo] = r.value;
    else errors.push(`releases ${repo}: ${r.status === 'fulfilled' ? 'no releases parsed' : r.reason?.message}`);
  });
  return { releases, releasesCheckedAt: new Date().toISOString() };
}

// Fetch all sources independently; a failed source keeps its previous value.
export async function buildSnapshot(previous) {
  const errors = [];
  const [status, issues, news, rel] = await Promise.allSettled([
    getText(`${STATUS_BASE}/index.json`).then(parseStatus),
    getText(`${STATUS_BASE}/issues/index.json`).then((t) => parseIssues(t, 8)),
    getText(`${RSI_BASE}/comm-link`).then((t) => parseCommLink(t, 12)),
    fetchReleases(previous, errors)
  ]);
  const pick = (r, name, prev, valid = () => true) => {
    if (r.status === 'fulfilled' && valid(r.value)) return r.value;
    errors.push(`${name}: ${r.status === 'fulfilled' ? 'nothing parsed (page layout may have changed)' : r.reason?.message}`);
    return prev;
  };
  const releaseData = rel.status === 'fulfilled' ? rel.value : { releases: previous?.releases ?? {}, releasesCheckedAt: previous?.releasesCheckedAt ?? null };
  return {
    updatedAt: new Date().toISOString(),
    status: pick(status, 'status', previous?.status ?? null),
    incidents: pick(issues, 'incidents', previous?.incidents ?? []),
    news: pick(news, 'news', previous?.news ?? [], (v) => v.length > 0),
    ...releaseData,
    errors
  };
}

// Work out what's new compared with what we've already announced.
export function diffForDiscord(snapshot, seen) {
  const embeds = [];
  const next = {
    news: [...(seen?.news || [])],
    incidents: [...(seen?.incidents || [])],
    systems: { ...(seen?.systems || {}) }
  };

  for (const s of snapshot.status?.systems || []) {
    const before = next.systems[s.name];
    if (seen && before && before !== s.status && s.status !== 'unknown') embeds.push(systemEmbed(s.name, before, s.status));
    next.systems[s.name] = s.status;
  }
  for (const issue of snapshot.incidents || []) {
    if (next.incidents.includes(issue.id)) continue;
    if (seen && !issue.resolved && !issue.informational) embeds.push(incidentEmbed(issue));
    next.incidents.push(issue.id);
  }
  for (const item of [...(snapshot.news || [])].reverse()) {
    if (next.news.includes(item.id)) continue;
    if (seen) embeds.push(newsEmbed(item));
    next.news.push(item.id);
  }
  next.news = next.news.slice(-200);
  next.incidents = next.incidents.slice(-200);
  return { embeds: embeds.slice(0, MAX_POSTS_PER_RUN), next };
}

export async function refresh(env, { notify }) {
  const previous = await readJson(env.SC_DATA, SNAPSHOT_KEY);
  const snapshot = await buildSnapshot(previous);
  await env.SC_DATA.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
  if (snapshot.errors.length) console.warn('Star Citizen refresh warnings:', snapshot.errors.join(' | '));

  if (notify) {
    // First run: remember what exists without posting it, so the channel isn't flooded.
    const seen = await readJson(env.SC_DATA, SEEN_KEY);
    const { embeds, next } = diffForDiscord(snapshot, seen);
    if (embeds.length && env.SC_DISCORD_WEBHOOK_URL) {
      const posted = await postEmbeds(env.SC_DISCORD_WEBHOOK_URL, embeds);
      console.log(`Posted ${posted} Star Citizen item(s) to Discord.`);
    }
    if (JSON.stringify(next) !== JSON.stringify(seen)) await env.SC_DATA.put(SEEN_KEY, JSON.stringify(next));
  }
  return snapshot;
}

// GET /api/star-citizen
export async function handleSnapshot(env, ctx) {
  let snapshot = await readJson(env.SC_DATA, SNAPSHOT_KEY);
  if (!snapshot) {
    snapshot = await refresh(env, { notify: false }); // very first visit before the cron has run
  } else if (Date.now() - Date.parse(snapshot.updatedAt) > STALE_MS) {
    ctx.waitUntil(refresh(env, { notify: false })); // cron missed runs; serve what we have, refresh behind
  }
  return snapshot;
}
