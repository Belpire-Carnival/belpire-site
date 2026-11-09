// Citizen Arsenal companion (DIV_RSI1). Everything you enter stays in this browser (localStorage); signed in with Discord, sync.js also saves it to your profile.
// Live prices come from our own /api/sc-market; nothing here calls a third-party site.
import C from './core.js';
import { initSync } from './sync.js';
import { initBuilder } from './builder.js';
import { icon, bars, duo } from './viz.js';
import { heroArt, photo } from './art.js';
import { STAT_GROUPS, STAT_KEYS } from './builder-core.js';
import { cleanImg } from './items.js';
import { initLoadouts } from './loadouts.js';
import { initOutfits } from './outfits.js';
import { normalize as normLoadout } from './loadouts.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') throw new Error('inline styles are not allowed; use a class');
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const money = (v) => `${C.fmt(v)} aUEC`;
const ls = {
  get(k, d) { try { const v = localStorage.getItem('arsenal.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('arsenal.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
async function copyText(text, box) {
  box.value = text; box.hidden = false;
  try { await navigator.clipboard.writeText(text); toast('Copied for Discord'); }
  catch { box.focus(); box.select(); toast('Select the text and copy it'); }
}

// ---------------- store: this browser only ----------------
const S = { settings: { calib: {}, body: 'HURSTON', loadout: '' }, fleet: [], runs: [], contracts: [] };
const Store = {
  listeners: [],
  onChange(fn) { this.listeners.push(fn); }, emit() { for (const f of this.listeners) f(); },
  init() {
    S.settings = { ...S.settings, ...ls.get('settings', {}) };
    S.settings.calib = { ...(S.settings.calib || {}) };
    S.fleet = ls.get('fleet', []); S.contracts = ls.get('contracts', []); S.runs = ls.get('runs', []);
    this.emit();
  },
  saveContracts() { S.contracts = S.contracts.slice(0, 150); ls.set('contracts', S.contracts); this.emit(); },
  saveSettings() { ls.set('settings', S.settings); },
  saveFleet() { ls.set('fleet', S.fleet); this.emit(); },
  addRun(run) {
    const at = Date.now();
    S.runs = [{ id: 'run-' + at, kind: 'run', at, ...run }, ...S.runs].slice(0, 500);
    ls.set('runs', S.runs); this.emit(); toast('Run logged in this browser');
  },
  delRun(id) { S.runs = S.runs.filter((r) => r.id !== id); ls.set('runs', S.runs); this.emit(); },
};

// ---------------- routing ----------------
const NAV = [
  ['Command', [['ops', 'OmniOps'], ['contracts', 'TacBoard'], ['log', 'OmniLog']]],
  ['Industry', [['salvage', 'Slag & Scrape'], ['mining', 'Extraction OS'], ['trade', 'OmniRoute'], ['cargo', 'GridMaster']]],
  ['Hangar & combat', [['calc', 'Avionics Lab'], ['combat', 'Ballistics Matrix'], ['fleet', 'Hangar Command']]],
  ['Reference', [['manual', 'Field Manual']]],
];
const VIEWS = NAV.flatMap(([, items]) => items);
const builder = initBuilder($('#builder'));
const nav = $('#nav');
for (const [group, items] of NAV) {
  nav.append(el('div', { class: 'grp', text: group }));
  for (const [id, label] of items) nav.append(el('a', { href: '#' + id, 'data-v': id }, icon(id), label));
}
for (const m of $$('[data-art]')) m.append(heroArt(m.dataset.art));
// Bottom bar: every module as an icon tab, the signed-in user pinned at the right end.
{
  const dock = $('#dock');
  const tabs = el('div', { class: 'dock-tabs', role: 'presentation' });
  for (const [id, label] of VIEWS) tabs.append(el('a', { href: '#' + id, 'data-d': id }, icon(id), el('span', { text: label })));
  dock.append(tabs, $('#acct'));
}
// Honest status line: what the page can actually tell about itself.
function paintStatus() {
  const online = navigator.onLine !== false;
  const live = (document.querySelector('[data-patch] b')?.textContent.match(/Alpha ([0-9.]+)/) || [])[1] || C.PATCH.version;
  const signed = !!document.querySelector('#acct .out, #acct [data-signed]') || /sign out/i.test($('#acct')?.textContent || '');
  $('#sysState').textContent = `[ KERNEL: ${live} // LINK: ${online ? 'ONLINE' : 'OFFLINE'} ]`;
  $('#ogSys').textContent = `SYS: FINTAC OMNIGLASS · ALPHA ${live}`;
  $('#ogLink').textContent = `LINK: ${online ? 'ONLINE' : 'OFFLINE'}`;
  $('#ogSync').textContent = `SYNC: ${signed ? 'PROFILE' : 'THIS BROWSER ONLY'}`;
  let n = 0; try { n = Object.keys(localStorage).filter((k) => k.startsWith('arsenal.')).length; } catch { /* storage blocked */ }
  $('#ogCache').textContent = `LOCAL CACHE: ${n ? 'NOMINAL' : 'EMPTY'}`;
}
window.addEventListener('online', paintStatus); window.addEventListener('offline', paintStatus);
setTimeout(paintStatus, 600); setInterval(paintStatus, 30000);
function setMenu(open) {
  const hd = $('header.top'), b = $('#menuBtn');
  hd.classList.toggle('open', open); b.setAttribute('aria-expanded', String(open));
}
$('#menuBtn').addEventListener('click', () => setMenu(!$('header.top').classList.contains('open')));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
function route() {
  const id = (location.hash || '#ops').slice(1).split('?')[0];
  const v = VIEWS.some(([k]) => k === id) ? id : 'ops';
  document.body.dataset.v = v;
  for (const s of $$('section.view')) s.classList.toggle('on', s.id === 'v-' + v);
  for (const d of $$('#dock a')) { if (d.dataset.d === v) { d.setAttribute('aria-current', 'page'); d.scrollIntoView({ inline: 'center', block: 'nearest' }); } else d.removeAttribute('aria-current'); }
  for (const a of $$('a[data-v]', nav)) { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  { const cur = $('a[data-v="' + v + '"]', nav); $('#menuNow').textContent = cur ? cur.textContent : 'Menu'; setMenu(false); }
  if (v === 'fleet') drawRadar();
  if (v === 'calc') builder.show();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
// The calculator hands finished builds to the hangar through this event.
window.addEventListener('arsenal:hangar-add', (e) => {
  const d = e.detail || {}; const name = String(d.name || '').slice(0, 60); if (!name) return;
  const ship = { name, role: String(d.role || '').slice(0, 40) };
  for (const k of ['scm', 'nav', 'pitch', 'yaw', 'roll', 'accel']) ship[k] = C.nOrNull(d[k]);
  // A build from the calculator also brings its whole stat sheet, a link back to the build and its picture.
  if (d.stats && typeof d.stats === 'object') {
    ship.stats = {};
    for (const k of STAT_KEYS) { const v = C.nOrNull(d.stats[k]); if (v != null) ship.stats[k] = v; }
  }
  if (typeof d.code === 'string' && /^[A-Za-z0-9_-]{1,3000}$/.test(d.code)) ship.code = d.code;
  if (Number.isFinite(Number(d.swaps))) ship.swaps = Math.max(0, Math.min(99, Math.floor(Number(d.swaps))));
  const pic = cleanImg(d.img); if (pic) ship.img = pic;
  S.fleet = [...S.fleet.filter((x) => x.name !== ship.name), ship].slice(0, 60);
  Store.saveFleet(); renderFleet(); toast('Saved to your fleet');
});
const P = C.PATCH;
function paintPatch(live) {
  for (const p of $$('[data-patch]')) {
    p.textContent = '';
    p.append('Applies to ', el('b', { text: `Alpha ${live || P.version} LIVE` }), live ? ' (per UEX)' : ` (verified ${P.verified})`);
  }
}
paintPatch(null);

// ---------------- field builder ----------------
function fields(container, defs, state, onInput) {
  container.textContent = '';
  for (const d of defs) {
    const inp = d.options
      ? el('select', { 'data-k': d.k }, ...d.options.map(([v, t]) => el('option', { value: v, text: t })))
      : el('input', { type: d.type || 'number', step: d.step || 'any', min: d.min ?? '0', placeholder: d.ph || '', 'data-k': d.k });
    inp.value = state[d.k] ?? '';
    inp.addEventListener('input', () => { state[d.k] = inp.value; onInput(); });
    container.append(el('label', { class: 'f' }, d.label, inp));
  }
}
function outs(container, items) {
  container.textContent = '';
  for (const [label, v, neg] of items) container.append(el('div', {}, el('div', { class: 'lbl', text: label }), el('div', { class: 'val' + (neg ? ' neg' : ''), text: v })));
}

// ---------------- VerseTime ----------------
const vtSel = $('#vtBody');
for (const b of C.BODIES) vtSel.append(el('option', { value: b.code, text: b.name + (b.P ? '' : ' (no data)') }));
vtSel.addEventListener('change', () => { S.settings.body = vtSel.value; Store.saveSettings(); tickVT(); });
$('#vtMark').addEventListener('click', () => {
  const b = C.BODIES.find((x) => x.code === vtSel.value);
  if (!b || !b.P) return toast('No day length for this body yet');
  S.settings.calib = { ...S.settings.calib, [b.code]: C.calibrateSunrise(Date.now(), b.P) };
  Store.saveSettings(); tickVT(); toast(b.name + ' calibrated to sunrise');
});
$('#vtReset').addEventListener('click', () => { const c = { ...S.settings.calib }; delete c[vtSel.value]; S.settings.calib = c; Store.saveSettings(); tickVT(); });
function tickVT() {
  const b = C.BODIES.find((x) => x.code === (S.settings.body || 'HURSTON')) || C.BODIES[0];
  if (vtSel.value !== b.code) vtSel.value = b.code;
  const off = S.settings.calib?.[b.code];
  const cal = $('#vtCal'); cal.textContent = off == null ? 'UNCAL' : 'CAL'; cal.className = 'chip ' + (off == null ? 'warn' : 'ok');
  cal.title = off == null ? 'Phase not calibrated: press "Sunrise now" when you see sunrise in game' : 'Calibrated by you';
  $('#vtLen').textContent = b.P ? C.dur(b.P) : 'NO DATA';
  const f = C.frac(Date.now(), b.P, off || 0);
  if (f == null) { $('#vtClock').textContent = 'NO DATA'; $('#vtPhase').textContent = '—'; $('#vtNext').textContent = '—'; return; }
  $('#vtClock').textContent = C.clock(f);
  $('#vtPhase').textContent = C.phase(f);
  const nx = C.next(f, b.P); $('#vtNext').textContent = `${nx.to} in ${C.dur(nx.s)}`;
}
let vtTimer = setInterval(tickVT, 1000);
document.addEventListener('visibilitychange', () => { clearInterval(vtTimer); if (!document.hidden) { tickVT(); vtTimer = setInterval(tickVT, 1000); } });

// ---------------- OPS ----------------
const PREFLIGHT = [
  'Check <a href="https://status.robertsspaceindustries.com/" target="_blank" rel="noopener">server status</a> before a long session.',
  'Check the live prices on the Trade and Salvage tabs, or on <a href="https://uexcorp.space/" target="_blank" rel="noopener">UEX</a>.',
  'Ship stocked: fuel, ammo, medpens, MedGel, repair canisters.',
  'Note your shard (<span class="mono">r_displaySessionInfo 1</span>) if you’re grouping up.',
  'Plan where you’ll sell or store before you log off.',
];
function checklist(ul, items, key) {
  const st = ls.get(key, {});
  ul.textContent = '';
  items.forEach((html, i) => {
    const cb = el('input', { type: 'checkbox', id: key + i });
    cb.checked = !!st[i];
    const t = el('label', { class: 't', for: key + i }); t.innerHTML = html;
    const li = el('li', { class: cb.checked ? 'done' : '' }, cb, t);
    cb.addEventListener('change', () => { st[i] = cb.checked; ls.set(key, st); li.classList.toggle('done', cb.checked); });
    ul.append(li);
  });
}
checklist($('#preflight'), PREFLIGHT, 'chk.preflight');
const LINKS = [
  ['Server status', 'https://status.robertsspaceindustries.com/'],
  ['Patch notes', 'https://robertsspaceindustries.com/patch-notes'],
  ['Spectrum (known issues)', 'https://robertsspaceindustries.com/spectrum/community/SC'],
  ['Commodity prices', 'https://uexcorp.space/'],
  ['Item finder', 'https://finder.cstone.space/'],
  ['Release tracker', 'https://scfocus.org/'],
];
for (const [t, u] of LINKS) $('#opsLinks').append(el('tr', {}, el('td', { text: t }), el('td', {}, el('a', { href: u, target: '_blank', rel: 'noopener', text: new URL(u).host }))));
function renderOps() {
  const now = Date.now(), day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const today = S.runs.filter((r) => r.at >= day0.getTime()), week = S.runs.filter((r) => r.at >= now - 7 * 864e5);
  const sum = (a) => a.reduce((s, r) => s + C.n(r.net), 0);
  $('#opsToday').textContent = money(sum(today));
  $('#opsTodaySub').textContent = today.length ? `${today.length} run${today.length > 1 ? 's' : ''} today` : 'No runs logged today';
  $('#opsWeek').textContent = money(sum(week));
  $('#opsWeekSub').textContent = week.length ? `${week.length} runs · salvage ${money(sum(week.filter((r) => r.activity === 'salvage')))}` : '—';
  const rated = S.runs.filter((r) => C.n(r.minutes) > 0).map((r) => ({ r, h: C.n(r.net) / (C.n(r.minutes) / 60) })).sort((a, b) => b.h - a.h);
  $('#opsBest').textContent = rated.length ? `${C.fmt(rated[0].h)} /h` : '—';
  $('#opsBestSub').textContent = rated.length ? `${rated[0].r.activity} · ${new Date(rated[0].r.at).toLocaleDateString()}` : 'Log runs with a duration to see aUEC/hour';
}

// ---------------- banners and charts ----------------
const ACTS = ['salvage', 'mining', 'trade', 'contract'];
const ACT_CLS = { salvage: 'info', mining: '', trade: 'ok', contract: 'warn' };
function renderHeroes() {
  const set = (k, v) => { for (const n of $$(`[data-k="${k}"]`)) n.textContent = v; };
  const rate = (rows) => { const t = rows.filter((r) => C.n(r.minutes) > 0); const m = t.reduce((a, r) => a + C.n(r.minutes), 0); return m > 0 ? `${C.fmt(t.reduce((a, r) => a + C.n(r.net), 0) / (m / 60))} /h` : '—'; };
  const best = (rows) => { const t = rows.filter((r) => C.n(r.minutes) > 0).map((r) => C.n(r.net) / (C.n(r.minutes) / 60)); return t.length ? `${C.fmt(Math.max(...t))} /h` : '—'; };
  const net = (rows) => rows.reduce((a, r) => a + C.n(r.net), 0);
  set('ops.runs', C.fmt(S.runs.length)); set('ops.net', money(net(S.runs))); set('ops.rate', rate(S.runs));
  for (const a of ['salvage', 'mining', 'trade']) {
    const rows = S.runs.filter((r) => r.activity === a);
    set(`${a}.runs`, C.fmt(rows.length)); set(`${a}.net`, money(net(rows))); set(`${a}.rate`, best(rows));
  }
  const open = S.contracts.filter((c) => c.status === 'new' || c.status === 'active');
  set('contracts.open', String(open.length)); set('contracts.payout', money(open.reduce((t, c) => t + C.n(c.payout), 0)));
  set('fleet.count', String(S.fleet.length));
  const mins = S.runs.reduce((a, r) => a + C.n(r.minutes), 0);
  set('log.runs', C.fmt(S.runs.length)); set('log.net', money(net(S.runs))); set('log.time', `${C.fmt(mins / 60, 1)} h`);

  // last 14 days, one bar per day
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push(d); }
  const items = days.map((d) => {
    const t0 = d.getTime(), t1 = t0 + 864e5;
    return { label: String(d.getDate()), value: Math.max(0, net(S.runs.filter((r) => r.at >= t0 && r.at < t1))) };
  });
  const chart = $('#opsChart'); if (chart) { chart.textContent = ''; chart.append(bars(items, { fmt: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)), empty: 'Log a run to see your days here' })); }
  const mix = ACTS.map((a) => ({ label: a, value: Math.max(0, net(S.runs.filter((r) => r.activity === a))), cls: ACT_CLS[a] }));
  const m1 = $('#opsMix'); if (m1) { m1.textContent = ''; m1.append(bars(mix, { fmt: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)), empty: 'No runs logged yet' })); }
  const m2 = $('#lgMix'); if (m2) { m2.textContent = ''; m2.append(bars(mix, { h: 130, fmt: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)), empty: 'No runs logged yet' })); }
  const hrs = ACTS.map((a) => {
    const rows = S.runs.filter((r) => r.activity === a && C.n(r.minutes) > 0), m = rows.reduce((t, r) => t + C.n(r.minutes), 0);
    return { label: a, value: m > 0 ? Math.max(0, Math.round(net(rows) / (m / 60))) : 0, cls: ACT_CLS[a] };
  });
  const m3 = $('#lgRate'); if (m3) { m3.textContent = ''; m3.append(bars(hrs, { h: 130, fmt: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)), empty: 'Log runs with a duration' })); }
}

