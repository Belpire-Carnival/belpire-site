// Read-only audit of EVERY ship and ground vehicle in the wiki API, run through the builder's own code.
// It reports what the Avionics Lab would show wrongly or not at all: guns that stay "Unknown", guns missing from
// the catalogue, ships dropped for having no slots, armed ships with no gun slots, missing stats and pictures.
// Usage (from the belpire-site folder):  node ship-audit.mjs
// Writes ship-audit.txt (summary, attach this), ship-audit.csv (one row per ship) and ship-audit.json (details).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { WIKI_API, jobUrl, slimShip, slimPart, stockParts, buildSnapshot, withPictures, WEAPON_TYPE } from './worker/sc-builder.js';

const UA = 'BelpireCarnival/1.0 (audit)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CACHE = 'ship-audit-cache';
fs.mkdirSync(CACHE, { recursive: true });
async function get(path) {
  const file = `${CACHE}/${createHash('sha1').update(path).digest('hex')}.json`;
  if (fs.existsSync(file)) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* refetch */ } }
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(WIKI_API + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90000) });
      if (r.ok) { const json = await r.json(); fs.writeFileSync(file, JSON.stringify(json)); return json; }
      lastErr = new Error(`HTTP ${r.status}`);
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) { lastErr = e; }
    process.stderr.write(`\n  retry ${attempt} for ${path.split('?')[0]}: ${lastErr?.name || ''} ${lastErr?.message || ''}\n`);
    await sleep(2000 * attempt);
  }
  throw new Error(`${path.split('?')[0]}: ${lastErr?.message || 'failed'}. Run the command again; finished pages are kept.`);
}
async function pages(kind, size, each) {
  let page = 1, last = 1, n = 0;
  do {
    const json = await get(jobUrl({ kind, page, size }));
    const rows = Array.isArray(json?.data) ? json.data : [];
    for (const row of rows) each(row);
    n += rows.length;
    last = Number(json?.meta?.last_page) || page;
    process.stderr.write(`\r${kind}: page ${page}/${last} (${n} rows)   `);
    page++;
    await sleep(200);
  } while (page <= last);
  process.stderr.write('\n');
  return n;
}

const catalogue = [], stockMap = new Map(), slim = [], raw = new Map();
await pages('weapons', 50, (it) => { const p = slimPart(it); if (p) catalogue.push(p); });
await pages('parts', 50, (it) => { const p = slimPart(it); if (p) catalogue.push(p); });
for (const kind of ['ships', 'vehicles']) {
  await pages(kind, 20, (v) => {
    const s = slimShip(v);
    if (s && !raw.has(s.id)) { raw.set(s.id, v); slim.push(s); }
    stockParts(v?.ports, stockMap);
  });
}

const stock = [...stockMap.values()];
const hint = new Map(slim.map((s) => [s.id, new Map(s.slots.filter((x) => x.stockName).map((x) => [x.id, x.stockName]))]));
const snap = buildSnapshot('audit', slim, catalogue, stock);
const partIds = new Set(snap.parts.map((p) => p.id));
const partById = new Map(snap.parts.map((p) => [p.id, p]));
const built = new Set(snap.ships.map((s) => s.id));
const withPics = new Map(withPictures(snap.ships).map((s) => [s.id, s]));

