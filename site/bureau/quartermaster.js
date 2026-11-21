// The Quartermaster on a division page: reference links and community tools from tools.json beside the
// page. Text is set with textContent only, and only https links are shown.

(() => {
const root = document.getElementById('tool-categories');
if (root) load();

const KINDS = { web: 'Website', app: 'App', overlay: 'Overlay', official: 'Official', wiki: 'Wiki', map: 'Map', bureau: 'Bureau' };
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
const safeUrl = (u) => { try { const url = new URL(u); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };

function render(data) {
  root.replaceChildren();
  for (const cat of data.categories || []) {
    const grid = el('div', { class: 'tool-grid' });
    for (const tool of cat.tools || []) {
      const link = safeUrl(tool.url);
      if (!link) continue;
      grid.append(el('article', { class: 'tool' }, [
        el('div', { class: 'tool-head' }, [el('h4', { text: tool.name }), el('span', { class: 'pill pill-type', text: KINDS[tool.kind] || 'Website' })]),
        el('p', { text: tool.description || '' }),
        tool.note ? el('p', { class: 'tool-note', text: tool.note }) : null,
        el('a', { class: 'read', href: link, target: '_blank', rel: 'noopener', text: tool.kind === 'app' ? 'Get it' : 'Open' })
      ]));
    }
    root.append(el('div', { class: 'tool-cat' }, [el('h3', { class: 'sub-h', text: cat.name }), cat.blurb ? el('p', { class: 'muted small', text: cat.blurb }) : null, grid]));
  }
}

async function load() {
  try {
    const res = await fetch('tools.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(await res.json());
  } catch (err) {
    console.warn('Could not load the Quartermaster', err);
    root.replaceChildren(el('p', { class: 'empty', text: 'The Quartermaster is unavailable right now. Try again shortly.' }));
  }
}
})();
