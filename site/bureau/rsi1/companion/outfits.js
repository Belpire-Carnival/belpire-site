// Wardrobe for the Armory: named outfits (the look of your armor and clothing) with a live mannequin preview,
// a style tag, three colour picks and an optional link to a saved ground loadout. One outfit can be marked "Wearing".
// Saved in this browser and, when signed in, on the player's profile (everything under "arsenal.*").
import { svgEl } from './viz.js';
import { attachPicker, cleanImg, thumbStrip, catalogPanel } from './items.js';
import { createViewer, boxPart } from './viewer3d.js';

const KEY = 'arsenal.outfits';
const MAX = 40;
export const STYLES = ['Combat', 'Stealth', 'Parade', 'Explorer', 'Hauler', 'Casual', 'Other'];
export const PIECES = [['undersuit', 'Undersuit'], ['helmet', 'Helmet'], ['core', 'Core or jacket'], ['arms', 'Arms or gloves'], ['legs', 'Legs'], ['boots', 'Boots'], ['backpack', 'Backpack']];
// A fixed swatch set, so a saved colour can never be anything but one of these.
export const SWATCHES = [['Graphite', '#3a3f45'], ['Steel', '#8b97a3'], ['Bone', '#d8d2c0'], ['Desert', '#b59a62'], ['Olive', '#5f6b3c'], ['Forest', '#2f5a3e'], ['Navy', '#27415f'], ['Azure', '#3f8fc4'], ['Crimson', '#9c2f2f'], ['Rust', '#b4572f'], ['Bronze', '#c49a4a'], ['Violet', '#6b4c8f']];
const HEX = new Set(SWATCHES.map((s) => s[1]));
// Which of the three legacy colours each slot's dye maps to, and which mannequin parts each slot lights up.
const TINT_IDX = { undersuit: 0, arms: 0, core: 1, legs: 1, helmet: 2, boots: 2, backpack: 2 };
export const SLOT_PARTS = { undersuit: ['Torso', 'ArmL', 'ArmR', 'LegL', 'LegR'], helmet: ['Head', 'Neck'], core: ['Torso'], arms: ['ArmL', 'ArmR', 'HandL', 'HandR'], legs: ['LegL', 'LegR'], boots: ['FootL', 'FootR'], backpack: ['Pack'] };
export const partsFor = (pieces) => [...new Set(PIECES.flatMap(([k]) => (pieces[k] ? SLOT_PARTS[k] : [])))];
const PACK = boxPart(-0.17, 1.0, -0.24, 0.17, 1.45, -0.11);

const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const clean = (v, n = 80) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

export function normalize(o) {
  const pieces = {};
  for (const [k] of PIECES) pieces[k] = clean(o?.pieces?.[k]);
  const imgs = {}, infos = {};
  for (const [k] of PIECES) { imgs[k] = pieces[k] ? cleanImg(o?.imgs?.[k]) : ''; infos[k] = pieces[k] ? clean(o?.infos?.[k], 220) : ''; }
  const colors = [0, 1, 2].map((i) => (HEX.has(o?.colors?.[i]) ? o.colors[i] : SWATCHES[[0, 3, 10][i]][1]));
  const tints = {};
  for (const [k] of PIECES) tints[k] = HEX.has(o?.tints?.[k]) ? o.tints[k] : colors[TINT_IDX[k]];
  if (o?.tints) { colors[0] = tints.undersuit; colors[1] = tints.core; colors[2] = tints.helmet; }
  return {
    sex: o?.sex === 'female' ? 'female' : 'male',
    tints,
    id: clean(o?.id, 30) || `o${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`,
    name: clean(o?.name, 50) || 'Untitled outfit',
    style: STYLES.includes(o?.style) ? o.style : 'Other',
    pieces, imgs, infos, colors,
    loadout: clean(o?.loadout, 30),
    notes: String(o?.notes ?? '').slice(0, 400),
    fav: !!o?.fav, worn: !!o?.worn,
    at: Number(o?.at) || Date.now()
  };
}

// ---------------------------------------------------------------- share codes and wardrobe files (pure, testable)
const CODE = 'SCW1.';
const toB64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ''; for (const b of bytes) bin += String.fromCharCode(b); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const fromB64 = (b64) => { const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); };