// ---------------- SALVAGE ----------------
const SV_SHIPS = [
  { k: 'multitool', name: 'Multi-Tool + Cambio-Lite', note: 'On foot. Scrapes RMC into a canister. Slow and low volume, but needs no ship.' },
  { k: 'cambio', name: 'Cambio SRT', note: 'Handheld salvage tool. Hull scraping on foot; limited compared with ships.' },
  { k: 'salvation', name: 'RSI Salvation', note: 'Starter salvage ship. Onboard processing compacts recovered material into SCU containers automatically.' },
  { k: 'vulture', name: 'Drake Vulture', note: 'The solo salvager: one pilot finds, scrapes and stores RMC. Also does structural salvage.' },
  { k: 'reclaimer', name: 'Aegis Reclaimer', note: 'Industrial, multi-crew. Claw and disintegrator for structural salvage, far more storage. Overkill solo.' },
  { k: 'other', name: 'Other / newer hull', note: 'Check the patch notes and SPViewer for any salvage ship added after 4.10.2.' },
];
const SV_HEADS = [
  { k: 'abrade', name: 'Greycat Abrade', note: 'All-rounder.' },
  { k: 'cinch', name: 'Greycat Cinch', note: 'Higher extraction rate, slower per pass.' },
  { k: 'trawler', name: 'Greycat Trawler', note: 'Wide area of effect, but lower total RMC: heat burns off material.' },
];
const sv = ls.get('sv.inputs', { crew: 1 });
function picker(container, items, key, noteEl) {
  container.textContent = '';
  for (const it of items) {
    const b = el('button', { type: 'button', 'aria-pressed': String(sv[key] === it.k) }, el('b', { text: it.name }), it.note);
    b.addEventListener('click', () => { sv[key] = it.k; ls.set('sv.inputs', sv); picker(container, items, key, noteEl); calcSalvage(); });
    container.append(b);
  }
}
picker($('#svShips'), SV_SHIPS, 'ship');
picker($('#svHeads'), SV_HEADS, 'head');
const SV_STEPS = [
  '<b>Find a wreck:</b> salvage contracts, beacons, or derelicts you scan.',
  '<b>Scan the owner.</b> "Gamerules" means abandoned. A player name means hands off.',
  '<b>Shields or power on?</b> Distortion damage first: they block scraping.',
  '<b>Salvage mode</b> (default <span class="mono">M</span> in CIG’s guide; check your binds) and pick a scraper head.',
  '<b>Hull-scrape</b> into RMC. Work panels evenly; watch the beam’s heat.',
  '<b>Eject or box the RMC</b> before structural salvage: it shares the filler buffer.',
  '<b>Fracture, then disintegrate</b> the hull for raw construction material (Rubble, Pieces or Salvage).',
  '<b>Strip components and loose cargo</b>: sell, fit, or deliver them for contracts.',
  '<b>Refine</b> the construction material at a refinery station.',
  '<b>Sell:</b> RMC at TDD or scrapyards, Construction Materials at admin offices. Sell before logging off.',
];
checklist($('#svChecklist'), SV_STEPS, 'chk.salvage');
$('#svCheckReset').addEventListener('click', () => { ls.set('chk.salvage', {}); checklist($('#svChecklist'), SV_STEPS, 'chk.salvage'); });
const SV_FIELDS = [
  { k: 'minutes', label: 'Run time (min)' }, { k: 'crew', label: 'Crew', min: '1', step: '1' },
  { k: 'rmcScu', label: 'RMC (SCU)' }, { k: 'rmcPrice', label: 'RMC sell / SCU' },
  { k: 'cmRawScu', label: 'Raw constr. material (SCU)' }, { k: 'cmYield', label: 'Refinery yield %' },
  { k: 'cmPrice', label: 'Constr. Materials / SCU' }, { k: 'refineFee', label: 'Refinery fee' },
  { k: 'components', label: 'Components sold' }, { k: 'contract', label: 'Contract payout' },
  { k: 'expenses', label: 'Fuel, repair, ammo' },
];
fields($('#svFields'), SV_FIELDS, sv, () => { ls.set('sv.inputs', sv); calcSalvage(); });
let svLast;
function calcSalvage() {
  const r = svLast = C.salvage(sv);
  outs($('#svOut'), [
    ['RMC value', money(r.rmcValue)], ['Refined CM', `${C.fmt(r.cmRefined, 1)} SCU`], ['CM value', money(r.cmValue)],
    ['Gross', money(r.gross)], ['Costs', money(r.costs)], ['Net', money(r.net), r.net < 0],
    ['Per crew', money(r.perCrew), r.perCrew < 0], ['aUEC / hour', r.perHour == null ? '—' : C.fmt(r.perHour), r.perHour < 0],
    ['Per crew / hour', r.perCrewHour == null ? '—' : C.fmt(r.perCrewHour)],
  ]);
}
calcSalvage();
const shipName = (k) => (SV_SHIPS.find((s) => s.k === k) || {}).name;
$('#svLog').addEventListener('click', () => {
  const r = C.salvage(sv);
  if (!r.gross) return toast('Enter what you hauled first');
  Store.addRun({ activity: 'salvage', net: r.net, gross: r.gross, minutes: C.n(sv.minutes), crew: r.crew, ship: shipName(sv.ship) || null,
    head: (SV_HEADS.find((h) => h.k === sv.head) || {}).name || null, rmcScu: C.n(sv.rmcScu), cmRawScu: C.n(sv.cmRawScu), notes: $('#svNotes').value.slice(0, 500) });
  $('#svNotes').value = '';
});
function briefRun(title, lines) {
  return [`**${title}** — Bureau of Finality · Alpha ${P.version} LIVE`, ...lines.filter(Boolean).map((l) => `> ${l}`), '*Finem Ultimum Nos Afferimus.*'].join('\n');
}
$('#svBrief').addEventListener('click', () => {
  const r = C.salvage(sv);
  copyText(briefRun('Salvage Op Report', [
    shipName(sv.ship) && `Platform: ${shipName(sv.ship)}`,
    `RMC: ${C.fmt(C.n(sv.rmcScu))} SCU · Construction: ${C.fmt(C.n(sv.cmRawScu))} SCU raw → ${C.fmt(r.cmRefined, 1)} SCU refined`,
    `Net: ${money(r.net)} · Crew ${r.crew} · ${money(r.perCrew)} each`,
    r.perHour != null && `Rate: ${C.fmt(r.perHour)} aUEC/h over ${C.n(sv.minutes)} min`,
    $('#svNotes').value && `Notes: ${$('#svNotes').value}`,
  ]), $('#svBriefBox'));
});
const SV_PRICES = [
  ['Admin – Endgame', 'Pyro', 7700, '2026-09-02'], ['Admin – Patch City', 'Pyro', 7700, '2026-09-02'],
  ['Admin – Starlight Service', 'Pyro', 7700, '2026-09-02'], ['Admin – Ruin Station', 'Pyro', 7200, '2026-09-02'],
  ['TDD – Cloudview Center, Orison', 'Stanton', 7100, '2026-08-31'], ['CBD – Lorville', 'Stanton', 6800, '2026-08-31'],
  ['TDD – Commons, New Babbage', 'Stanton', 6000, '2026-08-31'],
];
for (const [l, s, p, d] of SV_PRICES) $('#svPrices').append(el('tr', {}, el('td', { text: l }), el('td', { text: s }), el('td', { class: 'num', text: C.fmt(p) }), el('td', { class: 'mono small muted', text: d })));
$('#svPrices').append(el('tr', {}, el('td', { colspan: '4', class: 'small muted' }, 'Source: timesaver.gg Alpha 4.10 salvage guide, priced on 4.10.0. ', el('a', { href: 'https://timesaver.gg/blog/star-citizen-salvage-guide-alpha-4-10', target: '_blank', rel: 'noopener', text: 'Open source' }))));

