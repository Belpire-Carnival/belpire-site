// Backstage: the Hall of Oddities review queue for Ringleaders (pictures the scan wasn't sure about,
// members' clips, and anything pulled down by reports). The API only sends the queue to Ringleaders.
(() => {
  const slot = document.getElementById('gn-backstage-oddities');
  if (!slot) return;

  function el(tag, attrs = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of [].concat(kids)) if (k) n.append(k);
    return n;
  }
  const mediaPath = (p) => typeof p === 'string' && /^\/api\/oddities\/[a-f0-9]{24}\/media$/.test(p);
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  async function post(path) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Something went wrong. Try again.');
    return data;
  }

  function item(o) {
    if (!mediaPath(o.src)) return null;
    const media = o.kind === 'clip'
      ? el('video', { class: 'odd-review-media', src: `${o.src}#t=0.1`, preload: 'metadata', controls: true, playsinline: true, 'aria-label': o.caption || 'Clip' })
      : el('a', { href: o.src, target: '_blank', rel: 'noopener', class: 'odd-review-link' }, el('img', { class: 'odd-review-media', src: o.src, alt: o.caption || `Upload from ${o.by}`, loading: 'lazy', decoding: 'async' }));
    if (o.kind === 'clip') media.muted = true;
    const why = [
      o.reports ? `Pulled down by ${o.reports} report${o.reports === 1 ? '' : 's'}` : o.kind === 'clip' ? 'Clip: needs a human look' : `Scan: ${o.scan || 'unsure'}`
    ].join('');
    const status = el('p', { class: 'odd-review-status', role: 'status' });
    const act = (kind) => async () => {
      if (kind === 'remove' && !confirm(`Delete “${o.caption || 'this upload'}”? It can't be undone.`)) return;
      for (const b of li.querySelectorAll('button')) b.disabled = true;
      try {
        await post(`/api/oddities/${o.id}/${kind}`);
        status.textContent = kind === 'approve' ? 'Hung in the hall.' : 'Thrown out.';
        setTimeout(load, 1000);
      } catch (err) {
        status.textContent = err.message;
        for (const b of li.querySelectorAll('button')) b.disabled = false;
      }
    };
    const li = el('li', { class: 'odd-review-item' }, [
      media,
      el('div', { class: 'odd-review-body' }, [
        el('strong', { text: o.caption || 'Untitled' }),
        el('span', { class: 'meta', text: `${o.kind === 'clip' ? 'Clip' : 'Picture'} by ${o.by} · ${when(o.at)}` }),
        el('span', { class: 'odd-review-why', text: why }),
        el('div', { class: 'pass-actions' }, [
          el('button', { type: 'button', class: 'btn btn-gold btn-sm', text: 'Approve', onclick: act('approve'), 'aria-label': `Approve ${o.caption || 'upload'}` }),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Remove', onclick: act('remove'), 'aria-label': `Remove ${o.caption || 'upload'}` })
        ]),
        status
      ])
    ]);
    return li;
  }

  async function load() {
    let d;
    try {
      const res = await fetch('/api/oddities?kind=image&limit=1', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      d = await res.json();
    } catch {
      return;
    }
    if (!d?.me?.manager || !Array.isArray(d.queue)) {
      slot.replaceChildren();
      return;
    }
    const list = el('ul', { class: 'odd-review-list' });
    for (const o of d.queue) {
      const li = item(o);
      if (li) list.append(li);
    }
    slot.replaceChildren(el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: `Hall of Oddities review (${d.queue.length})` })]),
      d.queue.length ? list : el('p', { class: 'gn-note', text: 'Nothing waiting. The crowd is behaving.' }),
      el('p', { class: 'gn-note' }, [el('a', { href: '/oddities/', text: 'Open the Hall of Oddities' })])
    ]));
    if (location.hash === '#oddities-review') slot.scrollIntoView();
  }
  load();
})();
