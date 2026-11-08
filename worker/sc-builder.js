// Ship-builder data for the Star Citizen companion (bureau.belpire.com/rsi1/companion/).
//
// Source: the community Star Citizen Wiki API (api.star-citizen.wiki). It returns, per ship, the hardpoints and
// the stock parts with their stats, and per part the shop prices it collects from UEX (`uex_prices`), so no
// second API or token is needed. Credit "Star Citizen Wiki API" is shown on the page that uses this data.
//
//  • Ship records are large (tens of KB each, hardpoints included), so the cron builds the snapshot a few pages
//    at a time: each tick does at most PAGES_PER_TICK requests, keeps its progress in KV, and publishes the
//    finished snapshot in one write. A full rebuild only starts when the game version changes or the snapshot
//    is older than REBUILD_MS, so the site makes a few dozen requests a day, far under the 60/minute limit.
//  • GET /api/sc-builder serves the published snapshot; visitors never reach the wiki API.
//
// Bindings: SC_DATA (KV). No secrets. Optional runtime variable: SC_WIKI_API (defaults to WIKI_API below).

export const WIKI_API = 'https://api.star-citizen.wiki/api';
const UA = 'BelpireCarnival/1.0 (+https://bureau.belpire.com/rsi1/companion/)';
const SNAP_KEY = 'sc:builder';
const WORK_KEY = 'sc:builder:work';
const LOCK_KEY = 'sc:builder:lock';
export const REBUILD_MS = 24 * 60 * 60 * 1000;
const PAGES_PER_TICK = 4;
const MAX_PAGES = 40; // hard stop on one rebuild
const SHIP_PAGE = 20;
const PART_PAGE = 100;
const MAX_PRICES = 6;

// Part types a player can swap, by the wiki API's item `type`.
export const PART_TYPES = ['Shield', 'PowerPlant', 'Cooler', 'QuantumDrive', 'JumpDrive', 'Radar'];
export const WEAPON_TYPE = 'WeaponGun';
// Hardpoint types the builder treats as slots (only ports the game marks `editable`).
export const SLOT_TYPES = new Set([...PART_TYPES, WEAPON_TYPE]);

const num = (v) => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const str = (v, max = 80) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, max));
const round = (v, d = 1) => (num(v) == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ------------------------------------------------------------------ slimming

// Shop rows → the cheapest few: { p: price, at: terminal, where: place, sys: star system, d: yyyy-mm-dd }.
export function slimPrices(uex) {
  const rows = Array.isArray(uex?.purchase) ? uex.purchase : [];
  const out = [];
  for (const r of rows) {
    const p = num(r?.price_buy);
    if (!(p > 0)) continue;
    const loc = r.starmap_location || {};
    out.push({
      p,
      at: str(r.terminal_name, 70),
      where: str(loc.name, 50),
      near: str(loc.parent_name, 40),
      sys: str(loc.star_system_name, 30),
      d: str(r.date_updated, 10)
    });
  }
  return out.sort((a, b) => a.p - b.p).slice(0, MAX_PRICES);
}

// One item (from /vehicle-items, /vehicle-weapons or a ship's equipped_item) → the fields the builder uses.
export function slimPart(it) {
  if (!it || typeof it !== 'object' || !it.uuid || !it.type) return null;
  const use = it.resource_network?.usage;
  const part = {
    id: str(it.uuid, 40),
    name: str(it.name, 60),
    type: str(it.type, 30),
    size: num(it.size),
    grade: str(it.grade, 2),
    cls: str(it.class, 20),
    mfr: str(it.manufacturer?.name, 40),
    mass: num(it.mass)
  };
  if (num(use?.power?.max) != null) part.pw = round(use.power.max, 2);
  if (num(use?.coolant?.max) != null) part.cw = round(use.coolant.max, 2);
  if (it.shield) part.shield = { hp: num(it.shield.max_health), regen: num(it.shield.regen_rate) };
  if (it.cooler) part.cool = num(it.cooler.coolant_segment_generation);
  if (it.power_plant) part.gen = num(it.power_plant.power_segment_generation);
  const dmg = it.vehicle_weapon?.damage;
  if (dmg) {
    part.wpn = {
      burst: round(dmg.burst, 1),
      sustained: round(dmg.sustained_60s, 1),
      alpha: round(dmg.alpha_total, 1),
      range: num(it.vehicle_weapon.range)
    };
  }
  const prices = slimPrices(it.uex_prices);
  if (prices.length) part.buy = prices;
  return part;
}

// Editable hardpoints of a ship, nested ones included (turret → weapon). Each slot:
// { id, type, min, max, stock: uuid|null, group: nearest parent mount name }.
export function collectSlots(ports) {
  const slots = [];
  const seen = new Map();
  const walk = (list, trail) => {
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p !== 'object') continue;
      const here = [...trail, str(p.name, 60)];
      if (p.editable && SLOT_TYPES.has(p.type)) {
        let id = here.join('/');
        const n = (seen.get(id) || 0) + 1;
        seen.set(id, n);
        if (n > 1) id = `${id}#${n}`;
        slots.push({
          id,
          type: p.type,
          min: num(p.sizes?.min) ?? 0,
          max: num(p.sizes?.max) ?? 0,
          stock: p.equipped_item_uuid || p.equipped_item?.uuid || null,
          group: trail.length ? trail[trail.length - 1] : ''
        });
      }
      walk(p.ports, here);
    }
  };
  walk(ports, []);
  return slots;
}