// ---------------- MINING ----------------
const mn = ls.get('mn.inputs', { crew: 1, lines: [{ ore: '', raw: '', yieldPct: '', price: '' }] });
function renderMnLines() {
  const tb = $('#mnLines'); tb.textContent = '';
  mn.lines.forEach((L, i) => {
    const mk = (k, type = 'number') => { const x = el('input', { type, step: 'any', min: '0', 'aria-label': k }); if (k === 'ore') x.setAttribute('list', 'oreList'); x.value = L[k] ?? ''; x.addEventListener('input', () => { L[k] = x.value; save(); }); return x; };
    const del = el('button', { class: 'ghost', type: 'button', 'aria-label': 'Remove line', text: '✕' });
    del.addEventListener('click', () => { mn.lines.splice(i, 1); if (!mn.lines.length) mn.lines.push({}); renderMnLines(); save(); });
    tb.append(el('tr', {}, el('td', {}, mk('ore', 'text')), el('td', {}, mk('raw')), el('td', {}, mk('yieldPct')), el('td', {}, mk('price')), el('td', {}, del)));
  });
  function save() { ls.set('mn.inputs', mn); calcMining(); }
}
$('#mnAdd').addEventListener('click', () => { mn.lines.push({ ore: '', raw: '', yieldPct: '', price: '' }); renderMnLines(); });
fields($('#mnFields'), [{ k: 'minutes', label: 'Session time (min)' }, { k: 'crew', label: 'Crew', min: '1', step: '1' },
  { k: 'fee', label: 'Refinery fee' }, { k: 'expenses', label: 'Other costs' }], mn, () => { ls.set('mn.inputs', mn); calcMining(); });
function calcMining() {
  const r = C.mining(mn.lines, mn);
  outs($('#mnOut'), [['Raw', `${C.fmt(r.raw, 1)} SCU`], ['Refined', `${C.fmt(r.refined, 1)} SCU`], ['Gross', money(r.gross)],
    ['Net', money(r.net), r.net < 0], ['Per crew', money(r.perCrew)], ['aUEC / hour', r.perHour == null ? '—' : C.fmt(r.perHour)]]);
  return r;
}
renderMnLines(); calcMining();
$('#mnLog').addEventListener('click', () => {
  const r = calcMining(); if (!r.gross) return toast('Enter at least one ore line');
  Store.addRun({ activity: 'mining', net: r.net, gross: r.gross, minutes: C.n(mn.minutes), crew: r.crew,
    ores: mn.lines.filter((l) => l.ore).map((l) => l.ore).join(', '), notes: $('#mnNotes').value.slice(0, 500) });
  $('#mnNotes').value = '';
});
$('#mnBrief').addEventListener('click', () => {
  const r = calcMining();
  copyText(briefRun('Mining Op Report', [
    `Ores: ${mn.lines.filter((l) => l.ore).map((l) => `${l.ore} ${C.fmt(C.n(l.raw), 1)} SCU`).join(' · ') || '—'}`,
    `Refined ${C.fmt(r.refined, 1)} SCU · Net ${money(r.net)} · Crew ${r.crew}`,
    r.perHour != null && `Rate: ${C.fmt(r.perHour)} aUEC/h`, $('#mnNotes').value && `Notes: ${$('#mnNotes').value}`,
  ]), $('#mnBriefBox'));
});

// ---------------- TRADE ----------------
const tr = ls.get('tr.inputs', { capital: '', hold: '', legs: [{}] });
fields($('#trFields'), [{ k: 'capital', label: 'Starting capital (aUEC)' }, { k: 'hold', label: 'Hold capacity (SCU)', step: '1' }],
  tr, () => { ls.set('tr.inputs', tr); calcTrade(); });
function renderLegs() {
  const tb = $('#trLegs'); tb.textContent = '';
  tr.legs.forEach((L, i) => {
    const mk = (k, type = 'number') => { const x = el('input', { type, step: 'any', min: '0', 'aria-label': k, class: type === 'text' ? 'w-text' : 'w-num' }); if (k === 'commodity') x.setAttribute('list', 'commList'); x.value = L[k] ?? ''; x.addEventListener('input', () => { L[k] = x.value; ls.set('tr.inputs', tr); calcTrade(); }); return x; };
    const del = el('button', { class: 'ghost', type: 'button', 'aria-label': 'Remove leg', text: '✕' });
    del.addEventListener('click', () => { tr.legs.splice(i, 1); if (!tr.legs.length) tr.legs.push({}); renderLegs(); ls.set('tr.inputs', tr); calcTrade(); });
    tb.append(el('tr', {}, el('td', {}, mk('commodity', 'text')), el('td', {}, mk('from', 'text')), el('td', {}, mk('buy')), el('td', {}, mk('to', 'text')),
      el('td', {}, mk('sell')), el('td', {}, mk('stock')), el('td', {}, mk('minutes')), el('td', { class: 'num', 'data-q': i }), el('td', { class: 'num', 'data-p': i }), el('td', {}, del)));
  });
  calcTrade();
}
$('#trAdd').addEventListener('click', () => { const last = tr.legs[tr.legs.length - 1] || {}; tr.legs.push({ from: last.to || '' }); renderLegs(); ls.set('tr.inputs', tr); });
function calcTrade() {
  const r = C.tradeChain(tr.capital, tr.hold, tr.legs);
  r.legs.forEach((L, i) => {
    const q = $(`[data-q="${i}"]`), p = $(`[data-p="${i}"]`);
    if (q) { q.textContent = C.fmt(L.qty); q.title = 'Limited by ' + L.limit; }
    if (p) { p.textContent = C.fmt(L.profit); p.classList.toggle('neg', L.profit < 0); }
  });
  outs($('#trOut'), [['Route profit', money(r.profit), r.profit < 0], ['End capital', money(r.endCapital)], ['Peak spend', money(r.peakSpend)],
    ['Total time', `${C.fmt(r.minutes)} min`], ['aUEC / hour', r.perHour == null ? '—' : C.fmt(r.perHour)]]);
  return r;
}
renderLegs();
$('#trLog').addEventListener('click', () => {
  const r = calcTrade(); if (!r.profit) return toast('Enter at least one priced leg');
  Store.addRun({ activity: 'trade', net: r.profit, minutes: r.minutes, route: tr.legs.map((l) => `${l.commodity || '?'} ${l.from || '?'}→${l.to || '?'}`).join(' | '), notes: $('#trNotes').value.slice(0, 500) });
  $('#trNotes').value = '';
});
$('#trBrief').addEventListener('click', () => {
  const r = calcTrade();
  copyText(briefRun('Trade Route Plan', [
    ...tr.legs.map((l, i) => `Leg ${i + 1}: ${C.fmt(r.legs[i].qty)} SCU ${l.commodity || '?'} — ${l.from || '?'} → ${l.to || '?'} (+${C.fmt(r.legs[i].profit)})`),
    `Capital ${money(C.n(tr.capital))} → ${money(r.endCapital)} · Hold ${C.fmt(C.n(tr.hold))} SCU`,
    r.perHour != null && `Rate: ${C.fmt(r.perHour)} aUEC/h over ${C.fmt(r.minutes)} min`, $('#trNotes').value && `Notes: ${$('#trNotes').value}`,
  ]), $('#trBriefBox'));
});
const hl = ls.get('hl.inputs', {});
fields($('#hlFields'), [{ k: 'payout', label: 'Contract payout' }, { k: 'scu', label: 'Cargo (SCU)' }, { k: 'minutes', label: 'Est. time (min)' }, { k: 'expenses', label: 'Costs' }],
  hl, () => { ls.set('hl.inputs', hl); calcHaul(); });
function calcHaul() { const r = C.hauling(hl); outs($('#hlOut'), [['Net', money(r.net)], ['Per SCU', r.perScu == null ? '—' : C.fmt(r.perScu)], ['aUEC / hour', r.perHour == null ? '—' : C.fmt(r.perHour)]]); }
calcHaul();

// ---------------- CARGO ----------------
const cg = ls.get('cg.inputs', { X: 4, Y: 8, Z: 2, counts: {} });
let grid = C.makeGrid(+cg.X || 1, +cg.Y || 1, +cg.Z || 1), selSize = 1, rot = false;
fields($('#cgFields'), [{ k: 'X', label: 'Width (cells)', step: '1', min: '1' }, { k: 'Y', label: 'Length (cells)', step: '1', min: '1' }, { k: 'Z', label: 'Height (cells)', step: '1', min: '1' }],
  cg, () => { ls.set('cg.inputs', cg); resetGrid(); });
