// Bureau Patches: Steam patch notes and news for the games a division covers. Reads the shared game feed
// (/data/feed.json, built from config/games.json, where each game names its division) and shows the
// items whose `division` matches this page's <body data-division>. Text is set with textContent only.

const list = document.getElementById('patches-list');
const division = document.body.dataset.division;
if (list && division) load();

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
const safeUrl = (u) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};
const steamArt = (u) => {
  const url = safeUrl(u);
  return url && /(^|\.)steamstatic\.com$|(^|\.)akamaihd\.net$/.test(new URL(url).hostname) ? url : null;
};
const fmtDate = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function render(items, games, updated) {
  list.replaceChildren();
  const filter = document.getElementById('patches-games');
  if (filter) filter.textContent = games.length ? `Tracking ${games.map((g) => g.name).join(' · ')}` : '';
  if (!items.length) {
    list.append(el('p', { class: 'empty', text: 'No new patch notes in the last few months. The Bureau checks Steam every few hours.' }));
    return;
  }
  for (const n of items) {
    const link = safeUrl(n.url);
    const art = steamArt(n.image);
    list.append(el('article', { class: 'patch hud' }, [
      art ? el('img', { class: 'patch-art', src: art, alt: '', loading: 'lazy', decoding: 'async', width: '460', height: '215' }) : null,
      el('div', { class: 'patch-body' }, [
        el('div', { class: 'patch-meta' }, [
          el('span', { class: 'pill pill-type', text: n.kind || 'NEWS' }),
          el('span', { class: 'patch-game', text: n.name }),
          el('span', { text: fmtDate(n.date) })
        ]),
        el('h3', { text: n.title }),
        n.summary ? el('p', { text: n.summary }) : null,
        link ? el('a', { class: 'read', href: link, target: '_blank', rel: 'noopener', text: 'Read on Steam' }) : null
      ])
    ]));
  }
  const stamp = document.getElementById('patches-updated');
  if (stamp && updated) stamp.textContent = `Pulled from Steam · updated ${fmtDate(updated)}`;
}

async function load() {
  try {
    const res = await fetch('/data/feed.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const mine = (x) => x && x.division === division;
    const items = (Array.isArray(data.favorites) ? data.favorites : []).filter(mine).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 9);
    const games = (Array.isArray(data.tracked) ? data.tracked : []).filter(mine);
    render(items, games, data.generatedAt);
  } catch (err) {
    console.warn('Could not load Bureau Patches', err);
    list.replaceChildren(el('p', { class: 'empty', text: 'Patch notes are unavailable right now. Try again shortly.' }));
  }
}
