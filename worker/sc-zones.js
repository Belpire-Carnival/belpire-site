// Armistice status of a place, read from the community wiki (starcitizen.tools) page for that place.
// GET /api/sc-zones?n=Lorville&n=Teasa%20Spaceport → { zones: { <norm name>: { z: 'armistice'|'open'|'unknown', ev: sentence, page } } }
//   armistice = the page says the site is an Armistice Zone; open = it says it is NOT one ("Be warned - the site is not an Armistice Zone").
const WIKI = 'https://starcitizen.tools/api.php';
const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const MAX_NAMES = 15, TTL = 7 * 86400;
export const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const NEG = /\b(?:is|are) not (?:an? )?armistice zones?\b|\bnot (?:within|in|part of|inside) (?:an? )?armistice zones?\b|\bno armistice zones?\b|\bnot an armistice zone\b/i;
const POS = /\b(?:is|are|within|inside|in|part of|as) (?:an?|the) armistice zones?\b|\barmistice zones?\s*[:|\-–]\s*(?:yes|active|enforced)\b|\bjurisdiction\b[^.]{0,120}\barmistice zones?\b/i;

const sentences = (t) => t.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// Pure: decide the status from the page's plain text. A "not an Armistice Zone" sentence wins over any other mention.
export function zoneFromText(text) {
  const ss = sentences(String(text || '').replace(/\s+/g, ' ').replace(/(?<=[.!?]) (?=[A-Z])/g, '\n'));
  const neg = ss.find((s) => NEG.test(s));
  if (neg) return { z: 'open', ev: neg.slice(0, 200) };
  const pos = ss.find((s) => POS.test(s));
  if (pos) return { z: 'armistice', ev: pos.slice(0, 200) };
  return { z: 'unknown', ev: '' };
}

export const plain = (html) => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|li|tr|div|h\d|dd|dt)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ');

async function wiki(params) {
  const res = await fetch(`${WIKI}?${new URLSearchParams({ format: 'json', formatversion: '2', redirects: '1', ...params })}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  return res.json();
}

async function lookup(name) {
  let page = name;
  let j = await wiki({ action: 'parse', page, prop: 'text' }).catch(() => null);
  if (!j?.parse?.text) {
    const s = await wiki({ action: 'query', list: 'search', srsearch: name, srlimit: '1', srnamespace: '0' }).catch(() => null);
    page = s?.query?.search?.[0]?.title;
    j = page ? await wiki({ action: 'parse', page, prop: 'text' }).catch(() => null) : null;
  }
  if (!j?.parse?.text) return { z: 'unknown', ev: '', page: '' };
  return { ...zoneFromText(plain(j.parse.text)), page: j.parse.title || page };
}

export async function handleZones(url, env) {
  const names = [...new Set(url.searchParams.getAll('n').map((s) => s.trim().slice(0, 80)).filter(Boolean))].slice(0, MAX_NAMES);
  if (!names.length) return { status: 400, body: { error: 'give one or more n= place names' } };
  const zones = {};
  await Promise.all(names.map(async (n) => {
    const k = `zone:v1:${norm(n)}`;
    try { const c = await env.SC_DATA?.get(k, 'json'); if (c) { zones[norm(n)] = c; return; } } catch { /* cache is optional */ }
    try {
      const v = await lookup(n);
      zones[norm(n)] = v;
      // An unknown result is kept for a day only, so a wiki outage or a missing page is retried soon.
      try { await env.SC_DATA?.put(k, JSON.stringify(v), { expirationTtl: v.z === 'unknown' ? 86400 : TTL }); } catch { /* ignore */ }
    } catch { zones[norm(n)] = { z: 'unknown', ev: '', page: '' }; }
  }));
  return { status: 200, body: { zones } };
}