fields($('#cgCounts'), C.SIZES.slice().reverse().map((s) => ({ k: String(s), label: `${s} SCU boxes`, step: '1' })), cg.counts, () => ls.set('cg.inputs', cg));
const pal = $('#cgPalette');
for (const s of C.SIZES.slice().reverse()) {
  const b = el('button', { type: 'button', 'aria-pressed': String(s === selSize), text: `${s} SCU` });
  b.addEventListener('click', () => { selSize = s; for (const x of $$('button', pal)) x.setAttribute('aria-pressed', String(x === b)); });
  pal.append(b);
}
$('#cgRot').addEventListener('click', (e) => { rot = !rot; e.currentTarget.setAttribute('aria-pressed', String(rot)); });
for (const s of C.SIZES.slice().reverse()) $('#cgLegend').append(el('span', {}, el('span', { class: 'sw s' + s }), `${s} SCU (${C.BOX[s].join('×')})`));
function resetGrid() {
  const X = Math.min(40, Math.max(1, Math.floor(C.n(cg.X)))), Y = Math.min(80, Math.max(1, Math.floor(C.n(cg.Y)))), Z = Math.min(10, Math.max(1, Math.floor(C.n(cg.Z))));
  grid = C.makeGrid(X, Y, Z); renderGrid();
}
let lastUnplaced = {};
$('#cgPack').addEventListener('click', () => { resetGrid(); lastUnplaced = C.autopack(grid, cg.counts); renderGrid(); });
$('#cgClear').addEventListener('click', () => { lastUnplaced = {}; resetGrid(); });
function renderGrid() {
  const L = $('#cgLayers'); L.textContent = '';
  const byId = new Map(grid.boxes.map((B) => [B.id, B]));
  const seq = C.sequence(grid), order = new Map(seq.map((B, i) => [B.id, i + 1]));
  for (let z = 0; z < grid.Z; z++) {
    const g = el('div', { class: 'layer', role: 'grid', 'aria-label': `Layer ${z + 1}` });
    g.style.setProperty('--cols', String(grid.X));
    for (let y = 0; y < grid.Y; y++) for (let x = 0; x < grid.X; x++) {
      const id = grid.occ[(z * grid.Y + y) * grid.X + x], B = byId.get(id);
      const c = el('div', { class: 'cell', role: 'gridcell', title: B ? `#${order.get(id)} · ${B.scu} SCU` : `x${x + 1} y${y + 1}` });
      if (B) { c.classList.add('s' + B.scu); if (B.x === x && B.y === y && B.z === z) c.textContent = order.get(id); }
      c.addEventListener('click', () => {
        if (B) C.remove(grid, id); else if (!C.place(grid, selSize, x, y, z, rot)) return toast('Doesn’t fit there (needs floor or boxes underneath)');
        renderGrid();
      });
      g.append(c);
    }
    L.append(el('div', {}, el('div', { class: 'lbl', text: `Layer ${z + 1}${z === 0 ? ' (floor)' : ''} · far end ↑ · door ↓` }), g));
  }
  const cap = grid.X * grid.Y * grid.Z, used = C.usedScu(grid);
  const miss = Object.entries(lastUnplaced).map(([s, c]) => `${c}×${s}`).join(', ');
  outs($('#cgOut'), [['Capacity', `${C.fmt(cap)} SCU`], ['Loaded', `${C.fmt(used)} SCU`], ['Fill', cap ? `${C.fmt(used / cap * 100, 1)}%` : '—'],
    ['Boxes', C.fmt(grid.boxes.length)], ['Didn’t fit', miss || 'none', !!miss]]);
  const ol = $('#cgSeq'); ol.textContent = '';
  for (const B of seq) ol.append(el('li', { text: `${B.scu} SCU @ x${B.x + 1} y${B.y + 1} L${B.z + 1}` }));
}
resetGrid();
$('#cgBrief').addEventListener('click', () => {
  const tally = {}; for (const B of grid.boxes) tally[B.scu] = (tally[B.scu] || 0) + 1;
  copyText(briefRun('Cargo Manifest', [
    `Grid ${grid.X}×${grid.Y}×${grid.Z} · Loaded ${C.usedScu(grid)} / ${grid.X * grid.Y * grid.Z} SCU`,
    `Boxes: ${Object.entries(tally).sort((a, b) => b[0] - a[0]).map(([s, c]) => `${c}×${s} SCU`).join(' · ') || 'none'}`,
    `Load order: far end first, bottom up (${grid.boxes.length} boxes)`,
  ]), $('#cgBriefBox'));
});

// ---------------- COMBAT ----------------
const tk = ls.get('tk.inputs', { mode: 'AUTO', pellets: 1, zone: 1, armor: { NONE: { phys: 1, energy: 1 }, LIGHT: {}, MEDIUM: {}, HEAVY: {} } });
fields($('#tkFields'), [
  { k: 'name', label: 'Weapon', type: 'text', ph: 'name' }, { k: 'phys', label: 'Physical dmg / projectile' }, { k: 'energy', label: 'Energy dmg / projectile' },
  { k: 'pellets', label: 'Projectiles / shot', step: '1', min: '1' }, { k: 'rpm', label: 'RPM' }, { k: 'mag', label: 'Magazine', step: '1' },
  { k: 'reload', label: 'Reload (s)' }, { k: 'mode', label: 'Fire mode', options: [['AUTO', 'Auto / single'], ['BURST', 'Burst']] },
  { k: 'burst', label: 'Shots / burst', step: '1' }, { k: 'cooldown', label: 'Burst cooldown (s)' },
  { k: 'hp', label: 'Target health' }, { k: 'zone', label: 'Hit-zone multiplier' },
], tk, () => { ls.set('tk.inputs', tk); calcTTK(); });
const AC = ['NONE', 'LIGHT', 'MEDIUM', 'HEAVY'];
for (const a of AC) {
  tk.armor[a] = tk.armor[a] || {};
  const mk = (k) => { const x = el('input', { type: 'number', step: '0.01', min: '0', 'aria-label': `${a} ${k}`, placeholder: '1.00' }); x.value = tk.armor[a][k] ?? ''; x.addEventListener('input', () => { tk.armor[a][k] = x.value; ls.set('tk.inputs', tk); calcTTK(); }); return x; };
  $('#tkArmor').append(el('tr', {}, el('td', { text: a[0] + a.slice(1).toLowerCase() }), el('td', {}, mk('phys')), el('td', {}, mk('energy'))));
}
function calcTTK() {
  const tb = $('#tkOut'); tb.textContent = '';
  let any = false;
  for (const a of AC) {
    const arm = { phys: tk.armor[a].phys === '' || tk.armor[a].phys == null ? 1 : tk.armor[a].phys, energy: tk.armor[a].energy === '' || tk.armor[a].energy == null ? 1 : tk.armor[a].energy };
    const r = C.ttk(tk, tk.hp, arm, tk.zone);
    if (r) any = true;
    tb.append(el('tr', {}, el('td', { text: a[0] + a.slice(1).toLowerCase() }), el('td', { class: 'num', text: r ? C.fmt(r.dmg, 1) : '—' }),
      el('td', { class: 'num', text: r ? r.shots : '—' }), el('td', { class: 'num', text: r ? r.reloads : '—' }), el('td', { class: 'num', text: r ? C.fmt(r.ttk, 2) : '—' })));
  }
  $('#tkFoot').textContent = any ? 'Assumes every shot lands in the chosen hit zone and the first shot fires at t = 0. Blank armor fields count as 1.00. Ballistic drag and damage falloff aren’t modelled.'
    : 'Enter damage, RPM and target health to fill the matrix.';
}
calcTTK();
const bd = ls.get('bd.inputs', { doses: [] });
fields($('#bdFields'), [{ k: 'perDose', label: 'BDL per dose' }, { k: 'decay', label: 'Decay per second' }, { k: 'overdose', label: 'Overdose threshold' }],
  bd, () => { ls.set('bd.inputs', bd); tickBDL(); });
$('#bdDose').addEventListener('click', () => { bd.doses = [...bd.doses.filter((t) => Date.now() - t < 6 * 3600e3), Date.now()]; ls.set('bd.inputs', bd); tickBDL(); });
$('#bdReset').addEventListener('click', () => { bd.doses = []; ls.set('bd.inputs', bd); tickBDL(); });
function tickBDL() {
  const lvl = C.bdl(bd.doses, bd.perDose, bd.decay, Date.now()), od = C.n(bd.overdose), dec = C.n(bd.decay);
  const clear = dec > 0 ? lvl / dec : null, toSafe = od > 0 && dec > 0 && lvl > od ? (lvl - od) / dec : 0;
  outs($('#bdOut'), [['Current BDL', C.fmt(lvl, 1), od > 0 && lvl >= od], ['Doses (6 h)', String(bd.doses.length)],
    ['Below threshold in', od > 0 ? (toSafe > 0 ? C.dur(toSafe) : 'now') : '—', toSafe > 0], ['Clear in', clear ? C.dur(clear) : '—']]);
}
setInterval(() => { if (!document.hidden && $('#v-combat').classList.contains('on')) tickBDL(); }, 1000);
tickBDL();
{
  const copyPlain = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } };
  initLoadouts($('#groundLoadouts'), { toast, copy: copyPlain });
  const readLoadouts = () => { try { const v = JSON.parse(localStorage.getItem('arsenal.loadouts')); return Array.isArray(v) ? v.map(normLoadout) : []; } catch { return []; } };
  initOutfits($('#wardrobe'), { toast, copy: copyPlain, getLoadouts: readLoadouts });
}
$('#loSave').addEventListener('click', () => { S.settings.loadout = $('#loNotes').value.slice(0, 4000); Store.saveSettings(); toast('Notes saved in this browser'); });
$('#loBrief').addEventListener('click', () => copyText(briefRun('Ground Loadout', $('#loNotes').value.split('\n').filter(Boolean)), $('#loBriefBox')));

// ---------------- FLEET ----------------
const fl = {};
fields($('#flFields'), [{ k: 'name', label: 'Ship', type: 'text', ph: 'e.g. Vulture' }, { k: 'role', label: 'Role', type: 'text' },
  { k: 'scm', label: 'SCM (m/s)' }, { k: 'nav', label: 'NAV (m/s)' }, { k: 'pitch', label: 'Pitch (°/s)' }, { k: 'yaw', label: 'Yaw (°/s)' },
  { k: 'roll', label: 'Roll (°/s)' }, { k: 'accel', label: 'Fwd accel (m/s²)' }], fl, () => {});
