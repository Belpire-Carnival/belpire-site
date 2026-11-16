// Game data for the OmniGlass Desktop app, served read-only from the Worker bundle. Derived facts only (names, ranks,
// numbers) taken from the game's own database by the desktop extractor; no user data, so no sign-in is needed.
//
//   GET /api/companion/data               → { v, build, files: { factions: { bytes }, 'app-blueprints': { bytes } } }
//   GET /api/companion/data?name=factions → the reputation ladders file
//   GET /api/companion/data?name=app-blueprints → the blueprint finder file
//
// Refresh after each game patch: run the extractors in the desktop repo, copy out/factions.json and out/app-blueprints.json
// to worker/companion-data/, and deploy.
import factions from './companion-data/factions.json' with { type: 'json' };
import blueprints from './companion-data/app-blueprints.json' with { type: 'json' };

const FILES = { factions, 'app-blueprints': blueprints };
const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=300',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
};
const text = new Map();
const bodyOf = (name) => { if (!text.has(name)) text.set(name, JSON.stringify(FILES[name])); return text.get(name); };
const reply = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...HEADERS, ...extra } });

export function manifest() {
  const builds = new Set(Object.values(FILES).map((f) => String(f?.build || '').slice(0, 40)));
  return { v: 1, build: builds.size === 1 ? [...builds][0] : '', files: Object.fromEntries(Object.keys(FILES).map((n) => [n, { bytes: bodyOf(n).length }])) };
}

export function handleCompanionData(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return reply(JSON.stringify({ error: 'method not allowed' }), 405, { Allow: 'GET, HEAD' });
  const name = new URL(request.url).searchParams.get('name');
  if (name === null) return reply(request.method === 'HEAD' ? null : JSON.stringify(manifest()));
  if (!Object.hasOwn(FILES, name)) return reply(JSON.stringify({ error: 'unknown_file' }), 404);
  return reply(request.method === 'HEAD' ? null : bodyOf(name));
}
