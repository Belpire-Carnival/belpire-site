// Game Night passes on The Big Tent: members ask for one; Ringleaders stamp (approve) or turn away requests.
// The Game Night role is what lets someone into The Main Stage voice channel.
(() => {
  const box = document.getElementById('passes');
  if (!box) return;

  function el(tag, attrs = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(kids)) if (c) n.append(c);
    return n;
  }
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  async function post(path, body) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Something went wrong. Try again.');
    return data;
  }

  function memberPart(d) {
    const head = el('h2', { id: 'passes-h', text: '🎟️ Game Night Pass' });
    if (d.status === 'has_pass') return el('div', { class: 'panel pass-panel pass-ok' }, [head, el('p', { text: 'Your pass is stamped. The Main Stage is yours when the lights go down.' })]);
    if (d.status === 'pending') return el('div', { class: 'panel pass-panel' }, [head, el('p', { text: 'Your ticket is with the Ringleaders for stamping. You\'ll get a DM from the Belpire Usher once it\'s approved.' })]);
    const msg = el('p', { class: 'pass-msg', role: 'status' });
    const btn = el('button', { type: 'button', class: 'btn btn-gold', text: 'Request a Game Night Pass', onclick: async () => {
      btn.disabled = true;
      try {
        const r = await post('/api/passes/request');
        msg.textContent = r.message || 'Request sent.';
        load();
      } catch (err) {
        msg.textContent = err.message;
        btn.disabled = false;
      }
    } });
    return el('div', { class: 'panel pass-panel' }, [
      head,
      el('p', { text: 'Game nights happen in The Main Stage. A Game Night pass gets you in; a Ringleader stamps each one by hand.' }),
      d.lastDenied ? el('p', { class: 'meta', text: d.lastDenied.reason ? `Your last request wasn't approved: “${d.lastDenied.reason}” You can ask again.` : 'Your last request wasn\'t approved. You can ask again.' }) : null,
      el('div', { class: 'btn-row' }, [btn]),
      msg
    ]);
  }

  function queuePart(queue) {
    const list = el('ul', { class: 'pass-queue' });
    for (const r of queue) {
      const reason = el('input', { type: 'text', class: 'pass-reason', maxlength: '300', placeholder: 'Reason, sent by DM (optional)', 'aria-label': `Reason for turning away ${r.name}` });
      const status = el('span', { class: 'meta', role: 'status' });
      const act = (kind) => async (e) => {
        for (const b of li.querySelectorAll('button')) b.disabled = true;
        try {
          const res = await post(`/api/passes/${encodeURIComponent(r.id)}/${kind}`, kind === 'deny' ? { reason: reason.value } : {});
          status.textContent = (kind === 'approve' ? 'Stamped.' : 'Turned away.') + (res.dm === false ? ' (Their DMs are closed, so no message was sent.)' : '');
          setTimeout(load, 1200);
        } catch (err) {
          status.textContent = err.message;
          for (const b of li.querySelectorAll('button')) b.disabled = false;
        }
      };
      const li = el('li', { class: 'pass-item' }, [
        el('div', {}, [el('strong', { text: r.name }), el('span', { class: 'meta', text: ` · ${r.source === 'onboarding' ? 'onboarding' : 'website'} · ${when(r.at)}` })]),
        el('div', { class: 'pass-actions' }, [
          el('button', { type: 'button', class: 'btn btn-gold btn-sm', text: 'Stamp it', onclick: act('approve'), 'aria-label': `Approve ${r.name}` }),
          reason,
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Turn away', onclick: act('deny'), 'aria-label': `Turn away ${r.name}` })
        ]),
        status
      ]);
      list.append(li);
    }
    return el('div', { class: 'panel pass-panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: `Game Night pass requests (${queue.length})` })]),
      queue.length ? list : el('p', { class: 'gn-note', text: 'No one waiting at the gate.' })
    ]);
  }

  async function load() {
    let d;
    try {
      const res = await fetch('/api/passes', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      d = await res.json();
    } catch {
      return;
    }
    const parts = [];
    if (['none', 'pending', 'has_pass'].includes(d.status)) parts.push(memberPart(d));
    box.replaceChildren(...parts);
    box.hidden = parts.length === 0;
    // Ringleaders review requests Backstage.
    const slot = document.getElementById('gn-backstage-passes');
    if (slot) slot.replaceChildren(Array.isArray(d.queue) ? queuePart(d.queue) : '');
    if (location.hash === '#passes') (Array.isArray(d.queue) ? document.getElementById('backstage') : box)?.scrollIntoView();
  }
  load();
})();