$('#flAdd').addEventListener('click', () => {
  const name = (fl.name || '').trim(); if (!name) return toast('Give the ship a name');
  const ship = { name: name.slice(0, 60), role: (fl.role || '').slice(0, 40) };
  for (const k of ['scm', 'nav', 'pitch', 'yaw', 'roll', 'accel']) ship[k] = C.nOrNull(fl[k]);
  S.fleet = [...S.fleet.filter((s) => s.name !== ship.name), ship].slice(0, 60);
  Store.saveFleet(); renderFleet(); toast('Ship saved');
});
// Axes of the flight and combat envelope. A value comes from a calculator build's stat sheet, or from the
// basic figures typed in by hand.
const AX = [['scm', 'SCM'], ['max', 'NAV'], ['burst', 'DPS'], ['shieldHp', 'Shield'], ['hull', 'Hull'], ['cargo', 'Cargo'], ['pitch', 'Pitch'], ['yaw', 'Yaw'], ['roll', 'Roll'], ['qtRange', 'QT range']];
const stat = (s, k) => { const v = s?.stats?.[k] ?? (k === 'max' ? s?.nav : s?.[k]); return C.nOrNull(v); };
// Right-click (or long-press) a ship to remove it. A small menu, no browser dialogs.
const ctxSheet = new CSSStyleSheet(); document.adoptedStyleSheets = [...document.adoptedStyleSheets, ctxSheet];
function ctxRemove(target, ship) {
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    for (const m of $$('.ctxmenu')) m.remove();
    const m = el('div', { class: 'ctxmenu', role: 'menu' });
    const del = el('button', { type: 'button', role: 'menuitem', class: 'danger', text: 'Remove ' + ship.name + ' from fleet' });
    const no = el('button', { type: 'button', role: 'menuitem', text: 'Cancel' });
    const close = () => { m.remove(); document.removeEventListener('pointerdown', away, true); };
    const away = (ev) => { if (!m.contains(ev.target)) close(); };
    del.addEventListener('click', () => { close(); S.fleet = S.fleet.filter((x) => x !== ship); Store.saveFleet(); renderFleet(); toast('Removed ' + ship.name); });
    no.addEventListener('click', close);
    m.append(del, no); document.body.append(m);
    const x = Math.max(8, Math.min(e.clientX, window.innerWidth - m.offsetWidth - 8)), y = Math.max(8, Math.min(e.clientY, window.innerHeight - m.offsetHeight - 8));
    ctxSheet.replaceSync(`.ctxmenu{left:${Math.round(x)}px;top:${Math.round(y)}px}`);
    document.addEventListener('pointerdown', away, true); del.focus();
  });
}
function renderFleet() {
  const tb = $('#flList'); tb.textContent = '';
  if (!S.fleet.length) tb.append(el('tr', {}, el('td', { colspan: '11', class: 'muted small', text: 'No ships yet. Save a build from the Calculator, or add one here.' })));
  for (const s of S.fleet) {
    const del = el('button', { class: 'ghost', type: 'button', text: '✕', 'aria-label': 'Remove ' + s.name });
    del.addEventListener('click', () => { S.fleet = S.fleet.filter((x) => x !== s); Store.saveFleet(); renderFleet(); });
    const open = s.code ? el('a', { class: 'btnlink', href: `#calc?b=${s.code}`, text: 'Open' }) : null;
    const nm = el('td', {}, el('div', { class: 'row' }, photo(s.img, '', el('span', { class: 'photo thumb none' }), 'photo thumb'), el('span', {}, el('b', { text: s.name }), s.swaps ? el('span', { class: 'chip', text: `${s.swaps} swap${s.swaps === 1 ? '' : 's'}` }) : null)));
    const row = el('tr', { title: 'Right-click to remove' }, nm, el('td', { class: 'num', text: C.fmt(stat(s, 'scm')) }), el('td', { class: 'num', text: C.fmt(stat(s, 'max')) }),
      el('td', { class: 'num', text: [s.pitch, s.yaw, s.roll].map((v) => C.fmt(v)).join(' / ') }), el('td', { class: 'num', text: C.fmt(stat(s, 'burst')) }),
      el('td', { class: 'num', text: C.fmt(stat(s, 'shieldHp')) }), el('td', { class: 'num', text: C.fmt(stat(s, 'hull')) }), el('td', { class: 'num', text: C.fmt(stat(s, 'cargo')) }),
      el('td', { class: 'small muted', text: s.role || '' }), el('td', {}, open), el('td', {}, del));
    ctxRemove(row, s); tb.append(row);
  }
  for (const [id, i] of [['#flA', 0], ['#flB', 1]]) {
    const sel = $(id), prev = sel.value; sel.textContent = '';
    for (const s of S.fleet) sel.append(el('option', { value: s.name, text: s.name }));
    sel.value = S.fleet.some((s) => s.name === prev) ? prev : (S.fleet[i] || S.fleet[0] || {}).name || '';
  }
  drawRadar();
}
$('#flA').addEventListener('change', drawRadar); $('#flB').addEventListener('change', drawRadar);
function drawRadar() {
  const svg = $('#flRadar'), NS = 'http://www.w3.org/2000/svg'; svg.textContent = '';
  const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); svg.append(e); return e; };
  const cx = 180, cy = 160, R = 110, N = AX.length;
  const pt = (i, r) => [cx + r * Math.sin((2 * Math.PI * i) / N), cy - r * Math.cos((2 * Math.PI * i) / N)];
  for (const f of [0.25, 0.5, 0.75, 1]) mk('polygon', { points: AX.map((_, i) => pt(i, R * f).join(',')).join(' '), fill: 'none', stroke: '#3a4658' });
  AX.forEach(([, lab], i) => { const [x, y] = pt(i, R); mk('line', { x1: cx, y1: cy, x2: x, y2: y, stroke: '#3a4658' }); const [tx, ty] = pt(i, R + 16); const t = mk('text', { x: tx, y: ty + 3, 'text-anchor': 'middle' }); t.textContent = lab; });
  const A = S.fleet.find((s) => s.name === $('#flA').value), B = S.fleet.find((s) => s.name === $('#flB').value);
  const ships = [[A, '#ffa94d'], [B, '#8fb4d8']].filter(([s]) => s);
  renderStatTable(ships.map(([s]) => s));
  if (!ships.length) { const t = mk('text', { x: cx, y: cy, 'text-anchor': 'middle' }); t.textContent = 'Add ships to compare'; return; }
  const max = AX.map(([k]) => Math.max(...ships.map(([s]) => C.n(stat(s, k))), 1e-9));
  for (const [s, col] of ships) {
    mk('polygon', { points: AX.map(([k], i) => pt(i, R * Math.min(1, C.n(stat(s, k)) / max[i])).join(',')).join(' '), fill: col, 'fill-opacity': '0.18', stroke: col, 'stroke-width': '2' });
  }
  ships.forEach(([s, col], i) => { mk('rect', { x: 20 + i * 170, y: 308, width: 10, height: 10, fill: col }); const t = mk('text', { x: 36 + i * 170, y: 317 }); t.textContent = s.name; });
}
// Every stat the two ships have, grouped, with a bar pair per row. Rows neither ship has a value for are left out.
function renderStatTable(ships) {
  const host = $('#flStats'); host.textContent = '';
  if (!ships.length) return;
  const [a, b] = ships;
  const head = (sh) => { const t = el('th', { class: 'num', text: sh.name, title: 'Right-click to remove' }); ctxRemove(t, sh); return t; };
  for (const [group, rows] of STAT_GROUPS) {
    const body = el('tbody');
    const thA = head(a), thB = b ? head(b) : null;
    for (const [k, label, better, unit] of rows) {
      const va = stat(a, k), vb = b ? stat(b, k) : null;
      if (va == null && vb == null) continue;
      const lead = va != null && vb != null && va !== vb ? ((va > vb) === better ? 'a' : 'b') : '';
      body.append(el('tr', {}, el('td', { text: label }), el('td', { class: `num ${lead === 'a' ? 'ok' : ''}`.trim(), text: va == null ? '—' : `${C.fmt(va, va % 1 ? 1 : 0)}${unit ? ' ' + unit : ''}` }),
        b ? el('td', { class: `num ${lead === 'b' ? 'ok' : ''}`.trim(), text: vb == null ? '—' : `${C.fmt(vb, vb % 1 ? 1 : 0)}${unit ? ' ' + unit : ''}` }) : null,
        b ? el('td', { class: 'w-num' }, duo(va ?? 0, vb ?? 0)) : null));
    }
    if (!body.childNodes.length) continue;
    host.append(el('h3', { class: 'mt12', text: group }), el('div', { class: 'scrollx' }, el('table', { class: 'cmp' }, el('thead', {}, el('tr', {}, el('th', { text: 'Stat' }), thA, thB, b ? el('th', { text: '' }) : null)), body)));
  }
}

// ---------------- MANUAL ----------------
const BUGS = [
  ['ASOP / hangar won’t spawn ship', 'Retrieve or store again at another terminal; claim if it shows destroyed; as a last resort, change location or relog.'],
  ['Freight elevator empty or stuck', 'Close and reopen the terminal, wait for the cycle, then request once. Spamming requests makes it worse.'],
  ['Inventory desync', 'Move items between local and station inventory to force a refresh; relog if items stay missing.'],
  ['30000 disconnect', 'Fully close the client before reconnecting. Loose cargo may be gone: sell or store it first next time.'],
  ['Tractor-beam physics launch', 'Lower tractor strength, keep boxes off moving ship decks, and don’t stand in the path of a released box.'],
  ['Invisible or stuck ship', 'Store and retrieve at an ASOP. If storing fails, claim it.'],
  ['Logging out safely', 'Log out in a ship bed far from points of interest, or at a hab. Sell or store loose cargo first.'],
];
for (const [b, w] of BUGS) $('#bugTable').append(el('tr', {}, el('td', {}, el('b', { text: b })), el('td', { class: 'small', text: w })));
const REFS = [
  ['Patch notes', 'https://robertsspaceindustries.com/patch-notes'], ['Issue Council', 'https://issue-council.robertsspaceindustries.com/'],
  ['Server status', 'https://status.robertsspaceindustries.com/'], ['Roadmap', 'https://robertsspaceindustries.com/roadmap'],
  ['Community wiki', 'https://starcitizen.tools/'], ['Item finder (CStone)', 'https://finder.cstone.space/'], ['Prices & refinery (UEX)', 'https://uexcorp.space/'],
  ['Trade routes', 'https://sc-trade.tools/'], ['Ship loadouts (Erkul)', 'https://www.erkul.games/'], ['Ship stats (SPViewer)', 'https://www.spviewer.eu/'],
  ['Mining (Regolith)', 'https://regolith.rocks/'], ['Fleet manager', 'https://fleetyards.net/'], ['Location guide', 'https://verseguide.com/'], ['Release tracker', 'https://scfocus.org/'],
];
for (const [t, u] of REFS) $('#refTable').append(el('tr', {}, el('td', { text: t }), el('td', {}, el('a', { href: u, target: '_blank', rel: 'noopener', text: new URL(u).host }))));

// ---------------- LOG ----------------
$('#lgFilter').addEventListener('change', renderLog);
function renderLog() {
  const f = $('#lgFilter').value, rows = S.runs.filter((r) => !f || r.activity === f);
  $('#lgStore').textContent = 'Saved in this browser only';
  const tot = rows.reduce((s, r) => s + C.n(r.net), 0), mins = rows.reduce((s, r) => s + C.n(r.minutes), 0);
  outs($('#lgTotals'), [['Runs', C.fmt(rows.length)], ['Net', money(tot), tot < 0], ['Time', `${C.fmt(mins / 60, 1)} h`], ['Avg aUEC / h', mins > 0 ? C.fmt(tot / (mins / 60)) : '—']]);
  const tb = $('#lgRows'); tb.textContent = '';
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: '7', class: 'muted small', text: 'Nothing logged yet. Use "Log run" in Salvage, Mining or Trade.' })));
  for (const r of rows.slice(0, 300)) {
    const ph = C.n(r.minutes) > 0 ? C.n(r.net) / (C.n(r.minutes) / 60) : null;
    const del = el('button', { class: 'ghost', type: 'button', text: '✕', 'aria-label': 'Delete run' });
    del.addEventListener('click', () => { if (del.dataset.armed) Store.delRun(r.id); else { del.dataset.armed = '1'; del.textContent = 'Delete?'; del.className = 'danger'; setTimeout(() => { del.dataset.armed = ''; del.textContent = '✕'; del.className = 'ghost'; }, 3000); } });
    const br = el('button', { class: 'ghost', type: 'button', text: '⧉', 'aria-label': 'Copy briefing' });
    br.addEventListener('click', () => copyText(briefRun(`${r.activity[0].toUpperCase() + r.activity.slice(1)} Op Report`, [
      r.ship && `Platform: ${r.ship}`, r.route && `Route: ${r.route}`, r.ores && `Ores: ${r.ores}`,
      `Net: ${money(C.n(r.net))}${r.crew > 1 ? ` · Crew ${r.crew}` : ''}`, ph != null && `Rate: ${C.fmt(ph)} aUEC/h`, r.notes && `Notes: ${r.notes}`]), $('#lgBriefBox')));
    tb.append(el('tr', {}, el('td', { class: 'mono small', text: new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }),
      el('td', { text: r.activity }), el('td', { class: 'num', text: C.fmt(C.n(r.net)) }), el('td', { class: 'num', text: C.fmt(C.n(r.minutes)) }),
      el('td', { class: 'num', text: ph == null ? '—' : C.fmt(ph) }), el('td', { class: 'small muted', text: [r.ship, r.route, r.ores, r.notes].filter(Boolean).join(' · ') }), el('td', {}, el('span', { class: 'row' }, br, del))));
  }
}

function setInputs(container, state, keys) {
  for (const k of keys) { const i = container.querySelector(`[data-k="${k}"]`); if (i) i.value = state[k] ?? ''; }
}

