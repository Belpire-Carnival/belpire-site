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
// Bump when the snapshot gains fields, so the next cron tick rebuilds it without waiting for a game patch.
export const SCHEMA = 6;
export const PART_TYPES = ['Shield', 'PowerPlant', 'Cooler', 'QuantumDrive', 'JumpDrive', 'Radar', 'MissileLauncher', 'Missile'];
export const WEAPON_TYPE = 'WeaponGun';
// Hardpoint types the builder treats as slots (only ports the game marks `editable`).
// Missiles are catalogue parts only: they load into a rack, which is the slot.
export const SLOT_TYPES = new Set([...PART_TYPES.filter((t) => t !== 'Missile'), WEAPON_TYPE]);

// Picture of a wiki record: the path (after the host) of its first usable image on the wiki's media server, or ''.
// Only that one host is accepted, and the path is kept short and plain so it can be requested through /api/sc-img.
export const MEDIA_HOST = 'media.starcitizen.tools';
export const IMG_PATH = /^(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/[A-Za-z0-9._%()~'+-]{1,160}(?:\/[0-9]{2,4}px-[A-Za-z0-9._%()~'+-]{1,160})?$/;
export function imgPath(it) {
  const list = Array.isArray(it?.images) ? it.images : it?.image ? [it.image] : [];
  for (const im of list) {
    for (const u of [im?.thumbnail_url, im?.original_url, typeof im === 'string' ? im : null]) {
      try {
        const url = new URL(String(u));
        if (url.protocol !== 'https:' || url.hostname !== MEDIA_HOST) continue;
        const path = url.pathname.replace(/^\//, '');
        if (IMG_PATH.test(path)) return path;
      } catch { /* not a URL */ }
    }
  }
  return '';
}

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

// Every figure the wiki records for a part, flattened to { 'group.field': number } for the detail pop-up. Only the
// groups below are read, repeated min/max aliases and pre-formatted strings are dropped, and a few short text fields
// (signal type, weapon type) are kept. Capped so one odd record cannot bloat the snapshot.
const DETAIL_ROOTS = ['vehicle_weapon', 'missile', 'shield', 'cooler', 'power_plant', 'quantum_drive', 'jump_drive', 'radar', 'missile_rack', 'durability', 'distortion', 'temperature', 'emission', 'resource_network'];
const DETAIL_TEXT = new Set(['signal_type', 'type', 'class', 'sub_type', 'face_type']);
const DETAIL_SKIP = new Set(['modes', 'damages', 'states', 'uuid', 'minimum', 'maximum', 'unit', 'images', 'impact_damage', 'impact_damage_map']);
const MAX_DETAIL = 90;
export function detailOf(it) {
  const out = {};
  const walk = (v, path, depth) => {
    if (Object.keys(out).length >= MAX_DETAIL) return;
    if (num(v) != null) { out[path] = Number(Number(v).toPrecision(6)); return; }
    if (typeof v === 'string') { if (DETAIL_TEXT.has(path.split('.').pop()) && v.length <= 30) out[path] = str(v, 30); return; }
    if (!v || typeof v !== 'object' || Array.isArray(v) || depth > 4) return;
    for (const [k, x] of Object.entries(v)) {
      if (DETAIL_SKIP.has(k) || k.endsWith('_formatted')) continue;
      walk(x, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  for (const root of DETAIL_ROOTS) if (it?.[root] != null) walk(it[root], root, 1);
  return out;
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
  const img = imgPath(it);
  if (img) part.img = img;
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
  if (it.missile_rack) part.rack = { count: num(it.missile_rack.missile_count) ?? num(it.max_missiles), size: num(it.missile_rack.missile_size) };
  if (it.missile) part.msl = { sig: str(it.missile.signal_type, 20), dmg: round(it.missile.damage_total, 1), lock: round(it.missile.lock_time, 2), speed: round(it.missile.speed, 0), rmin: round(it.missile.lock_range_min, 0), rmax: round(it.missile.lock_range_max, 0), ang: round(it.missile.lock_angle, 0) };
  const x = detailOf(it);
  if (Object.keys(x).length) part.x = x;
  const hp = num(it.durability?.health);
  if (hp != null) part.hp = hp;
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
      const rack = p.type === 'MissileLauncher' && !p.editable; // racks are fixed on most ships, but their missiles are not
      if ((p.editable || rack) && SLOT_TYPES.has(p.type)) {
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
          group: trail.length ? trail[trail.length - 1] : '',
          ...(rack ? { locked: true } : {})
        });
      }
      walk(p.ports, here);
    }
  };
  walk(ports, []);
  return slots;
}


