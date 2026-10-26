// Belpire Carnival front end.
// Set your permanent Discord invite here (Server Settings > Invites > never expire).
const DISCORD_INVITE = 'https://discord.gg/belpire';

const TENTS = {
  all: { blurb: 'Everything playing at the Belpire Carnival.' },
  horror: { label: 'HORROR', badge: 'badge-horror', blurb: 'Multiplayer horror — co-op scares, hunts and haunts.' },
  party: { label: 'PARTY', badge: 'badge-party', blurb: 'Party games — quick rounds, chaos and bragging rights.' },
  other: { label: 'SIDESHOW', badge: 'badge-other', blurb: 'Everything else the crowd plays together.' }
};

let feed = { upcoming: [], favorites: [] };
let currentTent = 'all';

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

function matchesTent(item) {
  return currentTent === 'all' || item.tent === currentTent;
}

function renderUpcoming() {
  const list = document.getElementById('upcoming-list');
  const items = feed.upcoming.filter(matchesTent);
  list.replaceChildren();
  if (!items.length) {
    list.append(emptyState('Nothing announced in this tent yet. Check back soon.'));
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
    list.append(emptyState('No recent news for this tent.'));
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

function setTent(tent) {
  if (!TENTS[tent]) tent = 'all';
  currentTent = tent;
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
      favorites: Array.isArray(data.favorites) ? data.favorites : []
    };
    const updated = document.getElementById('feed-updated');
    if (data.generatedAt) updated.textContent = `Pulled from Steam · updated ${formatDate(data.generatedAt)}`;
  } catch (err) {
    console.warn('Could not load feed', err);
  }
  setTent(currentTent);
}

document.addEventListener('DOMContentLoaded', () => {
  for (const a of document.querySelectorAll('[data-discord]')) {
    a.href = DISCORD_INVITE;
    a.target = '_blank';
    a.rel = 'noopener';
  }
  for (const btn of document.querySelectorAll('[data-tent]')) {
    btn.addEventListener('click', () => setTent(btn.dataset.tent));
  }
  document.getElementById('year').textContent = String(new Date().getFullYear());
  loadFeed();
});
