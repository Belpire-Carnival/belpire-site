// Reads a GitHub repository's public release feed (https://github.com/<owner>/<repo>/releases.atom).
// Pure function, Node-testable. Used to show the latest version of community tools on the Star Citizen page.

import { cleanText } from './rsi.js';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export const releasesFeedUrl = (repo) => {
  if (!REPO_RE.test(repo)) throw new Error(`bad repo name: ${repo}`);
  return `https://github.com/${repo}/releases.atom`;
};

// → [{ tag, title, updated, url }] newest first (feed order), at most `limit`.
export function parseReleasesAtom(xml, repo, limit = 5) {
  const prefix = `https://github.com/${repo}/releases/tag/`;
  const out = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1];
    const href = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] || entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
    if (!href || !href.startsWith(prefix)) continue;
    const tag = decodeURIComponent(href.slice(prefix.length)).slice(0, 80);
    const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1];
    const date = updated ? new Date(updated) : null;
    out.push({
      tag,
      title: cleanText(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || tag, 120),
      updated: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      url: href
    });
    if (out.length >= limit) break;
  }
  return out;
}