// ---- guns the wiki does not list as child ports ---------------------------------------------------------------
// Pilot guns sit in gimbal mounts that the wiki lists as swappable `Turret` ports with no child ports; the guns
// themselves are only named, in the ship's `weaponry.fixed_weapons` list, in the same order as the mounts. A manned
// or remote turret whose port has no children is described by the ship's `turrets` list instead (one entry per
// mount, with the stock gun's uuid). Both become ordinary gun slots; a slot's stock gun is found by name later
// (see buildSnapshot) when only the name is known.
const holdsGun = (p) => Array.isArray(p?.compatible_types) && p.compatible_types.some((t) => t?.type === WEAPON_TYPE);

export function pilotGunSlots(ports, fixedWeapons) {
  const mounts = [];
  const walk = (list) => {
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p !== 'object') continue;
      const kids = Array.isArray(p.ports) ? p.ports.length : 0;
      // A hardware-locked gimbal still carries swappable guns, so the mount's own `editable` flag is not required.
      if (p.type === 'Turret' && !kids && holdsGun(p)) mounts.push(p);
      walk(p.ports);
    }
  };
  walk(ports);
  const names = (Array.isArray(fixedWeapons) ? fixedWeapons : []).map((w) => str(w?.name, 60));
  // Only trust the order when there is exactly one named gun per mount.
  const named = names.length === mounts.length && names.every(Boolean);
  const seen = new Set();
  const out = [];
  for (const m of mounts) {
    let id = str(m.name, 60) || 'gun';
    for (let n = 2; seen.has(id); n++) id = `${str(m.name, 60)}#${n}`;
    seen.add(id);
    const size = num(m.sizes?.max) ?? 0;
    out.push({ id, type: WEAPON_TYPE, min: num(m.sizes?.min) ?? size, max: size, stock: null, group: '', ...(named ? { stockName: names[out.length] } : {}) });
  }
  return out;
}

// Turret bases the wiki lists with no child ports and no gun type of their own (e.g. a Constellation's upper and lower
// turrets): the guns they carry only show up in `weaponry.fixed_weapons`, after the pilot guns are accounted for.
// When the leftover guns split evenly across the bases, each gets that many gun slots of the base's size.
export function baseTurretSlots(ports, fixedWeapons, pilotCount = 0) {
  const bases = [];
  const walk = (list) => {
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p !== 'object') continue;
      const kids = Array.isArray(p.ports) ? p.ports.length : 0;
      if (p.type === 'Turret' && !kids && !holdsGun(p) && num(p.sizes?.max) > 0) bases.push(p);
      walk(p.ports);
    }
  };
  walk(ports);
  const names = (Array.isArray(fixedWeapons) ? fixedWeapons : []).map((w) => str(w?.name, 60));
  const left = names.length - pilotCount;
  if (!bases.length || left < bases.length || left % bases.length) return [];
  const each = left / bases.length;
  // The leftover guns are the leading names only when they are one model and the rest differ; otherwise stay unnamed.
  const lead = names.slice(0, left);
  const sure = lead[0] && lead.every((n) => n === lead[0]) && names.slice(left).every((n) => n !== lead[0]);
  const out = [];
  for (const b of bases) {
    const hp = str(b.name, 60) || 'turret';
    const size = num(b.sizes.max);
    for (let i = 1; i <= each; i++) out.push({ id: `${hp}/mount_${i}`, type: WEAPON_TYPE, min: size, max: size, stock: null, group: hp, ...(sure ? { stockName: lead[0] } : {}) });
  }
  return out;
}

