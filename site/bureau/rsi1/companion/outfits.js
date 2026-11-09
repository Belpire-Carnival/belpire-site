// Wardrobe for the Armory: named outfits (the look of your armor and clothing) with a live mannequin preview,
// a style tag, three colour picks and an optional link to a saved ground loadout. One outfit can be marked "Wearing".
// Saved in this browser and, when signed in, on the player's profile (everything under "arsenal.*").
import { svgEl } from './viz.js';
import { attachPicker, cleanImg, thumbStrip } from './items.js';

const KEY = 'arsenal.outfits';
const MAX = 40;
export const STYLES = ['Combat', 'Stealth', 'Parade', 'Explorer', 'Hauler', 'Casual', 'Other'];
export const PIECES = [['undersuit', 'Undersuit'], ['helmet', 'Helmet'], ['core', 'Core or jacket'], ['arms', 'Arms or gloves'], ['legs', 'Legs'], ['boots', 'Boots'], ['backpack', 'Backpack']];
// A fixed swatch set, so a saved colour can never be anything but one of these.
export const SWATCHES = [['Graphite', '#3a3f45'], ['Steel', '#8b97a3'], ['Bone', '#d8d2c0'], ['Desert', '#b59a62'], ['Olive', '#5f6b3c'], ['Forest', '#2f5a3e'], ['Navy', '#27415f'], ['Azure', '#3f8fc4'], ['Crimson', '#9c2f2f'], ['Rust', '#b4572f'], ['Bronze', '#c49a4a'], ['Violet', '#6b4c8f']];
const HEX = new Set(SWATCHES.map((s) => s[1]));

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
  return {
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

  function swatchPicker(o, i, onPick) {
    const wrap = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': ['Base colour', 'Armor colour', 'Accent colour'][i] });
    for (const [name, hex] of SWATCHES) {
      const b = el('button', { type: 'button', class: `sw${o.colors[i] === hex ? ' sel' : ''}`, role: 'radio', 'aria-checked': o.colors[i] === hex ? 'true' : 'false', 'aria-label': name, title: name, 'data-hex': hex });
      b.append(svgEl('svg', { viewBox: '0 0 16 16', width: '18', height: '18' }, svgEl('rect', { width: '16', height: '16', rx: '3', fill: hex })));
      b.addEventListener('click', () => { o.colors[i] = hex; onPick(); });
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
    const ins = {};
    const fields = PIECES.map(([k, label]) => {
      ins[k] = el('input', { type: 'text', maxlength: '80', value: o.pieces[k], 'aria-label': label, autocomplete: 'off' });
      let picked = o.pieces[k];
      ins[k].addEventListener('input', () => { o.pieces[k] = clean(ins[k].value); if (ins[k].value !== picked) { o.imgs[k] = ''; o.infos[k] = ''; } preview(); });
      const f = el('label', { class: 'f' }, label, ins[k]);
      attachPicker(ins[k], ({ name, img, info }) => { picked = name; o.pieces[k] = name; o.imgs[k] = img; o.infos[k] = info || ''; preview(); });
      return f;
    });
    const notes = el('textarea', { rows: '2', maxlength: '400', 'aria-label': 'Notes', placeholder: 'Where you got it, dye, what it goes with' });
    notes.value = o.notes;
    const pv = el('div', { class: 'mq-wrap' });
    const preview = () => { pv.textContent = ''; pv.append(mannequin(o)); };
    const pickers = el('div', {});
    const drawPickers = () => {
      pickers.textContent = '';
      ['Base', 'Armor', 'Accent'].forEach((label, i) => pickers.append(el('div', { class: 'mt6' }, el('span', { class: 'small muted', text: label }), swatchPicker(o, i, () => { drawPickers(); preview(); }))));
    };
    drawPickers(); preview();
    const grab = () => normalize({ ...o, imgs: o.imgs, infos: o.infos, pieces: o.pieces, name: name.value, style: style.value, loadout: lo.value, notes: notes.value });
    const save = el('button', { type: 'button', class: 'primary', text: 'Save outfit', onclick: () => {
      const n = grab(); n.at = Date.now();
      list = [n, ...list.filter((x) => x.id !== n.id)].slice(0, MAX); persist(); editing = null; toast('Outfit saved'); paint();
    } });
    return el('div', { class: 'card accent' }, el('h3', { text: list.some((x) => x.id === o.id) ? 'Edit outfit' : 'New outfit' }),
      el('div', { class: 'wardrobe-edit' }, pv, el('div', {},
        el('div', { class: 'fields' }, el('label', { class: 'f' }, 'Name', name), el('label', { class: 'f' }, 'Style', style), el('label', { class: 'f' }, 'Linked loadout', lo)),
        el('div', { class: 'fields mt10' }, ...fields), pickers, el('div', { class: 'mt10' }, el('label', { class: 'f' }, 'Notes', notes)))),
      el('div', { class: 'row mt10' }, save, el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => { editing = null; paint(); } })));
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
        el('button', { type: 'button', class: 'ghost', text: 'Duplicate', onclick: () => { list = [normalize({ ...o, id: '', worn: false, name: `${o.name} copy`.slice(0, 50) }), ...list].slice(0, MAX); persist(); paint(); } }),
        del));
  }

  function paint() {
    host.textContent = '';
    if (editing) { host.append(editor()); return; }
    const ordered = [...list].sort((a, b) => (b.worn - a.worn) || (b.fav - a.fav) || (b.at - a.at));
    host.append(el('div', { class: 'card' },
      el('div', { class: 'row between' }, el('h3', { class: 'm0', text: 'Wardrobe' }), el('button', { type: 'button', class: 'primary', text: 'New outfit', onclick: () => { editing = normalize({ name: '', style: 'Combat' }); paint(); } })),
      el('p', { class: 'small muted', text: 'Name the pieces of each outfit, pick its colours and tag its style. Mark the one you are wearing, and link it to a ground loadout.' }),
      ordered.length ? el('div', { class: 'outfits' }, ...ordered.map(card)) : el('p', { class: 'small muted', text: 'No outfits yet. Press New outfit to dress your first look.' })));
  }

  paint();
  return { paint };
}
