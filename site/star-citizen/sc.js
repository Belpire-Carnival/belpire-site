// The Star Citizen page front end. Reads /api/star-citizen (served by the Worker) and renders it.
// Use the same permanent invite as the main site (site/app.js).
const DISCORD_INVITE = 'https://discord.gg/YOUR-INVITE';
const REFRESH_MS = 2 * 60 * 1000;

const LABELS = { operational: 'Operational', degraded: 'Degraded', down: 'Down', maintenance: 'Maintenance', notice: 'Notice', unknown: 'Unknown' };
const SUMMARY = {
  operational: 'All systems operational.',
  degraded: 'Some systems are having problems.',
  down: 'Major outage in progress.',
  maintenance: 'Maintenance in progress.',
  notice: 'There’s a notice on the status page.',
  unknown: 'Status unavailable right now.'
};

// Text is always set with textContent; only https links are used.
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}
function safeUrl(u) {
  try { const url = new URL(u); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
const pill = (state) => el('span', { class: `pill pill-${LABELS[state] ? state : 'unknown'}`, text: LABELS[state] || LABELS.unknown });

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function ago(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return '';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

function renderStatus(status) {
  const summary = document.getElementById('summary');
  const state = status?.summary || 'unknown';
  summary.dataset.state = state;
  document.getElementById('summary-text').textContent = SUMMARY[state] || SUMMARY.unknown;

  const systems = document.getElementById('systems');
  systems.replaceChildren();
  for (const s of status?.systems || []) {
    const issues = (s.unresolved || []).map((i) => {
      const link = safeUrl(i.url);
      return el('li', {}, [link ? el('a', { href: link, target: '_blank', rel: 'noopener', text: i.title }) : document.createTextNode(i.title)]);
    });
    systems.append(el('div', { class: 'system' }, [el('h3', { text: s.name }), pill(s.status), issues.length ? el('ul', {}, issues) : null]));
  }
}

function renderIncidents(incidents) {
  const list = document.getElementById('incidents');
  list.replaceChildren();
  const items = (incidents || []).slice(0, 5);
  if (!items.length) {
    list.append(el('p', { class: 'empty', text: 'No recent incidents.' }));
    return;
  }
  for (const i of items) {
    const link = safeUrl(i.url);
    const when = i.resolved ? `Resolved ${fmtDate(i.resolvedAt) || ''}` : `Started ${fmtDate(i.createdAt)}`;
    list.append(
      el('article', { class: 'incident' }, [
        i.resolved ? el('span', { class: 'pill pill-operational', text: 'Resolved' }) : pill(i.severity),
        el('span', { class: 'title', text: i.title }),
        el('span', { class: 'meta', text: [i.affected?.join(', '), when].filter(Boolean).join(' · ') }),
        link ? el('a', { href: link, target: '_blank', rel: 'noopener', text: 'Details' }) : null
      ])
    );
  }
}

function renderNews(news) {
  const list = document.getElementById('news-list');
  list.replaceChildren();
  if (!news?.length) {
    list.append(el('p', { class: 'empty', text: 'No transmissions to show right now.' }));
    return;
  }
  for (const n of news) {
    const link = safeUrl(n.url);
    list.append(
      el('article', { class: 'news' }, [
        el('div', { class: 'meta' }, [el('span', { class: 'pill pill-type', text: n.type || 'post' }), n.posted ? el('span', { text: n.posted }) : null]),
        el('h3', { text: n.title }),
        n.summary ? el('p', { text: n.summary }) : null,
        link ? el('a', { class: 'read', href: link, target: '_blank', rel: 'noopener', text: 'Read on RSI' }) : null
      ])
    );
  }
}

async function load() {
  try {
    const res = await fetch('/api/star-citizen', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = await res.json();
    renderStatus(snap.status);
    renderIncidents(snap.incidents);
    renderNews(snap.news);
    document.getElementById('updated').textContent = snap.updatedAt ? `Checked ${ago(snap.updatedAt)} · refreshes every few minutes` : '';
  } catch (err) {
    console.warn('Could not load snapshot', err);
    document.getElementById('summary').dataset.state = 'unknown';
    document.getElementById('summary-text').textContent = 'Couldn’t reach the status service. Try again shortly.';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  for (const a of document.querySelectorAll('[data-discord]')) {
    a.href = DISCORD_INVITE;
    a.target = '_blank';
    a.rel = 'noopener';
  }
  document.getElementById('year').textContent = String(new Date().getFullYear());
  load();
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
});
