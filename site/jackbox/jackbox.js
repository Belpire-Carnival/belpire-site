// Jackbox Night page: game picker, collection and patch notes.
// Reads /jackbox/packs.json (the collection) and /data/feed.json (store art + news, built from Steam).
// All text goes in with textContent; links must be https.
import { allGames, fitting, pickOne, playerLabel } from './pick.mjs';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MIN_PLAYERS = 1;
const MAX_PLAYERS = 16;
const state = { players: 6, style: 'all', newerOnly: false, last: null };
let games = [];
let styles = {};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const safeUrl = (u) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- picker

function renderMatches() {
  const list = fitting(games, state);
  $('match-count').textContent = String(list.length);
  $('fewer').disabled = state.players <= MIN_PLAYERS;
  $('more').disabled = state.players >= MAX_PLAYERS;
  $('spin').disabled = list.length === 0;
  const ul = $('matches');
  ul.replaceChildren();
  if (!list.length) {
    ul.append(el('li', 'empty', `Nothing seats ${state.players} with these filters. Try another kind of game, or put the extras in the audience.`));
    return list;
  }
  for (const g of list) {
    const li = el('li', 'match');
    if (g.name === state.last) li.classList.add('picked');
    li.append(el('i', `dot s-${g.style}`), el('b', null, g.name), el('span', null, `${g.pack} · ${playerLabel(g)}`));
    ul.append(li);
  }
  return list;
}

function confetti() {
  if (reduceMotion) return;
  const box = $('confetti');
  box.replaceChildren();
  const colors = ['#FFD23F', '#FF4F9A', '#2EE6D6', '#8E6BFF', '#FF8A3D'];
  for (let i = 0; i < 46; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.random() * 100}%`);
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--r', `${Math.random() * 360}deg`);
    p.style.setProperty('--d', `${1.2 + Math.random() * 1.1}s`);
    p.style.setProperty('--c', colors[i % colors.length]);
    box.append(p);
  }
  setTimeout(() => box.replaceChildren(), 2600);
}

function land(game) {
  const name = $('winner-name');
  name.classList.remove('rolling', 'landed');
  name.textContent = game.name;
  void name.offsetWidth; // restart the pop animation
  name.classList.add('landed');
  $('winner-meta').textContent = `${game.packName} · ${playerLabel(game)} · ${styles[game.style] || ''}`;
  state.last = game.name;
  renderMatches();
  confetti();
}

function spin() {
  const list = fitting(games, state);
  const winner = pickOne(list, state.last);
  if (!winner) return;
  if (reduceMotion || list.length < 2) return land(winner);
  const name = $('winner-name');
  const button = $('spin');
  button.disabled = true;
  name.classList.add('rolling');
  let ticks = 0;
  const total = 14;
  const roll = () => {
    ticks++;
    name.textContent = list[Math.floor(Math.random() * list.length)].name;
    if (ticks < total) setTimeout(roll, 50 + ticks * 12);
    else {
      button.disabled = false;
      land(winner);
    }
  };
  roll();
}

function setPlayers(n) {
  state.players = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, n));
  $('players').textContent = String(state.players);
  renderMatches();
}

function setupPicker() {
  const chips = $('styles');
  for (const [key, label] of Object.entries(styles)) {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.dataset.style = key;
    b.setAttribute('aria-pressed', 'false');
    chips.append(b);
  }
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('[data-style]');
    if (!b) return;
    state.style = b.dataset.style;
    for (const c of chips.querySelectorAll('[data-style]')) c.setAttribute('aria-pressed', String(c === b));
    renderMatches();
  });
  $('newer').addEventListener('click', (e) => {
    state.newerOnly = !state.newerOnly;
    e.currentTarget.setAttribute('aria-pressed', String(state.newerOnly));
    renderMatches();
  });
  $('fewer').addEventListener('click', () => setPlayers(state.players - 1));
  $('more').addEventListener('click', () => setPlayers(state.players + 1));
  $('spin').addEventListener('click', spin);
  setPlayers(state.players);
}

// ---------------------------------------------------------------- collection

function renderLegend() {
  const legend = $('legend');
  for (const [key, label] of Object.entries(styles)) {
    const s = el('span');
    s.append(el('i', `s-${key}`), document.createTextNode(label));
    legend.append(s);
  }
}

function renderBoxes(packs, images) {
  const wrap = $('boxes');
  wrap.replaceChildren();
  for (const pack of packs) {
    const card = el('article', 'box');
    const art = el('div', 'box-art');
    const img = safeUrl(images?.[pack.appid]);
    if (img) {
      const i = document.createElement('img');
      i.src = img;
      i.alt = `${pack.name} store art`;
      i.loading = 'lazy';
      i.decoding = 'async';
      i.width = 460;
      i.height = 215;
      art.append(i);
    } else {
      art.append(el('span', 'num', pack.short.replace(/^Pack /, '') || '★'));
    }
    const body = el('div', 'box-body');
    const head = el('div', 'box-head');
    head.append(el('h3', null, pack.name), el('span', null, String(pack.year)));
    body.append(head);
    if (pack.note) body.append(el('p', 'box-note', pack.note));
    const ul = el('ul');
    for (const g of pack.games) {
      const li = el('li');
      li.append(el('i', `s-${g.style}`), el('span', null, g.name), el('span', null, playerLabel(g)));
      ul.append(li);
    }
    body.append(ul);
    const a = el('a', 'box-link', 'View on Steam');
    a.href = `https://store.steampowered.com/app/${Number(pack.appid)}/`;
    a.target = '_blank';
    a.rel = 'noopener';
    body.append(a);
    card.append(art, body);
    wrap.append(card);
  }
}

// ---------------------------------------------------------------- patch notes

function renderPatches(news) {
  const list = $('patch-list');
  list.replaceChildren();
  if (!news?.length) {
    list.append(el('p', 'empty', 'No official Jackbox news on Steam in the last six months.'));
    return;
  }
  for (const n of news) {
    const card = el('article', 'patch');
    const meta = el('div', 'meta');
    meta.append(el('span', `kind ${['PATCH', 'EVENT', 'NEWS'].includes(n.kind) ? n.kind : 'NEWS'}`, n.kind || 'NEWS'), el('span', null, String(n.name || '')));
    const when = new Date(n.date);
    if (!Number.isNaN(when.getTime())) meta.append(el('span', null, when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })));
    card.append(meta, el('h3', null, String(n.title || '')));
    if (n.summary) card.append(el('p', null, String(n.summary)));
    const url = safeUrl(n.url);
    if (url) {
      const a = el('a', null, 'Read on Steam');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      card.append(a);
    }
    list.append(card);
  }
}

// ---------------------------------------------------------------- boot

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function boot() {
  let data;
  try {
    data = await getJson('/jackbox/packs.json');
  } catch {
    $('winner-name').textContent = 'The collection didn’t load. Refresh to try again.';
    return;
  }
  styles = data.styles || {};
  games = allGames(data.packs);
  $('stat-boxes').textContent = String(data.packs.length);
  $('stat-games').textContent = String(games.length);
  setupPicker();
  renderLegend();
  renderBoxes(data.packs, {});

  try {
    const feed = await getJson('/data/feed.json');
    renderBoxes(data.packs, feed?.jackbox?.images || {});
    renderPatches(feed?.jackbox?.news || []);
  } catch {
    renderPatches([]);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
