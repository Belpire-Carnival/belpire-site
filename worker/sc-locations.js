// Places and what they offer, taken from the game's own database by the OmniGlass Desktop extractor
// (`node tools/extract/run.mjs site-locations`, then copied to worker/sc-locations.json). Derived facts only:
// names, kinds, jurisdiction and service flags. Nothing is fetched; the file ships with the Worker.
// GET /api/sc-locations → { v, build, places: [{ n: name, s: system, b: moon or planet, k: kind, j: jurisdiction, svc: [service keys] }] }
import data from './sc-locations.json' with { type: 'json' };

const MAX_PLACES = 4000;
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function cleanLocations(d) {
  const places = [];
  for (const p of Array.isArray(d?.places) ? d.places : []) {
    if (!p || typeof p !== 'object') continue;
    const n = str(p.n, 80), s = str(p.s, 40);
    const svc = (Array.isArray(p.svc) ? p.svc : []).filter((x) => typeof x === 'string' && /^[a-z0-9-]{1,24}$/.test(x)).slice(0, 40);
    if (!n || !s || !svc.length) continue;
    places.push({ n, s, b: str(p.b, 60), k: str(p.k, 24), j: str(p.j, 40), svc });
    if (places.length >= MAX_PLACES) break;
  }
  return { v: 1, build: str(d?.build, 30), places };
}

export const handleLocations = () => ({ status: 200, body: cleanLocations(data) });