// Stock parts that sit in the ship's slots, so parts the catalogue lacks can still be shown.
export function stockParts(ports, into = new Map()) {
  for (const p of Array.isArray(ports) ? ports : []) {
    if (p?.editable && SLOT_TYPES.has(p.type) && p.equipped_item) {
      const part = slimPart(p.equipped_item);
      if (part && !into.has(part.id)) into.set(part.id, part);
    }
    stockParts(p?.ports, into);
  }
  return into;
}

// One vehicle → the record the picker and totals need. `shipStats` are the API's own numbers for the stock
// loadout, kept so the page can show that its totals agree with the game data.

// Ship-level figures for the calculator's stat panels. Every field is optional: the wiki leaves some out for
// some ships, and a missing value stays null rather than being guessed.
const r2 = (x, d = 2) => { const n = num(x); return n == null ? null : Math.round(n * 10 ** d) / 10 ** d; };
const side = (o) => ({ phys: r2(o?.physical?.maximum, 3), energy: r2(o?.energy?.maximum, 3), dist: r2(o?.distortion?.maximum, 3) });
export function slimStats(v) {
  const a = v?.armor || {}, ag = v?.agility || {}, sp = v?.speed || {}, fu = v?.fuel || {}, q = v?.quantum || {}, sg = v?.signature || {}, em = v?.emission || {};
  const dim = v?.dimension || {};
  return {
    hull: r2(v?.health, 0),
    mass: r2(v?.mass_total ?? v?.mass, 0),
    dim: [r2(dim.length, 1), r2(dim.width, 1), r2(dim.height, 1)],
    armor: { hp: r2(a.health, 0), phys: r2(a.damage_physical, 3), energy: r2(a.damage_energy, 3), dist: r2(a.damage_distortion, 3) },
    shield: { face: str(v?.shield?.face_type, 20), resist: side(v?.shield?.resistance), absorb: side(v?.shield?.absorption), regenTime: r2(v?.shield?.regeneration_time, 1) },
    agility: { pitch: r2(ag.pitch, 0), yaw: r2(ag.yaw, 0), roll: r2(ag.roll, 0), pitchB: r2(ag.pitch_boosted, 0), yawB: r2(ag.yaw_boosted, 0), rollB: r2(ag.roll_boosted, 0) },
    speed: { boostF: r2(sp.boost_forward, 0), boostB: r2(sp.boost_backward, 0), toScm: r2(sp.zero_to_scm, 2) },
    fuel: { h2: r2(fu.capacity, 1), intake: r2(fu.intake_rate, 2), qt: r2(q.quantum_fuel_capacity, 1) },
    quantum: { speed: r2(q.quantum_speed, 0), spool: r2(q.quantum_spool_time, 1), range: r2(q.quantum_range, 0) },
    sig: { ir: r2(sg.ir_shields ?? em.ir, 0), em: r2(sg.em_shields ?? em.em_idle, 0), emMax: r2(em.em_max, 0), cs: r2(v?.cross_section_max, 1) },
    missiles: { count: r2(v?.weaponry?.missiles?.count, 0), damage: r2(v?.weaponry?.total_missile_damage ?? v?.weaponry?.missiles?.damage, 0) },
    insure: { claim: r2(v?.insurance?.claim_time, 1), expedite: r2(v?.insurance?.expedite_time, 1), cost: r2(v?.insurance?.expedite_cost, 0) },
    seats: r2(v?.crew?.weapon, 0)
  };
}

export function slimShip(v) {
  if (!v || typeof v !== 'object' || !v.uuid || !v.name) return null;
  const slots = collectSlots(v.ports);
  return {
    id: str(v.uuid, 40),
    slug: str(v.slug, 80),
    name: str(v.name, 60),
    mfr: str(v.manufacturer?.name, 40),
    role: str(v.role, 40),
    career: str(v.career, 30),
    size: num(v.size_class),
    crew: { min: num(v.crew?.min), max: num(v.crew?.max) },
    cargo: num(v.cargo_capacity),
    scm: num(v.speed?.scm),
    max: num(v.speed?.max),
    msrp: num(v.msrp),
    buy: slimPrices(v.uex_prices),
    slots,
    stats: slimStats(v),
    api: {
      shieldHp: num(v.shield?.hp),
      shieldRegen: num(v.shield?.regeneration),
      coolSeg: num(v.cooling?.generation_segments),
      powerSeg: num(v.power?.generation_segments),
      pilotDps: num(v.weaponry?.pilot_dps),
      turretDps: num(v.weaponry?.turret_dps)
    }
  };
}