// ---------------- CONTRACTS ----------------
const CT_TYPES = ['HAULING', 'SALVAGE', 'MINING', 'BOUNTY', 'MERCENARY', 'DELIVERY', 'INVESTIGATION', 'RESCUE', 'ESCORT', 'RACING', 'OTHER'];
const CT_STATUS = [['new', 'Not started'], ['active', 'In progress'], ['done', 'Done'], ['failed', 'Failed'], ['abandoned', 'Abandoned']];
function normContract(c) {
  const s = (v, n = 160) => (v == null ? null : String(v).slice(0, n));
  const arr = (a, n = 12) => (Array.isArray(a) ? a.filter(Boolean).slice(0, n).map((x) => String(x).slice(0, 200)) : []);
  const type = String(c.type || 'OTHER').toUpperCase();
  return {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), status: 'new', addedAt: Date.now(),
    title: s(c.title, 120) || 'Untitled contract', type: CT_TYPES.includes(type) ? type : 'OTHER', giver: s(c.giver, 80),
    payout: C.nOrNull(c.payout), bonus: s(c.bonus), reputation: s(c.reputation, 80), deadline: s(c.deadline, 80),
    maxContainerScu: C.nOrNull(c.maxContainerScu), totalScu: C.nOrNull(c.totalScu), threat: s(c.threat, 80),
    cargo: (Array.isArray(c.cargo) ? c.cargo : []).slice(0, 20).map((g) => ({ commodity: s(g && g.commodity, 60) || '?', scu: C.nOrNull(g && g.scu), from: s(g && g.from, 80), to: s(g && g.to, 80) })),
    locations: arr(c.locations), objectives: arr(c.objectives), requirements: arr(c.requirements, 8),
  };
}
const cargoTotal = (c) => c.totalScu ?? (c.cargo.reduce((t, g) => t + C.n(g.scu), 0) || null);
function contractBody(c) {
  const box = el('div');
  box.append(el('div', { class: 'row between' }, el('b', { text: c.title }),
    el('span', { class: 'row' }, el('span', { class: 'chip', text: c.type }), c.payout != null ? el('span', { class: 'mono pay', text: money(c.payout) }) : null)));
  const meta = [c.giver, c.deadline && '⏱ ' + c.deadline, c.reputation && 'Rep: ' + c.reputation, c.threat && 'Threat: ' + c.threat, c.maxContainerScu && `Max box ${c.maxContainerScu} SCU`, c.bonus && 'Bonus: ' + c.bonus].filter(Boolean);
  if (meta.length) box.append(el('div', { class: 'small muted', text: meta.join(' · ') }));
  if (c.cargo.length) {
    const tb = el('tbody'); for (const g of c.cargo) tb.append(el('tr', {}, el('td', { text: g.commodity }), el('td', { class: 'num', text: g.scu == null ? '—' : C.fmt(g.scu, 2) }), el('td', { class: 'small', text: `${g.from || '?'} → ${g.to || '?'}` })));
    box.append(el('table', { class: 'mt6' }, tb));
  }
  if (c.objectives.length) box.append(el('ul', { class: 'tight small mt6' }, ...c.objectives.map((o) => el('li', { text: o }))));
  if (c.requirements.length) box.append(el('div', { class: 'small muted', text: 'Needs: ' + c.requirements.join(' · ') }));
  if (!c.cargo.length && c.locations.length) box.append(el('div', { class: 'small muted', text: 'Places: ' + c.locations.join(' · ') }));
  return box;
}
$('#ctFilter').addEventListener('change', renderContracts);
$('#ctManual').addEventListener('click', () => { S.contracts = [normContract({ title: 'New contract', type: 'OTHER' }), ...S.contracts]; Store.saveContracts(); });
function renderContracts() {
  const f = $('#ctFilter').value, open = (c) => c.status === 'new' || c.status === 'active';
  const list = S.contracts.filter((c) => f === 'all' || (f === 'open' ? open(c) : c.status === 'done'));
  const op = S.contracts.filter(open);
  outs($('#ctTotals'), [['Open contracts', String(op.length)], ['Open payout', money(op.reduce((t, c) => t + C.n(c.payout), 0))],
    ['Cargo to move', `${C.fmt(op.reduce((t, c) => t + C.n(cargoTotal(c)), 0), 1)} SCU`], ['Done (all time)', String(S.contracts.filter((c) => c.status === 'done').length)]]);
  const wrap = $('#ctList'); wrap.textContent = '';
  if (!list.length) { wrap.append(el('p', { class: 'small muted', text: f === 'open' ? 'No open contracts. Scan one above.' : 'Nothing here yet.' })); return; }
  for (const c of list.slice(0, 80)) {
    const card = el('div', { class: 'card' + (c.status === 'active' ? ' accent' : '') });
    const title = el('input', { type: 'text', value: c.title, 'aria-label': 'Title', class: 'plain' });
    title.addEventListener('change', () => { c.title = title.value.slice(0, 120); Store.saveContracts(); });
    const pay = el('input', { type: 'number', step: 'any', value: c.payout ?? '', 'aria-label': 'Payout', class: 'w-pay' });
    pay.addEventListener('change', () => { c.payout = C.nOrNull(pay.value); Store.saveContracts(); });
    const type = el('select', { 'aria-label': 'Type', class: 'auto' },...CT_TYPES.map((t) => el('option', { value: t, text: t })));
    type.value = c.type; type.addEventListener('change', () => { c.type = type.value; Store.saveContracts(); });
    const st = el('select', { 'aria-label': 'Status', class: 'auto' },...CT_STATUS.map(([v, t]) => el('option', { value: v, text: t })));
    st.value = c.status;
    st.addEventListener('change', () => { c.status = st.value; if (c.status === 'active' && !c.startedAt) c.startedAt = Date.now(); Store.saveContracts(); });
    const acts = el('div', { class: 'row mt8' });
    const go = (label, fn) => { const b = el('button', { type: 'button', class: 'ghost', text: label }); b.addEventListener('click', fn); acts.append(b); };
    const tot = cargoTotal(c);
    if (tot) go('Plan cargo', () => {
      const counts = C.boxesFor(tot, c.maxContainerScu);
      for (const s of C.SIZES) cg.counts[s] = counts[s] ? String(counts[s]) : '';
      ls.set('cg.inputs', cg); setInputs($('#cgCounts'), cg.counts, C.SIZES.map(String)); location.hash = '#cargo'; toast(`Boxes for ${C.fmt(tot)} SCU: press Auto-pack`);
    });
    if (c.type === 'HAULING' || c.type === 'DELIVERY') go('Profit check', () => {
      Object.assign(hl, { payout: c.payout ?? '', scu: tot ?? '' }); ls.set('hl.inputs', hl); setInputs($('#hlFields'), hl, ['payout', 'scu']); calcHaul(); location.hash = '#trade';
    });
    if (c.type === 'SALVAGE') go('Add to salvage run', () => { sv.contract = c.payout ?? ''; ls.set('sv.inputs', sv); setInputs($('#svFields'), sv, ['contract']); calcSalvage(); location.hash = '#salvage'; toast('Payout added. Log it from Salvage, not here'); });
    if (c.status !== 'done') go('Complete & log', () => {
      const mins = c.startedAt ? Math.max(1, Math.round((Date.now() - c.startedAt) / 60000)) : 0;
      c.status = 'done'; c.doneAt = Date.now(); Store.saveContracts();
      Store.addRun({ activity: 'contract', contractType: c.type, net: C.n(c.payout), minutes: mins, notes: c.title.slice(0, 200) });
    });
    const del = el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': 'Delete contract' });
    del.addEventListener('click', () => { if (del.dataset.armed) { S.contracts = S.contracts.filter((x) => x.id !== c.id); Store.saveContracts(); } else { del.dataset.armed = '1'; del.textContent = 'Delete?'; del.className = 'danger'; setTimeout(() => { del.dataset.armed = ''; del.textContent = '✕'; del.className = 'ghost'; }, 3000); } });
    acts.append(del);
    card.append(el('div', { class: 'row' }, title), el('div', { class: 'row mt6' }, type, st, el('span', { class: 'small muted', text: 'aUEC' }), pay));
    const body = contractBody(c); body.firstChild.remove(); card.append(body, acts);
    if (c.startedAt && c.status === 'active') card.append(el('div', { class: 'small muted', text: 'Started ' + new Date(c.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ': the clock feeds aUEC/h when you complete it.' }));
    wrap.append(card);
  }
}


// ---------------- LIVE DATA (our own Worker; nothing leaves this origin) ----------------
const MK = { enabled: false, prices: [], updatedAt: null, version: null, partial: false, byName: new Map() };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const DAY = 864e5;
const tsMs = (t) => (t == null ? null : t < 1e12 ? t * 1000 : t);
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const STALE_ROW_MS = 14 * DAY;

function indexMarket() {
  MK.byName = new Map();
  const now = Date.now();
  for (const r of MK.prices) {
    const t = tsMs(r.at);
    if (t != null && now - t > STALE_ROW_MS) continue; // old community submissions skew "best" prices
    const key = norm(r.commodity);
    let c = MK.byName.get(key);
    if (!c) MK.byName.set(key, (c = { name: r.commodity, buys: [], sells: [] }));
    if (r.buy) c.buys.push(r);
    if (r.sell) c.sells.push(r);
  }
  for (const c of MK.byName.values()) { c.buys.sort((a, b) => a.buy - b.buy); c.sells.sort((a, b) => b.sell - a.sell); }
}
const where = (r) => [r.terminal, r.system].filter(Boolean).join(' · ');

function routesFromMarket() {
  const out = [];
  for (const c of MK.byName.values()) {
    const b = c.buys[0], s = c.sells.find((x) => !b || x.terminal !== b.terminal);
    if (b && s && s.sell > b.buy) out.push({ commodity: c.name, from: b, to: s, margin: s.sell - b.buy });
  }
  return out.sort((a, b) => b.margin - a.margin);
}

function paintLiveChip() {
  const chip = $('#mkChip'), line = $('#mkLine');
  if (!MK.enabled) { chip.textContent = 'MANUAL'; chip.className = 'chip warn'; line.textContent = 'Live prices are not switched on yet. Enter prices by hand.'; return; }
  if (!MK.prices.length) { chip.textContent = 'WAITING'; chip.className = 'chip warn'; line.textContent = 'Live prices are on but no data has arrived yet. Try again in a few minutes.'; return; }
  chip.textContent = 'LIVE'; chip.className = 'chip ok';
  line.textContent = `Prices from UEX, updated ${ago(MK.updatedAt)}${MK.partial ? ' (last refresh was partial)' : ''}.`;
}

function renderRoutes() {
  const wrap = $('#mkRoutes'); wrap.textContent = '';
  const q = norm($('#mkSearch').value);
  const list = routesFromMarket().filter((r) => !q || norm(r.commodity).includes(q)).slice(0, q ? 12 : 10);
  if (!MK.prices.length) { wrap.append(el('p', { class: 'small muted', text: 'No live data yet.' })); return; }
  if (!list.length) { wrap.append(el('p', { class: 'small muted', text: 'No profitable buy/sell pair found for that search.' })); return; }
  const tb = el('tbody');
  for (const r of list) {
    const use = el('button', { type: 'button', class: 'ghost', text: 'Use as leg' });
    use.addEventListener('click', () => {
      const leg = { commodity: r.commodity, from: r.from.terminal, buy: r.from.buy, to: r.to.terminal, sell: r.to.sell };
      if (tr.legs.length === 1 && !Object.values(tr.legs[0]).some(Boolean)) tr.legs[0] = leg; else tr.legs.push(leg);
      ls.set('tr.inputs', tr); renderLegs(); toast('Leg added: check the price in game before you buy');
    });
    tb.append(el('tr', {}, el('td', { text: r.commodity }), el('td', { class: 'small', text: where(r.from) }), el('td', { class: 'num', text: C.fmt(r.from.buy) }),
      el('td', { class: 'small', text: where(r.to) }), el('td', { class: 'num', text: C.fmt(r.to.sell) }), el('td', { class: 'num pay', text: C.fmt(r.margin) }), el('td', {}, use)));
  }
  wrap.append(el('div', { class: 'scrollx' }, el('table', {},
    el('thead', {}, el('tr', {}, ...['Commodity', 'Buy at', 'Buy / SCU', 'Sell at', 'Sell / SCU', 'Margin / SCU', ''].map((h, i) => el('th', { class: i === 2 || i === 4 || i === 5 ? 'num' : '', text: h })))), tb)));
}

// Top sell points for commodities matching a pattern, with a "use this price" button (Salvage tab).
function sellList(container, pattern, onUse) {
  container.textContent = '';
  const rows = [];
  for (const [k, c] of MK.byName) if (pattern.test(k)) for (const r of c.sells.slice(0, 5)) rows.push({ c: c.name, r });
  if (!rows.length) { container.append(el('p', { class: 'small muted', text: MK.prices.length ? 'No recent sell prices for this commodity.' : 'No live data yet.' })); return; }
  const tb = el('tbody');
  for (const { c, r } of rows.sort((a, b) => b.r.sell - a.r.sell).slice(0, 6)) {
    const use = el('button', { type: 'button', class: 'ghost', text: 'Use' });
    use.addEventListener('click', () => onUse(r.sell));
    tb.append(el('tr', {}, el('td', { text: c }), el('td', { class: 'small', text: where(r) }), el('td', { class: 'num', text: C.fmt(r.sell) }), el('td', {}, use)));
  }
  container.append(el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Commodity' }), el('th', { text: 'Pays at' }), el('th', { class: 'num', text: 'aUEC / SCU' }), el('th'))), tb));
}
function renderSalvageLive() {
  sellList($('#svLiveRmc'), /^recycled material composite$|^rmc$/, (p) => { sv.rmcPrice = p; ls.set('sv.inputs', sv); setInputs($('#svFields'), sv, ['rmcPrice']); calcSalvage(); toast('RMC price set'); });
  sellList($('#svLiveCm'), /^construction materials?$/, (p) => { sv.cmPrice = p; ls.set('sv.inputs', sv); setInputs($('#svFields'), sv, ['cmPrice']); calcSalvage(); toast('Construction Materials price set'); });
}

function fillOreList() {
  const dl = $('#oreList'); dl.textContent = '';
  for (const c of [...MK.byName.values()].sort((a, b) => a.name.localeCompare(b.name))) dl.append(el('option', { value: c.name }));
  const dl2 = $('#commList'); dl2.textContent = '';
  for (const c of [...MK.byName.values()].sort((a, b) => a.name.localeCompare(b.name))) dl2.append(el('option', { value: c.name }));
}
$('#mnLive').addEventListener('click', () => {
  let hit = 0;
  for (const L of mn.lines) {
    const c = MK.byName.get(norm(L.ore));
    if (c && c.sells[0]) { L.price = c.sells[0].sell; hit++; }
  }
  ls.set('mn.inputs', mn); renderMnLines(); calcMining();
  toast(hit ? `Filled ${hit} price${hit > 1 ? 's' : ''} with the best live sell price` : 'No ore name matched a live commodity. Pick names from the list.');
});

// Patch + network status from the Worker's existing snapshot
const SUMMARY = { operational: 'RSI services: operational', degraded: 'RSI services: degraded', down: 'RSI services: outage', maintenance: 'RSI services: maintenance', notice: 'RSI services: notice posted', unknown: 'RSI services: unknown' };
async function loadStatus() {
  try {
    const r = await fetch('/api/star-citizen', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    const s = j.status?.summary || 'unknown';
    $('#rsiState').textContent = SUMMARY[s] || SUMMARY.unknown;
    $('#rsiState').className = 'chip ' + (s === 'operational' ? 'ok' : s === 'unknown' ? '' : 'warn');
    $('#newsList').textContent = '';
    for (const n of (j.news || []).slice(0, 5)) {
      const a = el('a', { href: n.url, target: '_blank', rel: 'noopener', text: n.title });
      if (/^https:\/\//.test(n.url || '')) $('#newsList').append(el('li', {}, a)); 
    }
  } catch { $('#rsiState').textContent = 'RSI services: unavailable'; $('#rsiState').className = 'chip'; }
}

async function loadMarket() {
  try {
    const r = await fetch('/api/sc-market', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    const j = await r.json();
    MK.enabled = !!j.enabled; MK.prices = Array.isArray(j.prices) ? j.prices : []; MK.updatedAt = j.updatedAt || null; MK.version = j.version || null; MK.partial = !!j.partial;
  } catch { MK.enabled = false; MK.prices = []; }
  indexMarket(); paintLiveChip(); paintPatch(MK.version); renderRoutes(); renderSalvageLive(); fillOreList();
}
$('#mkSearch').addEventListener('input', renderRoutes);

// Ship lookup (Star Citizen Wiki API through our Worker). Only fields actually found are filled.
const dig = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const pickNum = (o, paths) => { for (const p of paths) { const v = dig(o, p); if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v; } return null; };
const SHIP_PATHS = {
  scm: ['speed.scm', 'scm_speed', 'scm'], nav: ['speed.max', 'speed.nav', 'nav_speed', 'max_speed'],
  pitch: ['agility.pitch', 'pitch'], yaw: ['agility.yaw', 'yaw'], roll: ['agility.roll', 'roll'],
};
$('#flLookup').addEventListener('click', async () => {
  const name = String(fl.name || '').trim();
  if (name.length < 2) return toast('Type a ship name first');
  try {
    const r = await fetch('/api/sc-ship?name=' + encodeURIComponent(name), { headers: { Accept: 'application/json' } });
    const j = await r.json();
    if (!r.ok || !j.ship) return toast(r.ok ? 'No ship by that name in the database' : 'Ship database is unavailable right now');
    const found = {};
    for (const [k, paths] of Object.entries(SHIP_PATHS)) { const v = pickNum(j.ship, paths); if (v != null) found[k] = v; }
    if (typeof j.ship.name === 'string') found.name = j.ship.name.slice(0, 60);
    const stats = Object.keys(found).filter((k) => k !== 'name');
    if (!stats.length) return toast('Found the ship but no flight stats I could read. Enter them from SPViewer.');
    Object.assign(fl, found); setInputs($('#flFields'), fl, Object.keys(found));
    toast(`Filled ${stats.join(', ')} from the Star Citizen Wiki. Check units against SPViewer, then Save ship.`);
  } catch { toast('Could not reach the ship database'); }
});

loadStatus(); loadMarket();
setInterval(() => { if (!document.hidden) { loadMarket(); loadStatus(); } }, 10 * 60 * 1000);

// ---------------- SCREENSHOT / CLIP SCANNER (our own Worker reads the image; see /api/sc-scan) ----------------
const MAX_SCAN_IMAGES = 4;
const scanners = [];
const SCAN_ERRORS = {
  rate_limited: 'You have used today’s scans. Try again tomorrow, or type the numbers in.',
  busy: 'The scanner has reached its daily limit for everyone. Try again tomorrow, or type the numbers in.',
  unavailable: 'Scanning is switched off right now. Type the numbers in instead.',
  too_large: 'That image is too big even after shrinking. Crop to just the panel.',
  bad_image: 'That file couldn’t be read. Use a PNG, JPG or WebP screenshot, or an MP4/WebM clip.',
  unreadable: 'The scanner couldn’t turn that into data. Try a tighter crop of just the panel.',
  scan_failed: 'The scan failed. Try again in a minute.',
  forbidden: 'Scanning only works from this page.',
};
const scanErr = (e) => (e && e.clip) || SCAN_ERRORS[e && e.code] || 'The scan failed. Try again.';

// Shrink to a JPEG small enough for the scan limit (about 1.5 MB each) while keeping text readable.
async function toJpeg(src, w, h, name) {
  for (const [maxSide, q] of [[1600, 0.85], [1280, 0.8], [1024, 0.7]]) {
    const k = Math.min(1, maxSide / Math.max(w, h));
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    const b = await new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
    if (b && b.size <= 1_400_000) return new File([b], name, { type: 'image/jpeg' });
  }
  throw { code: 'too_large' };
}
async function imageToJpeg(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw { code: 'bad_image' }; }
  try { return await toJpeg(bmp, bmp.width, bmp.height, 'shot.jpg'); } finally { bmp.close(); }
}
async function framesFromClip(file, count) {
  const url = URL.createObjectURL(file);
  // Only ever play a blob: URL we just made from the visitor's own file; never a page-supplied string.
  if (!url.startsWith('blob:')) throw { clip: 'This clip can’t be read here.' };
  const v = el('video', { src: url, preload: 'auto' });
  v.muted = true; v.playsInline = true;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej({ clip: 'This clip’s format can’t be decoded here. Use MP4 (H.264) or WebM.' }); });
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0 || !v.videoWidth) throw { clip: 'Couldn’t read the clip’s length.' };
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(dur - 0.05, dur * (i + 0.5) / count);
      await new Promise((res) => { v.onseeked = res; v.currentTime = Math.max(0, t); });
      out.push(await toJpeg(v, v.videoWidth, v.videoHeight, `frame${i + 1}.jpg`));
    }
    return out;
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); }
}