// One outfit as a short text code you can paste into Discord. It holds the look only: not the id, the "wearing" flag or the linked loadout.
export function encodeOutfit(o) {
  const n = normalize(o);
  return CODE + toB64(JSON.stringify({ n: n.name, s: n.style, x: n.sex, p: n.pieces, t: n.tints, i: n.imgs, f: n.infos, c: n.notes }));
}
export function decodeOutfit(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  if (!t.startsWith(CODE) || t.length > 16000) return null;
  try {
    const j = JSON.parse(fromB64(t.slice(CODE.length)));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    return normalize({ id: '', name: j.n, style: j.s, sex: j.x, pieces: j.p, tints: j.t, imgs: j.i, infos: j.f, notes: j.c });
  } catch { return null; }
}

// The whole wardrobe as a file you keep, and the reverse. Read and written on this machine only.
export const FILE_TAG = 'belpire-wardrobe';
export const wardrobeFile = (list) => JSON.stringify({ app: FILE_TAG, v: 1, saved: new Date().toISOString(), outfits: list.map(normalize) }, null, 1);
export function parseWardrobe(text) {
  if (typeof text !== 'string' || text.length > 1_500_000) return null;
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j?.app === FILE_TAG ? j.outfits : null;
    if (!Array.isArray(arr)) return null;
    return arr.filter((x) => x && typeof x === 'object').slice(0, MAX).map(normalize);
  } catch { return null; }
}
// Merge incoming outfits into the list: the same id replaces, new ones are added, and only one may be worn.
export function mergeWardrobe(list, incoming) {
  const byId = new Map(list.map((x) => [x.id, x]));
  let wornTaken = list.some((x) => x.worn);
  for (const n of incoming) {
    if (n.worn && wornTaken && !byId.has(n.id)) n.worn = false;
    if (n.worn) wornTaken = true;
    byId.set(n.id, n);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX);
}

// 140×230 mannequin. A piece with a name is filled with the outfit colours; an empty one is a dashed outline.
export function mannequin(o) {
  const [c1, c2, c3] = o.colors;
  const on = (k) => !!o.pieces[k];
  const part = (k, d, fill, extra = {}) => svgEl('path', { d, class: on(k) ? 'mq on' : 'mq off', fill: on(k) ? fill : 'none', ...extra });
  return svgEl('svg', { viewBox: '0 0 140 230', class: 'mannequin', role: 'img', 'aria-label': `${o.name}: ${PIECES.filter(([k]) => on(k)).length} of ${PIECES.length} pieces` },
    part('backpack', 'M40 62h60l4 6v62l-6 8H42l-6-8V68Z', c3, { opacity: '.55' }),
    part('undersuit', 'M52 58h36l6 30-4 46H50l-4-46Z', c1),
    part('legs', 'M50 134h40l-3 70H72l-2-52-2 52H53Z', c2),
    part('boots', 'M52 204h18l2 18H48Zm18 0h18l4 18H68Z', c3),
    part('core', 'M48 56h44l8 14-6 52H46l-6-52Z', c2),
    part('arms', 'M36 60l-14 56 10 6 14-44Zm68 0 14 56-10 6-14-44Z', c1),
    part('helmet', 'M70 10c-14 0-22 10-22 24 0 12 6 22 22 22s22-10 22-22c0-14-8-24-22-24Z', c3),
    svgEl('rect', { x: '58', y: '28', width: '24', height: '9', rx: '3', class: on('helmet') ? 'visor' : 'hidden', fill: '#0c1116', opacity: '.85' }));
}

