// Belpire Carnival front end (ES module).
import { buildIndex, suggest, matchesSearch, sourceLabel } from './search.mjs';

const TENTS = {
  all: { blurb: 'Everything playing at the Belpire Carnival.' },
  horror: { label: 'HORROR', badge: 'badge-horror', blurb: 'Multiplayer horror — co-op scares, hunts and haunts.' },
  party: { label: 'PARTY', badge: 'badge-party', blurb: 'Party games — quick rounds, chaos and bragging rights.' },
  other: { label: 'SIDESHOW', badge: 'badge-other', blurb: 'Everything else the crowd plays together.' }
};

let feed = { upcoming: [], favorites: [], tracked: [] };
let currentTent = 'all';
let search = null; // { appid, name } for a picked game, or { text } for free text
let searchIndex = [];

// Small DOM helper. Text is always set with textContent so feed data can never inject HTML.
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function tentBadge(tent) {
  const t = TENTS[tent] || TENTS.other;
  return el('span', { class: `badge ${t.badge}`, text: t.label });
}

function capsule(src, alt) {
  const url = safeUrl(src);
  if (!url) return el('div', { class: 'capsule', 'aria-hidden': 'true' });
  return el('img', { class: 'capsule', src: url, alt: alt || '', loading: 'lazy', decoding: 'async', width: '460', height: '215' });
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function emptyState(message) {
  return el('p', { class: 'empty', text: message });
}

// While searching, the tent filter steps aside so a game is never hidden by the wrong tent.
function matchesTent(item) {
  if (search) return matchesSearch(item, search);
  return currentTent === 'all' || item.tent === currentTent;
}

function renderUpcoming() {
  const list = document.getElementById('upcoming-list');
  const items = feed.upcoming.filter(matchesTent);
  list.replaceChildren();
  if (!items.length) {
    list.append(emptyState(search ? `No upcoming release matches ${searchLabel()}.` : 'Nothing announced in this tent yet. Check back soon.'));
    return;
  }
  for (const g of items) {
    const chips = el('div', { class: 'chips' }, [tentBadge(g.tent), ...(g.tags || []).slice(0, 3).map((t) => el('span', { class: 'badge', text: t }))]);
    const link = safeUrl(g.url);
    list.append(
      el('article', { class: 'card' }, [
        capsule(g.image, ''),
        el('div', { class: 'card-body' }, [
          el('p', { class: 'release', text: (g.releaseDate || 'Coming soon').toUpperCase() }),
          el('h3', { text: g.name }),
          chips,
          link ? el('a', { class: 'btn btn-outline btn-sm', href: link, target: '_blank', rel: 'noopener', text: 'Wishlist on Steam' }) : null
        ])
      ])
    );
  }
}

function renderFavorites() {
  const list = document.getElementById('favorites-list');
  const items = feed.favorites.filter(matchesTent);
  list.replaceChildren();
  if (!items.length) {
    if (search?.appid) {
      const steamNews = `https://store.steampowered.com/news/app/${search.appid}`;
      list.append(el('p', { class: 'empty' }, [document.createTextNode(`No patch notes for ${search.name} in the last 45 days. `), el('a', { href: steamNews, target: '_blank', rel: 'noopener', text: 'Older news on Steam' })]));
    } else {
      list.append(emptyState(search ? `No recent patch notes match ${searchLabel()}.` : 'No recent news for this tent.'));
    }
    return;
  }
  for (const n of items) {
    const link = safeUrl(n.url);
    list.append(
      el('article', { class: 'news' }, [
        capsule(n.image, ''),
        el('div', { class: 'news-body' }, [
          el('div', { class: 'news-meta' }, [
            tentBadge(n.tent),
            el('span', { class: n.kind === 'EVENT' ? 'badge badge-event' : 'badge', text: n.kind || 'NEWS' }),
            el('span', { text: formatDate(n.date) })
          ]),
          el('h3', { text: `${n.name} — ${n.title}` }),
          n.summary ? el('p', { text: n.summary }) : null
        ]),
        link ? el('a', { href: link, target: '_blank', rel: 'noopener', text: 'Read on Steam' }) : null
      ])
    );
  }
}

// ---------------------------------------------------------------- search (ARIA combobox)

const searchLabel = () => (search?.appid ? search.name : `"${search?.text || ''}"`);
let active = -1;
let shown = [];

function closeSuggestions() {
  const input = document.getElementById('game-search');
  const box = document.getElementById('game-suggestions');
  box.hidden = true;
  box.replaceChildren();
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  active = -1;
  shown = [];
}

function highlight(i) {
  const input = document.getElementById('game-search');
  const options = document.querySelectorAll('#game-suggestions [role="option"]');
  active = i;
  options.forEach((o, n) => o.setAttribute('aria-selected', String(n === i)));
  if (options[i]) {
    input.setAttribute('aria-activedescendant', options[i].id);
    options[i].scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}

function openSuggestions(text) {
  const input = document.getElementById('game-search');
  const box = document.getElementById('game-suggestions');
  shown = suggest(searchIndex, text, 8);
  box.replaceChildren();
  if (!shown.length) {
    box.append(el('li', { class: 'suggest-empty', role: 'presentation', text: 'No tracked or upcoming game by that name.' }));
  }
  shown.forEach((entry, i) => {
    const option = el('li', { id: `game-opt-${i}`, role: 'option', 'aria-selected': 'false', class: 'suggest' }, [
      tentBadge(entry.tent),
      el('span', { class: 'suggest-name', text: entry.name }),
      el('span', { class: 'suggest-src', text: sourceLabel(entry) })
    ]);
    option.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
    option.addEventListener('click', () => choose(entry));
    box.append(option);
  });
  box.hidden = false;
  input.setAttribute('aria-expanded', 'true');
  active = -1;
}

function applySearch(next) {
  search = next;
  const status = document.getElementById('search-status');
  const clear = document.getElementById('search-clear');
  clear.hidden = !search;
  if (search) {
    const count = feed.upcoming.filter(matchesTent).length + feed.favorites.filter(matchesTent).length;
    status.textContent = `Showing ${searchLabel()}: ${count} item${count === 1 ? '' : 's'} below.`;
  } else status.textContent = '';
  renderUpcoming();
  renderFavorites();
}

function choose(entry) {
  const input = document.getElementById('game-search');
  input.value = entry.name;
  closeSuggestions();
  applySearch({ appid: entry.appid, name: entry.name });
  document.getElementById('midway').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function clearSearch() {
  const input = document.getElementById('game-search');
  input.value = '';
  closeSuggestions();
  applySearch(null);
  input.focus();
}

function setupSearch() {
  const input = document.getElementById('game-search');
  const form = document.getElementById('game-search-form');
  input.addEventListener('input', () => {
    const text = input.value.trim();
    if (!text) {
      closeSuggestions();
      if (search) applySearch(null);
      return;
    }
    openSuggestions(text);
  });
  input.addEventListener('keydown', (e) => {
    const open = !document.getElementById('game-suggestions').hidden;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && input.value.trim()) openSuggestions(input.value.trim());
      else if (shown.length) highlight((active + 1) % shown.length);
    } else if (e.key === 'ArrowUp' && open && shown.length) {
      e.preventDefault();
      highlight(active <= 0 ? shown.length - 1 : active - 1);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault(); // don't let the browser also clear the box
        closeSuggestions();
      }
      else if (input.value) clearSearch();
    }
  });
  input.addEventListener('blur', () => setTimeout(closeSuggestions, 120));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (active >= 0 && shown[active]) return choose(shown[active]);
    const text = input.value.trim();
    if (!text) return clearSearch();
    if (shown.length === 1) return choose(shown[0]);
    closeSuggestions();
    applySearch({ text });
  });
  document.getElementById('search-clear').addEventListener('click', clearSearch);
}

