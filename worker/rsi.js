// Parsers for the two RSI data sources. Pure functions, no Worker APIs, so they run under Node tests too.
//
// 1. status.robertsspaceindustries.com runs cState (open-source status page) and serves its JSON API:
//      /index.json         → systems and their status (apiVersion 2.0)
//      /issues/index.json  → incident history
// 2. The Comm-Link hub (robertsspaceindustries.com/comm-link) has no feed anymore, so we read the
//    server-rendered list. RSI's robots.txt allows it. If RSI redesigns the page, parseCommLink returns
//    an empty list and the site keeps showing the last good data.

export const RSI_BASE = 'https://robertsspaceindustries.com';
export const STATUS_BASE = 'https://status.robertsspaceindustries.com';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s = '') {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function cleanText(s = '', max = 240) {
  let out = decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return out;
}

// ---------------------------------------------------------------- status (cState)

export function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s === 'operational' || s === 'ok' || s === 'up') return 'operational';
  if (s.includes('maint')) return 'maintenance';
  if (s === 'down' || s.includes('major') || s.includes('outage')) return 'down';
  if (s.includes('disrupt') || s.includes('degrad') || s.includes('partial') || s.includes('perform')) return 'degraded';
  if (s === 'notice' || s.includes('info')) return 'notice';
  return 'unknown';
}

// cState dates look like "2026-10-21 14:30:00 +0000 UTC" or "2026-10-22 05:00:00" (assumed UTC).
export function parseCStateDate(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\s*([+-]\d{2})(\d{2}))?/);
  if (!m) return null;
  const zone = m[3] ? `${m[3]}:${m[4]}` : 'Z';
  const d = new Date(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}${zone}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function statusUrl(permalink) {
  return typeof permalink === 'string' && permalink.startsWith(STATUS_BASE + '/') ? permalink : STATUS_BASE + '/';
}

export function parseStatus(text) {
  const data = JSON.parse(String(text).trim());
  if (!Array.isArray(data.systems)) throw new Error('status: no systems array');
  return {
    summary: normalizeStatus(data.summaryStatus),
    systems: data.systems.map((s) => ({
      name: cleanText(s.name, 60),
      status: normalizeStatus(s.status),
      unresolved: (Array.isArray(s.unresolvedIssues) ? s.unresolvedIssues : []).map((i) => ({
        title: cleanText(i.title, 120),
        severity: normalizeStatus(i.severity),
        url: statusUrl(i.permalink)
      }))
    }))
  };
}

export function parseIssues(text, limit = 6) {
  const data = JSON.parse(String(text).trim());
  const pages = Array.isArray(data.pages) ? data.pages : [];
  return pages
    .filter((p) => p && p.title)
    .map((p) => ({
      id: String(p.filename || p.permalink || p.title),
      title: cleanText(p.title, 120),
      severity: normalizeStatus(p.severity),
      resolved: p.resolved === true,
      informational: p.informational === true,
      createdAt: parseCStateDate(p.createdAt),
      resolvedAt: parseCStateDate(p.resolvedAt),
      affected: (Array.isArray(p.affected) ? p.affected : []).map((a) => cleanText(a, 60)),
      url: statusUrl(p.permalink)
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

// ---------------------------------------------------------------- Comm-Link

const BLOCK_RE = /<a\s+class="content-block2 hub-block[^"]*"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

export function parseCommLink(html, limit = 12) {
  const items = [];
  const seen = new Set();
  for (const m of String(html).matchAll(BLOCK_RE)) {
    const href = m[1];
    const path = href.match(/^\/(?:[a-z]{2}\/)?comm-link\/([a-z-]+)\/(\d+)-[^"?#\s]*$/i);
    if (!path || seen.has(path[2])) continue;
    const body = m[2];
    const title = cleanText(body.match(/<div class="title[^"]*">([\s\S]*?)<\/div>/)?.[1], 140);
    if (!title) continue;
    seen.add(path[2]);
    items.push({
      id: path[2],
      channel: path[1].toLowerCase(),
      type: (body.match(/<div class="type ([a-z-]+)"/)?.[1] || 'post').toLowerCase(),
      title,
      summary: cleanText(body.match(/<div class="body">([\s\S]*?)<\/div>/)?.[1], 220),
      posted: cleanText(body.match(/<div class="time_ago">[\s\S]*?<span class="value">([\s\S]*?)<\/span>/)?.[1], 40),
      url: RSI_BASE + href.replace(/^\/[a-z]{2}\//i, '/')
    });
    if (items.length >= limit) break;
  }
  return items;
}