export function turretGunSlots(turrets, have = []) {
  const out = [];
  const taken = new Set(have.map((s) => s.id));
  for (const cat of ['manned', 'remote', 'pdc']) {
    for (const t of Array.isArray(turrets?.[cat]) ? turrets[cat] : []) {
      const hp = str(t?.hardpoint_name, 60);
      if (!hp || have.some((s) => s.id.startsWith(`${hp}/`))) continue; // its guns are already ordinary ports
      const mounts = Array.isArray(t.mounts) ? t.mounts : [];
      mounts.forEach((m, i) => {
        if (!(Array.isArray(m?.payload_types) && m.payload_types.some((x) => String(x).startsWith(WEAPON_TYPE)))) return;
        const mp = str(m.hardpoint_name, 60) || `mount_${i + 1}`;
        let id = `${hp}/${mp}`;
        for (let n = 2; taken.has(id); n++) id = `${hp}/${mp}#${n}`;
        taken.add(id);
        const size = num(m.weapon_sizes?.[0]) ?? num(m.payload_sizes?.[0]) ?? num(m.size) ?? 0;
        const gun = Array.isArray(t.weapons) && t.weapons.length === mounts.length ? t.weapons[i] : null;
        out.push({ id, type: WEAPON_TYPE, min: size, max: size, stock: str(gun?.uuid, 40) || null, group: hp });
      });
    }
  }
  return out;
}

// Stock parts that sit in the ship's slots, so parts the catalogue lacks can still be shown.
export function stockParts(ports, into = new Map()) {
  for (const p of Array.isArray(ports) ? ports : []) {
    if ((p?.editable || p?.type === 'MissileLauncher') && SLOT_TYPES.has(p.type) && p.equipped_item) {
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

// The ship's stock armament as the game data summarises it, kept apart from the swappable slots. It lets the page
// show what a ship carries even when its hardpoints could not be turned into gun slots.
export function slimArmament(v) {
  const w = v?.weaponry || {}, t = v?.turrets || {};
  const pilot = (Array.isArray(w.fixed_weapons?.weapons) ? w.fixed_weapons.weapons : []).slice(0, 12).map((x) => ({ name: str(x?.name, 60), dps: r2(x?.dps, 0) })).filter((x) => x.name);
  const turrets = [];
  for (const kind of ['manned', 'remote', 'pdc']) {
    for (const x of Array.isArray(t[kind]) ? t[kind] : []) {
      const mounts = Array.isArray(x?.mounts) ? x.mounts.length : 0;
      const gun = Array.isArray(x?.weapons) && x.weapons[0] ? str(x.weapons[0].name, 60) : '';
      turrets.push({ kind, mounts, gun, size: num(x?.size) ?? num(x?.mounts?.[0]?.weapon_sizes?.[0]) });
      if (turrets.length >= 16) break;
    }
  }
  return {
    pilot, turrets,
    pilotDps: r2(w.fixed_weapons?.dps_total ?? w.pilot_dps, 0),
    turretDps: r2(w.turret_dps ?? w.turrets?.dps_total ?? t.dps_total, 0),
    missiles: r2(w.missiles?.count, 0),
    gunners: num(v?.crew?.weapon)
  };
}

export function slimShip(v) {
  if (!v || typeof v !== 'object' || !v.uuid || !v.name) return null;
  const slots = collectSlots(v.ports);
  const pilot = pilotGunSlots(v.ports, v.weaponry?.fixed_weapons?.weapons);
  slots.push(...pilot);
  slots.push(...baseTurretSlots(v.ports, v.weaponry?.fixed_weapons?.weapons, pilot.length));
  slots.push(...turretGunSlots(v.turrets, slots));
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
    img: imgPath(v),
    buy: slimPrices(v.uex_prices),
    slots,
    stats: slimStats(v),
    arm: slimArmament(v),
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
  const guns = [...parts.values()].filter((p) => p.type === WEAPON_TYPE);
  const byId = new Map();
  for (const s of ships) {
    if (!s || !s.slots.length) continue;
    // Slots that only know their stock gun by name get its id from the catalogue (the same size and name).
    const slots = s.slots.map(({ stockName, ...slot }) => {
      if (slot.stock || !stockName) return slot;
      const hit = guns.find((p) => p.name === stockName && p.size >= slot.min && p.size <= slot.max);
      return { ...slot, stock: hit ? hit.id : null };
    });
    byId.set(s.id, { ...s, slots });
  }
  const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { schema: SCHEMA, version, updatedAt: new Date().toISOString(), source: 'Star Citizen Wiki API', ships: list, parts: [...parts.values()] };
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
    if (!force && snap && snap.version === version && snap.schema === SCHEMA && age < REBUILD_MS) return snap;
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