const rows = [], dropped = [];
for (const s of slim) {
  const v = raw.get(s.id);
  const fixedList = Array.isArray(v?.weaponry?.fixed_weapons?.weapons) ? v.weaponry.fixed_weapons.weapons : [];
  const armed = (s.api?.pilotDps || 0) > 0 || (s.api?.turretDps || 0) > 0 || fixedList.length > 0 || (s.stats?.missiles?.count || 0) > 0;
  if (!built.has(s.id)) { dropped.push({ name: s.name, mfr: s.mfr, kind: s.kind, armed, fixedGuns: fixedList.length, hadSlots: s.slots.length }); continue; }
  const b = snap.ships.find((x) => x.id === s.id);
  const guns = b.slots.filter((x) => x.type === WEAPON_TYPE);
  const unresolved = guns.filter((x) => !x.stock).map((x) => `${x.id}${hint.get(s.id)?.get(x.id) ? ' [' + hint.get(s.id).get(x.id) + ']' : ''}`);
  const notInCatalogue = guns.filter((x) => x.stock && !partIds.has(x.stock)).map((x) => x.id);
  const st = b.stats || {};
  const missing = [];
  if (st.hull == null) missing.push('hull');
  if (st.armor?.hp == null) missing.push('armor');
  if (st.agility?.pitch == null) missing.push('agility');
  if (st.speed?.boostF == null) missing.push('boost');
  if (b.scm == null) missing.push('scm');
  const has = (t) => b.slots.some((x) => x.type === t);
  const gaps = [];
  if ((s.api?.shieldHp || 0) > 0 && !has('Shield')) gaps.push('shield-slot');
  if ((s.api?.powerSeg || 0) > 0 && !has('PowerPlant')) gaps.push('power-slot');
  if ((s.api?.coolSeg || 0) > 0 && !has('Cooler')) gaps.push('cooler-slot');
  const noGuns = armed && !guns.length && fixedList.length > 0;
  const fewer = fixedList.length > 0 && guns.length > 0 && guns.length < fixedList.length;
  rows.push({
    name: b.name, mfr: b.mfr, kind: b.kind, slots: b.slots.length, guns: guns.length, wikiFixedGuns: fixedList.length,
    unresolved: unresolved.length, unresolvedList: unresolved, notInCatalogue: notInCatalogue.length,
    noGunSlots: noGuns, fewerSlotsThanGuns: fewer, missing, gaps, noImg: !withPics.get(b.id)?.img
  });
}

const by = (f) => rows.filter(f);
const names = (list, extra = () => '') => list.map((r) => `${r.name}${extra(r)}`);
const section = (title, list, fmt) => [`\n== ${title}: ${list.length}`, ...list.slice(0, 80).map((x) => '  ' + fmt(x)), list.length > 80 ? `  ... and ${list.length - 80} more (see ship-audit.json)` : ''].filter(Boolean);
const out = [];
out.push(`Wiki records read: ${slim.length} ships and vehicles, ${catalogue.length} catalogue parts, ${stock.length} stock-only parts.`);
out.push(`Shown in the builder: ${snap.ships.length}. Dropped (no slots at all): ${dropped.length}.`);
const kinds = {};
for (const r of rows) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
out.push('Built, by kind: ' + JSON.stringify(kinds));
out.push(...section('Guns that would show "Unknown" (no stock gun found)', by((r) => r.unresolved), (r) => `${r.name} (${r.kind}): ${r.unresolved}/${r.guns} guns -> ${r.unresolvedList.slice(0, 8).join(', ')}`));
out.push(...section('Guns whose part is not in the catalogue', by((r) => r.notInCatalogue), (r) => `${r.name}: ${r.notInCatalogue} guns`));
out.push(...section('Armed but zero gun slots', by((r) => r.noGunSlots), (r) => `${r.name} (${r.kind}): wiki lists ${r.wikiFixedGuns} fixed guns`));
out.push(...section('Fewer gun slots than the wiki lists fixed guns', by((r) => r.fewerSlotsThanGuns), (r) => `${r.name}: ${r.guns} slots, wiki ${r.wikiFixedGuns}`));
out.push(...section('Dropped from the builder (no slots)', dropped, (d) => `${d.name} (${d.kind}) armed=${d.armed} fixedGuns=${d.fixedGuns}`));
out.push(...section('Missing stats', by((r) => r.missing.length), (r) => `${r.name} (${r.kind}): ${r.missing.join(', ')}`));
out.push(...section('Missing a slot the API says exists', by((r) => r.gaps.length), (r) => `${r.name} (${r.kind}): ${r.gaps.join(', ')}`));
out.push(...section('No picture', by((r) => r.noImg), (r) => `${r.name} (${r.kind})`));
fs.writeFileSync('ship-audit.txt', out.join('\n') + '\n');
fs.writeFileSync('ship-audit.json', JSON.stringify({ rows, dropped }, null, 1));
const csv = ['name,maker,kind,slots,guns,wiki_fixed_guns,unresolved_guns,not_in_catalogue,armed_no_gun_slots,fewer_slots,missing_stats,slot_gaps,no_picture',
  ...rows.map((r) => [r.name, r.mfr, r.kind, r.slots, r.guns, r.wikiFixedGuns, r.unresolved, r.notInCatalogue, r.noGunSlots, r.fewerSlotsThanGuns, r.missing.join('|'), r.gaps.join('|'), r.noImg].map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
fs.writeFileSync('ship-audit.csv', csv + '\n');
console.log(out.join('\n'));
console.log('\nWrote ship-audit.txt, ship-audit.csv, ship-audit.json (do not commit them; delete the ship-audit-cache folder too).');