function scanner(hostSel, cfg) {
  const host = $(hostSel); if (!host) return null;
  const box = el('div', { class: 'scan', tabindex: '0', 'aria-label': 'Screenshot scanner: ' + cfg.title });
  const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,video/mp4,video/webm', multiple: '', hidden: '' });
  const pick = el('button', { type: 'button', class: 'ghost', text: 'Pick file' });
  const go = el('button', { type: 'button', class: 'primary', text: 'Scan' });
  const stop = el('button', { type: 'button', class: 'ghost', text: 'Stop', hidden: '' });
  const clr = el('button', { type: 'button', class: 'ghost', text: 'Clear' });
  const status = el('div', { class: 'small muted mt6', role: 'status' }), thumbs = el('div', { class: 'thumbs' }), res = el('div', { class: 'scanres' });
  box.append(el('div', { class: 'hd' },
    el('div', {}, el('b', { text: 'Scan · ' + cfg.title }), el('div', { class: 'small muted', text: cfg.hint + ' Drop, paste (Ctrl+V) or pick a screenshot, or a short MP4/WebM clip.' })),
    el('div', { class: 'row' }, pick, go, stop, clr)), thumbs, status, res,
    el('div', { class: 'small muted mt6', text: 'The image is sent to this site, read by an AI model, and not kept. Check every number before you apply it.' }), file);
  host.append(box);
  let files = [], busy = false, ctl = null;
  async function add(list) {
    for (const f of [...list]) {
      const room = MAX_SCAN_IMAGES - files.length;
      if (f.type.startsWith('video/')) {
        if (room <= 0) { toast(`Up to ${MAX_SCAN_IMAGES} images per scan`); break; }
        status.textContent = 'Pulling frames from the clip…';
        try { const fr = await framesFromClip(f, room); files.push(...fr); status.textContent = `${fr.length} frames taken from ${f.name}.`; }
        catch (e) { status.textContent = scanErr(e); }
      } else if (/^image\/(png|jpeg|webp)$/.test(f.type)) {
        if (room <= 0) { toast(`Up to ${MAX_SCAN_IMAGES} images per scan`); break; }
        files.push(f);
      } else status.textContent = SCAN_ERRORS.bad_image;
    }
    draw();
  }
  function draw() {
    thumbs.textContent = '';
    files.forEach((f, i) => {
      const u = URL.createObjectURL(f), im = el('img', { src: u, alt: 'Screenshot ' + (i + 1) });
      im.addEventListener('load', () => URL.revokeObjectURL(u));
      const x = el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': 'Remove image ' + (i + 1) });
      x.addEventListener('click', () => { files.splice(i, 1); draw(); });
      thumbs.append(el('figure', {}, im, x));
    });
    go.disabled = busy || !files.length;
  }
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { add(file.files); file.value = ''; });
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('drag'); add(e.dataTransfer.files); });
  clr.addEventListener('click', () => { if (ctl) ctl.abort(); files = []; res.textContent = ''; status.textContent = ''; draw(); });
  stop.addEventListener('click', () => ctl && ctl.abort());
  go.addEventListener('click', async () => {
    if (busy || !files.length) return;
    busy = true; draw(); stop.hidden = false; res.textContent = ''; status.textContent = 'Reading the screenshot… (usually 10–60 s)';
    ctl = new AbortController();
    try {
      const form = new FormData();
      form.set('kind', cfg.kind);
      for (const f of files) form.append('images', f.type === 'image/jpeg' && f.size <= 1_400_000 ? f : await imageToJpeg(f), 'shot.jpg');
      let r, body;
      try {
        r = await fetch('/api/sc-scan', { method: 'POST', body: form, signal: ctl.signal });
        body = await r.json();
      } catch (e) { if (e && e.name === 'AbortError') throw { clip: 'Stopped.' }; throw { code: 'scan_failed' }; }
      if (!r.ok || !body || !body.ok) throw { code: body && body.error };
      const data = body.data;
      status.textContent = (data.seen ? 'Read: ' + String(data.seen).slice(0, 200) : 'Read.') + (Number.isFinite(body.remaining) ? ` ${body.remaining} scans left today.` : '');
      const notes = Array.isArray(data.notes) ? data.notes.filter(Boolean).slice(0, 8) : [];
      if (notes.length) res.append(el('ul', { class: 'tight small muted' }, ...notes.map((t) => el('li', { text: String(t).slice(0, 300) }))));
      cfg.render(data, res);
    } catch (e) { status.textContent = scanErr(e); }
    finally { busy = false; ctl = null; stop.hidden = true; draw(); }
  });
  const entry = { view: cfg.view, add, box };
  scanners.push(entry);
  return entry;
}
document.addEventListener('paste', (e) => {
  const list = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
  if (!list.length) return;
  const v = (location.hash || '#ops').slice(1);
  const s = scanners.find((x) => x.view === v && x.box.contains(document.activeElement)) || scanners.find((x) => x.view === v);
  if (!s) return;
  e.preventDefault(); s.add(list); s.box.scrollIntoView({ block: 'nearest' });
});