// Inputs are already slimmed (work state stays small in KV). Catalogue entries win over stock-part copies
// because only they carry shop prices.
export function buildSnapshot(version, ships, catalogue, stock = []) {
  const parts = new Map();
  for (const p of stock) if (p && !parts.has(p.id)) parts.set(p.id, p);
  for (const p of catalogue) if (p) parts.set(p.id, p);
  const byId = new Map();
  for (const s of ships) if (s && s.slots.length) byId.set(s.id, s);
  const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { version, updatedAt: new Date().toISOString(), source: 'Star Citizen Wiki API', ships: list, parts: [...parts.values()] };
}

// ------------------------------------------------------------------ fetching (resumable)

async function wiki(env, path) {
  const base = String(env.SC_WIKI_API || WIKI_API).replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from wiki API ${path.split('?')[0]}`);
  return res.json();
}

const enc = encodeURIComponent;
export function jobUrl(job) {
  const q = `page[size]=${job.size}&page[number]=${job.page}`.replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  if (job.kind === 'parts') return `/vehicle-items?${q}&filter%5Btype%5D=${enc(PART_TYPES.join(','))}`;
  if (job.kind === 'weapons') return `/vehicle-weapons?${q}`;
  return `/vehicles?${q}&filter%5Bis_spaceship%5D=true`;
}

const freshJobs = () => [
  { kind: 'parts', page: 1, size: PART_PAGE },
  { kind: 'weapons', page: 1, size: PART_PAGE },
  { kind: 'ships', page: 1, size: SHIP_PAGE }
];

async function readJson(kv, key) {
  try {
    return (await kv.get(key, 'json')) || null;
  } catch {
    return null;
  }
}

export async function currentVersion(env) {
  const json = await wiki(env, '/game-versions/default');
  const code = str(json?.data?.code, 60);
  if (!code) throw new Error('game-versions/default had no code');
  return code;
}

// Advance a rebuild by up to PAGES_PER_TICK requests. Returns the updated work state (or null when finished).
export async function stepWork(env, work) {
  let calls = 0;
  while (work.jobs.length && calls < PAGES_PER_TICK) {
    if (++work.pages > MAX_PAGES) throw new Error('builder rebuild exceeded page limit');
    const job = work.jobs[0];
    const json = await wiki(env, jobUrl(job));
    calls++;
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (job.kind === 'ships') {
      const seen = new Map();
      for (const v of rows) {
        const ship = slimShip(v);
        if (ship) work.ships.push(ship);
        stockParts(v?.ports, seen);
      }
      const have = new Set(work.stock.map((p) => p.id));
      for (const p of seen.values()) if (!have.has(p.id)) work.stock.push(p);
    } else {
      for (const it of rows) {
        const p = slimPart(it);
        if (p) work.parts.push(p);
      }
    }
    const last = num(json?.meta?.last_page) ?? job.page;
    work.jobs.shift();
    if (job.page < last) work.jobs.unshift({ ...job, page: job.page + 1 });
  }
  return work;
}

// `lock` (used by the cron) makes overlapping runs skip instead of racing on the saved progress; KV's smallest
// expiry is 60 seconds, which is about one tick's worth of requests.
export async function refreshBuilder(env, { force = false, lock = false } = {}) {
  const kv = env.SC_DATA;
  if (lock) {
    if (await kv.get(LOCK_KEY)) return null;
    await kv.put(LOCK_KEY, '1', { expirationTtl: 60 });
  }
  let work = await readJson(kv, WORK_KEY);
  if (!work) {
    const snap = await readJson(kv, SNAP_KEY);
    const version = await currentVersion(env);
    const age = snap?.updatedAt ? Date.now() - Date.parse(snap.updatedAt) : Infinity;
    if (!force && snap && snap.version === version && age < REBUILD_MS) return snap;
    work = { version, startedAt: new Date().toISOString(), pages: 0, jobs: freshJobs(), ships: [], parts: [], stock: [] };
  }
  work = await stepWork(env, work);
  if (work.jobs.length) {
    await kv.put(WORK_KEY, JSON.stringify(work), { expirationTtl: 6 * 60 * 60 });
    return null;
  }
  const snap = buildSnapshot(work.version, work.ships, work.parts, work.stock);
  if (!snap.ships.length) throw new Error('builder rebuild produced no ships');
  await kv.put(SNAP_KEY, JSON.stringify(snap));
  // Cleanup is best effort: if KV refuses (rate limit), the snapshot is already published, and the leftover work
  // state is replaced by the next rebuild or expires on its own.
  try {
    await kv.delete(WORK_KEY);
  } catch (err) {
    console.warn(`Builder work cleanup failed: ${err.message}`);
  }
  return snap;
}

// GET /api/sc-builder
export async function handleBuilder(env) {
  const snap = await readJson(env.SC_DATA, SNAP_KEY);
  if (!snap) {
    // Only the cron builds the snapshot; a visitor's request never starts a rebuild (many visitors would pile up).
    const work = await readJson(env.SC_DATA, WORK_KEY);
    return { ready: false, progress: work ? { pages: work.pages, remaining: work.jobs.length } : null };
  }
  return { ready: true, ...snap };
}