function setTent(tent) {
  if (!TENTS[tent]) tent = 'all';
  currentTent = tent;
  if (search) {
    const input = document.getElementById('game-search');
    if (input) input.value = '';
    search = null;
    document.getElementById('search-clear').hidden = true;
    document.getElementById('search-status').textContent = '';
  }
  for (const btn of document.querySelectorAll('[data-tent]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.tent === tent));
  }
  document.getElementById('tent-blurb').textContent = TENTS[tent].blurb;
  renderUpcoming();
  renderFavorites();
}

async function loadFeed() {
  try {
    const res = await fetch('/data/feed.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    feed = {
      upcoming: Array.isArray(data.upcoming) ? data.upcoming : [],
      favorites: Array.isArray(data.favorites) ? data.favorites : [],
      tracked: Array.isArray(data.tracked) ? data.tracked : []
    };
    const updated = document.getElementById('feed-updated');
    if (data.generatedAt) updated.textContent = `Pulled from Steam · updated ${formatDate(data.generatedAt)}`;
  } catch (err) {
    console.warn('Could not load feed', err);
  }
  searchIndex = buildIndex(feed);
  setTent(currentTent);
}

document.addEventListener('DOMContentLoaded', () => {
  for (const btn of document.querySelectorAll('[data-tent]')) {
    btn.addEventListener('click', () => setTent(btn.dataset.tent));
  }
  document.getElementById('year').textContent = String(new Date().getFullYear());
  setupSearch();
  loadFeed();
});
