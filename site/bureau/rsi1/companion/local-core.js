// Reads the local-data snapshot that OmniGlass Desktop hands to this page (window.__OMNIGLASS__), and only trusts its shape.
// The page never sends anything back to the app: this is read-only. Pure functions, so they can be tested.
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const TONES = ['good', 'bad', 'warn', 'info'];

/** Clean the snapshot, or null when this page is not running inside OmniGlass Desktop. */
export function readLocal(raw) {
  if (!raw || typeof raw !== 'object' || raw.app !== 'omniglass-desktop') return null;
  const names = Array.isArray(raw.blueprints) ? raw.blueprints.filter((x) => typeof x === 'string').slice(0, 1500).map((x) => x.slice(0, 120)) : [];
  const recent = Array.isArray(raw.recent)
    ? raw.recent.filter((r) => r && typeof r === 'object' && typeof r.label === 'string' && r.label).slice(0, 20)
        .map((r) => ({ label: str(r.label, 60), detail: str(r.detail, 120), tone: TONES.includes(r.tone) ? r.tone : 'info', ts: str(r.ts, 40) }))
    : [];
  const ranks = raw.ranks && typeof raw.ranks === 'object' && !Array.isArray(raw.ranks) ? Object.keys(raw.ranks).length : 0;
  return { pending: !!raw.pending, channel: raw.channel === 'ptu' ? 'ptu' : 'live', dataBuild: str(raw.dataBuild, 40), updated: str(raw.updated, 40), blueprints: names, ranks, recent };
}

/** One short line saying what game data the app is using. */
export function dataLine(s) {
  const ch = s.channel.toUpperCase();
  return s.dataBuild ? `Game data: ${ch} ${s.dataBuild}` : `Game data: ${ch}`;
}
