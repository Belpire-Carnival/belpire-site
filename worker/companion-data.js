// Game data for the OmniGlass Desktop app, served read-only from the Worker bundle. Derived facts only (names, ranks,
// numbers) taken from the game's own database by the desktop extractor; no user data, so no sign-in is needed.
//
//   GET /api/companion/data                          → manifest: { v: 2, channels: { live: { build, available, files }, ptu: { … } }, build, files }
//                                                      (top-level build/files repeat LIVE for older clients)
//   GET /api/companion/data?name=factions            → the reputation ladders file (LIVE)
//   GET /api/companion/data?name=app-blueprints&channel=ptu → the blueprint finder file for the PTU
//   GET /api/companion/data?name=mining              → ores, deposit compositions and rock tables (for the mineral finder)
//
// Refresh after each game patch: in the desktop repo run `node tools/extract/refresh.mjs live <version>` (and `ptu <version>`), then
// run apply-data.mjs here (see its header). Nothing user-specific is stored.
import liveFactions from './companion-data/live/factions.json' with { type: 'json' };
import liveBlueprints from './companion-data/live/app-blueprints.json' with { type: 'json' };
import ptuFactions from './companion-data/ptu/factions.json' with { type: 'json' };
import ptuBlueprints from './companion-data/ptu/app-blueprints.json' with { type: 'json' };
import liveMining from './companion-data/live/mining.json' with { type: 'json' };
import ptuMining from './companion-data/ptu/mining.json' with { type: 'json' };

const CHANNELS = {
  live: { factions: liveFactions, 'app-blueprints': liveBlueprints, mining: liveMining },
  ptu: { factions: ptuFactions, 'app-blueprints': ptuBlueprints, mining: ptuMining }
};
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const text = new Map();
const bodyOf = (channel, name) => { const k = `${channel}/${name}`; if (!text.has(k)) text.set(k, JSON.stringify(CHANNELS[channel][name])); return text.get(k); };
const reply = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...HEADERS, ...extra } });

// A channel with no extracted build yet (an empty placeholder) is listed but marked unavailable, so the app can hide its toggle.
function describe(channel) {
  const files = CHANNELS[channel];
  const builds = new Set(Object.values(files).map((f) => String(f?.build || '').slice(0, 40)));
  const build = builds.size === 1 ? [...builds][0] : '';
  return { build, available: build !== '', files: Object.fromEntries(Object.keys(files).map((n) => [n, { bytes: bodyOf(channel, n).length }])) };
}

export function manifest() {
  const channels = Object.fromEntries(Object.keys(CHANNELS).map((c) => [c, describe(c)]));
  return { v: 2, channels, build: channels.live.build, files: channels.live.files };
}

export function handleCompanionData(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply(JSON.stringify({ error: 'method not allowed' }), 405, { Allow: 'GET, HEAD' });
  const params = new URL(request.url).searchParams;
  const name = params.get('name'), channel = (params.get('channel') ?? 'live').toLowerCase();
  const head = request.method === 'HEAD';
  if (name === null) return reply(head ? null : JSON.stringify(manifest()));
  if (!Object.hasOwn(CHANNELS, channel)) return reply(JSON.stringify({ error: 'unknown_channel' }), 404);
  if (!Object.hasOwn(CHANNELS[channel], name)) return reply(JSON.stringify({ error: 'unknown_file' }), 404);
  if (!describe(channel).available) return reply(JSON.stringify({ error: 'channel_not_available' }), 404);
  return reply(head ? null : bodyOf(channel, name));
}