export function initOutfits(host, { toast = () => {}, copy = async () => false, getLoadouts = () => [] } = {}) {
  let list = read().map(normalize).slice(0, MAX);
  let editing = null;
  const persist = () => write(list);

  function swatchRow(cur, onPick, label) {
    const wrap = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label });
    for (const [name, hex] of SWATCHES) {
      const b = el('button', { type: 'button', class: `sw${cur === hex ? ' sel' : ''}`, role: 'radio', 'aria-checked': cur === hex ? 'true' : 'false', 'aria-label': name, title: name, 'data-hex': hex });
      b.append(svgEl('svg', { viewBox: '0 0 16 16', width: '16', height: '16' }, svgEl('rect', { width: '16', height: '16', rx: '3', fill: hex })));
      b.addEventListener('click', () => onPick(hex));
      wrap.append(b);
    }
    return wrap;
  }

  function editor() {
    const o = editing;
    const name = el('input', { type: 'text', maxlength: '50', placeholder: 'Name, for example Night ops, Parade blues', 'aria-label': 'Outfit name', value: o.name === 'Untitled outfit' ? '' : o.name });
    const style = el('select', { 'aria-label': 'Style' }, ...STYLES.map((s) => el('option', { value: s, text: s })));
    style.value = o.style;
    const lo = el('select', { 'aria-label': 'Linked loadout' }, el('option', { value: '', text: 'No linked loadout' }), ...getLoadouts().map((l) => el('option', { value: l.id, text: l.name })));
    lo.value = o.loadout;
    const notes = el('textarea', { rows: '2', maxlength: '400', 'aria-label': 'Notes', placeholder: 'Where you got it, dye, what it goes with' });
    notes.value = o.notes;

    // Left: the holographic viewport
    const canvas = el('canvas', { class: 'holo', 'aria-label': 'Rotating wireframe mannequin. Drag to rotate, scroll to zoom.' });
    const fallback = el('div', { class: 'mq-wrap' });
    const viewport = el('div', { class: 'viewport' }, canvas);
    let viewer = null;
    const showModel = () => {
      if (!viewer) return;
      viewer.load(`models/${o.sex}.glb`, { Pack: PACK }).then(() => viewer.setActive(partsFor(o.pieces))).catch(() => { viewport.replaceChildren(fallback); fallback.replaceChildren(mannequin(o)); });
    };
    const sync = () => { if (viewer) viewer.setActive(partsFor(o.pieces)); else { fallback.replaceChildren(mannequin(o)); } };
    const sexBtns = ['male', 'female'].map((sx) => el('button', { type: 'button', class: `ghost${o.sex === sx ? ' on' : ''}`, 'aria-pressed': String(o.sex === sx), text: sx === 'male' ? 'Male' : 'Female', onclick: () => { o.sex = sx; sexBtns.forEach((b, i) => { const on = ['male', 'female'][i] === sx; b.className = `ghost${on ? ' on' : ''}`; b.setAttribute('aria-pressed', String(on)); }); showModel(); } }));
    const vp = el('div', { class: 'holo-col' }, viewport, el('div', { class: 'row holo-bar' }, ...sexBtns, el('span', { class: 'small muted', text: 'Drag to rotate · scroll to zoom · double-click to reset' })));

    // Right: the equipment matrix, one angular card per slot with its own dye row
    const grid = el('div', { class: 'slots' });
    const cards = {};
    const catHost = el('div', { class: 'cat-host' });
    let catOpen = '';
    const closeCatalog = () => { const was = catOpen; catOpen = ''; catHost.replaceChildren(); if (was && cards[was]) drawSlot(was, PIECES.find(([x]) => x === was)[1]); };
    const openCatalog = (k, label) => {
      const prev = catOpen; catOpen = k;
      catHost.replaceChildren(catalogPanel({ type: k, label, current: () => o.pieces[k], onClose: closeCatalog,
        onPick: ({ name: nm, img, info }) => { o.pieces[k] = nm; o.imgs[k] = img; o.infos[k] = info || ''; drawSlot(k, label); sync(); } }));
      if (prev && prev !== k && cards[prev]) drawSlot(prev, PIECES.find(([x]) => x === prev)[1]);
      drawSlot(k, label);
      catHost.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    };
    const drawSlot = (k, label) => {
      const c = cards[k]; c.textContent = '';
      const filled = !!o.pieces[k];
      c.className = `slot${filled ? ' filled' : ''}`;
      const input = el('input', { type: 'text', maxlength: '80', value: o.pieces[k], placeholder: `${label}…`, 'aria-label': label, autocomplete: 'off' });
      let picked = o.pieces[k];
      input.addEventListener('input', () => {
        o.pieces[k] = clean(input.value);
        if (input.value !== picked) { o.imgs[k] = ''; o.infos[k] = ''; }
        c.classList.toggle('filled', !!o.pieces[k]); sync();
      });
      const pic = o.imgs[k] ? el('img', { src: o.imgs[k], alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'ph', 'aria-hidden': 'true', text: label[0] });
      const dye = el('span', { class: 'dye' }, swatchRow(o.tints[k], (hex) => { o.tints[k] = hex; o.colors[0] = o.tints.undersuit; o.colors[1] = o.tints.core; o.colors[2] = o.tints.helmet; drawSlot(k, label); }, `${label} dye`));
      const browseBtn = el('button', { type: 'button', class: `ghost browse${catOpen === k ? ' on' : ''}`, text: 'Browse', 'aria-label': `Browse ${label} catalog`, onclick: () => openCatalog(k, label) });
      c.append(el('div', { class: 'slot-top' }, el('div', { class: 'slot-pic' }, pic), el('div', { class: 'slot-body' }, el('span', { class: 'slot-label', text: label }), input, browseBtn)),
        ...(o.infos[k] ? [el('p', { class: 'slot-stats', text: o.infos[k] })] : []), dye);
      attachPicker(input, ({ name: nm, img, info }) => { picked = nm; o.pieces[k] = nm; o.imgs[k] = img; o.infos[k] = info || ''; drawSlot(k, label); sync(); }, { type: k });
    };
    for (const [k, label] of PIECES) { cards[k] = el('div', { class: 'slot' }); grid.append(cards[k]); drawSlot(k, label); }

    const grab = () => normalize({ ...o, name: name.value, style: style.value, loadout: lo.value, notes: notes.value });
    const stop = () => { if (viewer) { viewer.destroy(); viewer = null; } };
    const save = el('button', { type: 'button', class: 'primary', text: 'Save outfit', onclick: () => {
      const n = grab(); n.at = Date.now(); stop();
      list = [n, ...list.filter((x) => x.id !== n.id)].slice(0, MAX); persist(); editing = null; toast('Outfit saved'); paint();
    } });
    const root = el('div', { class: 'card accent building' }, el('h3', { text: list.some((x) => x.id === o.id) ? 'Edit outfit' : 'New outfit' }),
      el('div', { class: 'fields' }, el('label', { class: 'f' }, 'Name', name), el('label', { class: 'f' }, 'Style', style), el('label', { class: 'f' }, 'Linked loadout', lo)),
      el('div', { class: 'bb mt10' }, vp, grid),
      catHost,
      el('div', { class: 'mt10' }, el('label', { class: 'f' }, 'Notes', notes)),
      el('div', { class: 'row mt10' }, save, el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => { stop(); editing = null; paint(); } })));
    queueMicrotask(() => { try { viewer = createViewer(canvas); } catch { viewer = null; } if (viewer) showModel(); else { viewport.replaceChildren(fallback); sync(); } });
    return root;
  }

  function card(o) {
    const loName = getLoadouts().find((l) => l.id === o.loadout)?.name;
    const n = PIECES.filter(([k]) => o.pieces[k]).length;
    const brief = () => [`**${o.name}** · ${o.style}`, ...PIECES.filter(([k]) => o.pieces[k]).map(([k, l]) => `${l}: ${o.pieces[k]}`), o.colors.map((c) => SWATCHES.find((s) => s[1] === c)?.[0]).join(' / '), loName ? `Loadout: ${loName}` : '', o.notes.trim()].filter(Boolean).join('\n');
    const del = el('button', { type: 'button', class: 'ghost', text: '✕', 'aria-label': `Delete ${o.name}` });
    del.addEventListener('click', () => {
      if (del.dataset.armed) { list = list.filter((x) => x.id !== o.id); persist(); paint(); return; }
      del.dataset.armed = '1'; del.textContent = 'Delete?'; del.className = 'danger';
      setTimeout(() => { del.dataset.armed = ''; del.textContent = '✕'; del.className = 'ghost'; }, 3000);
    });
    return el('div', { class: `outfit${o.worn ? ' worn' : ''}` }, mannequin(o),
      el('div', { class: 'row between' }, el('b', { text: o.name }), el('button', { type: 'button', class: 'ghost star', 'aria-pressed': String(o.fav), 'aria-label': 'Favourite', text: o.fav ? '★' : '☆', onclick: () => { o.fav = !o.fav; persist(); paint(); } })),
      thumbStrip(PIECES.filter(([k]) => o.imgs[k]).map(([k, l]) => [l, o.pieces[k], o.imgs[k]])),
      el('p', { class: 'small muted m0', text: `${o.style} · ${n} of ${PIECES.length} pieces${loName ? ` · ${loName}` : ''}` }),
      el('div', { class: 'row mt6' },
        el('button', { type: 'button', class: o.worn ? 'primary' : '', text: o.worn ? 'Wearing' : 'Wear', onclick: () => { const was = o.worn; list.forEach((x) => { x.worn = false; }); o.worn = !was; persist(); paint(); } }),
        el('button', { type: 'button', text: 'Edit', onclick: () => { editing = normalize(o); paint(); } }),
        el('button', { type: 'button', class: 'ghost', text: 'Copy', onclick: async () => { toast((await copy(brief())) ? 'Copied for Discord' : 'Could not copy'); } }),
        el('button', { type: 'button', class: 'ghost', text: 'Share code', title: 'A short code another player can paste into Import code', onclick: async () => { toast((await copy(encodeOutfit(o))) ? 'Share code copied' : 'Could not copy'); } }),
        el('button', { type: 'button', class: 'ghost', text: 'Duplicate', onclick: () => { list = [normalize({ ...o, id: '', worn: false, name: `${o.name} copy`.slice(0, 50) }), ...list].slice(0, MAX); persist(); paint(); } }),
        del));
  }

  const fileIn = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Import a wardrobe file' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0]; fileIn.value = '';
    if (!f) return;
    if (f.size > 1_500_000) { toast('That file is too large to be a wardrobe'); return; }
    const got = parseWardrobe(await f.text());
    if (!got || !got.length) { toast('That is not a wardrobe file'); return; }
    list = mergeWardrobe(list, got); persist(); paint(); toast(`Imported ${got.length} outfit${got.length === 1 ? '' : 's'}`);
  });
  let codeOpen = false;
  const save = () => {
    const url = URL.createObjectURL(new Blob([wardrobeFile(list)], { type: 'application/json' }));
    const a = el('a', { href: url, download: `belpire-wardrobe-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Wardrobe file saved to your downloads');
  };

  function paint() {
    host.textContent = '';
    if (editing) { host.append(editor()); return; }
    const ordered = [...list].sort((a, b) => (b.worn - a.worn) || (b.fav - a.fav) || (b.at - a.at));
    const tools = el('div', { class: 'row wr-tools' },
      el('button', { type: 'button', class: 'primary', text: 'New outfit', onclick: () => { editing = normalize({ name: '', style: 'Combat' }); paint(); } }),
      el('button', { type: 'button', text: 'Save wardrobe file', disabled: list.length ? null : 'disabled', title: 'Download every outfit as one file you can keep or move to another browser', onclick: save }),
      el('button', { type: 'button', text: 'Import file', onclick: () => fileIn.click() }),
      el('button', { type: 'button', class: codeOpen ? 'on' : '', text: 'Import code', 'aria-expanded': String(codeOpen), onclick: () => { codeOpen = !codeOpen; paint(); } }));
    const codeRow = codeOpen ? (() => {
      const box = el('textarea', { rows: '2', maxlength: '16000', 'aria-label': 'Share code', placeholder: 'Paste a share code that starts with SCW1.' });
      return el('div', { class: 'wr-code mt8' }, box, el('button', { type: 'button', class: 'primary', text: 'Add to wardrobe', onclick: () => {
        const o = decodeOutfit(box.value);
        if (!o) { toast('That is not a valid share code'); return; }
        list = [o, ...list].slice(0, MAX); persist(); codeOpen = false; paint(); toast(`Added ${o.name}`);
      } }));
    })() : null;
    host.append(el('div', { class: 'card' },
      el('div', { class: 'row between' }, el('h3', { class: 'm0', text: 'Wardrobe' }), el('span', { class: 'small muted', text: `${list.length} of ${MAX} outfits` })),
      el('p', { class: 'small muted', text: 'Dress the mannequin: name each piece or browse the catalog for the slot, pick its dye and tag its style. Outfits save in this browser, and on your profile when you are signed in. A wardrobe file or share code keeps them anywhere. Nothing is uploaded.' }),
      tools, codeRow, fileIn,
      ordered.length ? el('div', { class: 'outfits mt10' }, ...ordered.map(card)) : el('p', { class: 'small muted mt10', text: 'No outfits yet. Press New outfit to dress your first look.' })));
  }

  paint();
  return { paint };
}