// Review table of extracted values -> Apply. defs: [key, label, 'text'?]
function review(res, data, defs, apply, btnText = 'Apply to calculator') {
  const tb = el('tbody'), inputs = {};
  for (const [k, label, kind] of defs) {
    const raw = data[k];
    const v = kind === 'text' ? (raw == null ? null : String(raw).slice(0, 120)) : C.nOrNull(raw);
    if (v == null || v === '') continue;
    const inp = el('input', { type: kind === 'text' ? 'text' : 'number', step: 'any', 'aria-label': label }); inp.value = v;
    inputs[k] = inp; tb.append(el('tr', {}, el('td', { text: label }), el('td', {}, inp)));
  }
  if (!tb.children.length) { res.append(el('p', { class: 'small muted', text: 'Nothing usable on that screenshot. Try cropping to just the panel.' })); return; }
  const btn = el('button', { class: 'primary', type: 'button', text: btnText });
  btn.addEventListener('click', () => { const out = {}; for (const k in inputs) out[k] = inputs[k].value; apply(out); toast('Filled from screenshot: check the numbers'); });
  res.append(el('p', { class: 'small muted', text: 'Check these against the screenshot, edit if needed, then apply. Only the fields shown are changed.' }), el('table', {}, tb), el('div', { class: 'row mt8' }, btn));
}

// Salvage
scanner('#scan-salvage', { kind: 'salvage', title: 'salvage haul, refinery or sell terminal',
  hint: 'Ship cargo/inventory, refinery job, or the commodity terminal where you sell RMC or Construction Materials.',
  render: (d, res) => review(res, d, [['rmcScu', 'RMC (SCU)'], ['rmcPrice', 'RMC sell / SCU'], ['cmRawScu', 'Raw constr. material (SCU)'], ['cmYield', 'Refinery yield %'],
    ['cmPrice', 'Constr. Materials / SCU'], ['refineFee', 'Refinery fee'], ['contract', 'Contract payout'], ['components', 'Components sold']], (o) => {
    Object.assign(sv, o); ls.set('sv.inputs', sv); setInputs($('#svFields'), sv, Object.keys(o)); calcSalvage();
  }) });

// Mining refinery job
scanner('#scan-mining', { kind: 'mining', title: 'refinery job',
  hint: 'The refinery terminal’s job setup or work-order screen.',
  render: (d, res) => {
    const lines = (Array.isArray(d.lines) ? d.lines : []).filter((l) => l && (l.ore || l.raw != null)).slice(0, 20);
    if (!lines.length) { res.append(el('p', { class: 'small muted', text: 'No refinery lines found.' })); return; }
    const tb = el('tbody');
    const rows = lines.map((l) => {
      let y = C.nOrNull(l.yieldPct); const raw = C.nOrNull(l.raw), out = C.nOrNull(l.refinedScu);
      if (y == null && raw && out != null) y = out / raw * 100;
      const r = { ore: String(l.ore || '').slice(0, 40), raw: raw ?? '', yieldPct: y == null ? '' : Math.round(y * 100) / 100, price: '' };
      tb.append(el('tr', {}, el('td', { text: r.ore || '?' }), el('td', { class: 'num', text: C.fmt(C.n(r.raw), 2) }), el('td', { class: 'num', text: r.yieldPct === '' ? '—' : C.fmt(r.yieldPct, 1) + '%' })));
      return r;
    });
    const btn = el('button', { class: 'primary', type: 'button', text: 'Replace ore lines' });
    btn.addEventListener('click', () => {
      mn.lines = rows.map((r) => ({ ...r }));
      if (C.nOrNull(d.fee) != null) mn.fee = String(C.n(d.fee));
      ls.set('mn.inputs', mn); renderMnLines(); setInputs($('#mnFields'), mn, ['fee']); calcMining(); toast('Ore lines filled: add sell prices');
    });
    res.append(el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Ore' }), el('th', { class: 'num', text: 'Raw SCU' }), el('th', { class: 'num', text: 'Yield' }))), tb),
      el('p', { class: 'small muted', text: `${d.method ? 'Method: ' + d.method + ' · ' : ''}${C.nOrNull(d.fee) != null ? 'Fee: ' + money(C.n(d.fee)) + ' · ' : ''}${C.nOrNull(d.durationMin) != null ? 'Time: ' + C.fmt(C.n(d.durationMin)) + ' min' : ''}` }),
      el('div', { class: 'row' }, btn));
  } });

// Commodity terminal
scanner('#scan-trade', { kind: 'trade', title: 'commodity terminal',
  hint: 'A commodity terminal’s buy or sell list.',
  render: (d, res) => {
    const loc = d.location ? String(d.location).slice(0, 60) : '';
    const rows = (Array.isArray(d.rows) ? d.rows : []).filter((r) => r && r.commodity).slice(0, 40);
    if (!rows.length) { res.append(el('p', { class: 'small muted', text: 'No commodities found.' })); return; }
    const tb = el('tbody');
    for (const r of rows) {
      const name = String(r.commodity).slice(0, 40), buy = C.nOrNull(r.buyPrice), sell = C.nOrNull(r.sellPrice), stock = C.nOrNull(r.stockScu);
      const bBuy = el('button', { type: 'button', class: 'ghost', text: 'Buy here', disabled: buy == null ? '' : null });
      bBuy.addEventListener('click', () => {
        const last = tr.legs[tr.legs.length - 1];
        const leg = { commodity: name, from: loc, buy: String(buy), stock: stock == null ? '' : String(stock) };
        if (last && !last.commodity && !last.buy && !last.sell) Object.assign(last, leg); else tr.legs.push(leg);
        ls.set('tr.inputs', tr); renderLegs(); toast('Leg added: buy ' + name);
      });
      const bSell = el('button', { type: 'button', class: 'ghost', text: 'Sell here', disabled: sell == null ? '' : null });
      bSell.addEventListener('click', () => {
        const leg = tr.legs.find((l) => (l.commodity || '').toLowerCase() === name.toLowerCase() && !l.sell) || tr.legs[tr.legs.length - 1];
        Object.assign(leg, { to: loc || leg.to, sell: String(sell) }); if (!leg.commodity) leg.commodity = name;
        ls.set('tr.inputs', tr); renderLegs(); toast('Sell price set: ' + name);
      });
      tb.append(el('tr', {}, el('td', { text: name }), el('td', { class: 'num', text: C.fmt(buy) }), el('td', { class: 'num', text: C.fmt(sell) }), el('td', { class: 'num', text: C.fmt(stock) }), el('td', {}, el('span', { class: 'row' }, bBuy, bSell))));
    }
    res.append(el('p', { class: 'small muted', text: (loc ? `At ${loc}. ` : '') + 'Buy here starts a new leg; Sell here completes the matching leg.' }),
      el('div', { class: 'scrollx' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Commodity' }), el('th', { class: 'num', text: 'You pay' }), el('th', { class: 'num', text: 'You get' }), el('th', { class: 'num', text: 'Stock' }), el('th', {}))), tb)));
  } });

// Cargo boxes
scanner('#scan-cargo', { kind: 'cargo', title: 'cargo manifest',
  hint: 'Freight elevator, cargo manifest or a hauling contract’s cargo list.',
  render: (d, res) => {
    let counts = {};
    const b = d.boxes && typeof d.boxes === 'object' ? d.boxes : {};
    for (const s of C.SIZES) { const v = C.nOrNull(b[s]); if (v) counts[s] = Math.round(v); }
    let how = 'Box counts as listed.';
    if (!Object.keys(counts).length && C.nOrNull(d.totalScu)) { counts = C.boxesFor(d.totalScu, d.maxContainerScu); how = `Only a total of ${C.fmt(C.n(d.totalScu))} SCU was shown, so this is the fewest boxes${d.maxContainerScu ? ' up to ' + d.maxContainerScu + ' SCU' : ''}.`; }
    const view = {}; for (const s of C.SIZES) if (counts[s]) view[s] = counts[s];
    review(res, view, C.SIZES.slice().reverse().map((s) => [String(s), `${s} SCU boxes`]), (o) => {
      for (const s of C.SIZES) cg.counts[s] = o[s] ?? cg.counts[s] ?? '';
      ls.set('cg.inputs', cg); setInputs($('#cgCounts'), cg.counts, C.SIZES.map(String)); toast('Box counts filled: press Auto-pack');
    }, 'Use these box counts');
    res.prepend(el('p', { class: 'small muted', text: how }));
  } });

// Weapon stats
scanner('#scan-weapon', { kind: 'combat', title: 'weapon stats',
  hint: 'A weapon’s stats on CStone, Erkul or the in-game item panel.',
  render: (d, res) => review(res, d, [['name', 'Weapon', 'text'], ['phys', 'Physical dmg'], ['energy', 'Energy dmg'], ['pellets', 'Projectiles / shot'], ['rpm', 'RPM'], ['mag', 'Magazine'], ['reload', 'Reload (s)'], ['burst', 'Shots / burst']], (o) => {
    Object.assign(tk, o); if (o.burst && C.n(o.burst) > 1 && !tk.mode) tk.mode = 'BURST';
    ls.set('tk.inputs', tk); setInputs($('#tkFields'), tk, Object.keys(o)); calcTTK();
  }) });

// Ship stats
scanner('#scan-ship', { kind: 'fleet', title: 'ship stats',
  hint: 'A ship page on SPViewer or Erkul.',
  render: (d, res) => review(res, d, [['name', 'Ship', 'text'], ['role', 'Role', 'text'], ['scm', 'SCM'], ['nav', 'NAV'], ['pitch', 'Pitch'], ['yaw', 'Yaw'], ['roll', 'Roll'], ['accel', 'Fwd accel']], (o) => {
    Object.assign(fl, o); setInputs($('#flFields'), fl, Object.keys(o));
  }, 'Fill the form (then Save ship)') });


scanner('#scan-contracts', { kind: 'contracts', view: 'contracts', title: 'any mission or contract',
  hint: 'The FinTac OmniGlass contract details, or the contract list.',
  render: (d, res) => {
    const list = (Array.isArray(d.contracts) ? d.contracts : []).filter((c) => c && (c.title || c.payout != null)).slice(0, 10).map(normContract);
    if (!list.length) { res.append(el('p', { class: 'small muted', text: 'No contract found on that screenshot.' })); return; }
    for (const c of list) {
      const add = el('button', { class: 'primary', type: 'button', text: 'Add to board' });
      add.addEventListener('click', () => { S.contracts = [c, ...S.contracts]; Store.saveContracts(); add.disabled = true; add.textContent = 'Added'; });
      res.append(el('div', { class: 'card mt8' }, contractBody(c), el('div', { class: 'row mt8' }, add)));
    }
  } });

// ---------------- boot ----------------
Store.onChange(() => {
  tickVT(); renderOps(); renderLog(); renderFleet(); renderContracts(); renderHeroes();
  const lo = $('#loNotes'); if (document.activeElement !== lo && S.settings.loadout != null && lo.value !== S.settings.loadout) lo.value = S.settings.loadout;
});
route(); tickVT(); renderOps(); renderLog(); renderFleet(); renderContracts(); renderHeroes();
Store.init();
initSync($('#acct'));
