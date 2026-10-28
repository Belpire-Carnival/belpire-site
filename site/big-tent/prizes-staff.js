// Backstage (/backstage/): Prize Booth orders to fulfil or refund, and handing out tickets.
// The API only answers Ringleaders; everyone else gets an empty slot.
(() => {
  const slot = document.getElementById('gn-backstage-prizes');
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
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }
      : { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Try again.'), { status: res.status });
    return data;
  }

  function orderItem(o) {
    const reason = el('input', { type: 'text', class: 'pass-reason', maxlength: '200', placeholder: 'Refund reason, sent by DM (optional)', 'aria-label': `Refund reason for ${o.by}` });
    const status = el('p', { class: 'odd-review-status', role: 'status' });
    const act = (kind) => async () => {
      for (const b of li.querySelectorAll('button')) b.disabled = true;
      try {
        const r = await api(`/api/tickets/orders/${o.id}/${kind}`, kind === 'refund' ? { reason: reason.value } : {});
        status.textContent = (kind === 'done' ? 'Done. The Usher let them know.' : 'Refunded.') + (r.dm === false ? ' (Their DMs are closed, so no message was sent.)' : '');
        setTimeout(load, 1200);
      } catch (err) {
        status.textContent = err.message;
        for (const b of li.querySelectorAll('button')) b.disabled = false;
      }
    };
    const what = o.game ? `Game: ${o.game} (ticks itself off when you open a poll with it)` : o.detail ? `“${o.detail}”` : '';
    const li = el('li', { class: 'pass-item' }, [
      el('div', {}, [el('strong', { text: o.by }), el('span', { class: 'meta', text: ` · ${o.name} · 🎟 ${o.cost} · ${when(o.at)}` })]),
      what ? el('p', { class: 'prize-what', text: what }) : null,
      el('div', { class: 'pass-actions' }, [
        el('button', { type: 'button', class: 'btn btn-gold btn-sm', text: 'Mark done', onclick: act('done'), 'aria-label': `Mark ${o.name} for ${o.by} done` }),
        reason,
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Refund', onclick: act('refund'), 'aria-label': `Refund ${o.name} for ${o.by}` })
      ]),
      status
    ]);
    return li;
  }

  function giveForm() {
    const search = el('input', { type: 'search', id: 'give-search', autocomplete: 'off', placeholder: 'Start typing a name…' });
    const results = el('ul', { class: 'give-results', 'aria-live': 'polite' });
    const chosen = el('p', { class: 'meta', text: 'Nobody picked yet.' });
    const amount = el('input', { type: 'number', id: 'give-amount', min: '-500', max: '500', step: '1', value: '25' });
    const note = el('input', { type: 'text', id: 'give-note', maxlength: '120', placeholder: 'Best scream of the night', autocomplete: 'off' });
    const status = el('p', { class: 'odd-review-status', role: 'status' });
    let who = null;
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      const q = search.value.trim();
      if (q.length < 2) return results.replaceChildren();
      timer = setTimeout(async () => {
        try {
          const r = await api(`/api/tickets/members?q=${encodeURIComponent(q)}`);
          results.replaceChildren(...(r.members.length ? r.members.map((m) => el('li', {}, el('button', {
            type: 'button', class: 'btn btn-ghost btn-sm', text: `${m.name} (@${m.username})`,
            onclick: () => { who = m; chosen.textContent = `Giving to ${m.name}`; results.replaceChildren(); search.value = m.name; amount.focus(); }
          }))) : [el('li', { class: 'meta', text: 'No one by that name.' })]));
        } catch (err) {
          results.replaceChildren(el('li', { class: 'meta', text: err.message }));
        }
      }, 300);
    });
    const give = el('button', { type: 'submit', class: 'btn btn-gold', text: 'Hand them over' });
    const form = el('form', { class: 'give-form' }, [
      el('div', { class: 'field' }, [el('label', { for: search.id, text: 'Who' }), search]),
      results,
      chosen,
      el('div', { class: 'give-row' }, [
        el('div', { class: 'field' }, [el('label', { for: amount.id, text: 'Tickets (minus takes back)' }), amount]),
        el('div', { class: 'field give-note' }, [el('label', { for: note.id, text: 'Why (they see this)' }), note])
      ]),
      el('div', { class: 'btn-row' }, [give]),
      status
    ]);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!who) {
        status.textContent = 'Pick someone from the list first.';
        return search.focus();
      }
      give.disabled = true;
      try {
        const r = await api('/api/tickets/award', { userId: who.id, amount: Number(amount.value), note: note.value });
        status.textContent = r.amount > 0 ? `Gave ${r.name} ${r.amount} tickets. They have ${r.balance} now.` : `Took ${-r.amount} back from ${r.name}. They have ${r.balance} now.`;
        who = null;
        chosen.textContent = 'Nobody picked yet.';
        search.value = '';
        note.value = '';
      } catch (err) {
        status.textContent = err.message;
      } finally {
        give.disabled = false;
      }
    });
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: 'Hand out tickets' })]),
      el('p', { class: 'meta', text: 'Reward a great night, a great clip or a great scream. Up to 500 at a time; a minus takes tickets back (never below zero). Or use /give-tickets in Discord.' }),
      form
    ]);
  }

  function scoresPanel(ready) {
    const status = el('p', { class: 'odd-review-status', role: 'status' });
    const btn = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Post the High Scores now', disabled: !ready });
    let armed = false;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Click again to post to announcements';
        setTimeout(() => { armed = false; btn.textContent = 'Post the High Scores now'; }, 4000);
        return;
      }
      armed = false;
      btn.disabled = true;
      try {
        await api('/api/tickets/post-scores', {});
        status.textContent = 'Posted to the announcements channel.';
      } catch (err) {
        status.textContent = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Post the High Scores now';
      }
    });
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: 'Weekly High Scores' })]),
      el('p', { class: 'meta', text: ready
        ? 'The Usher posts the week\'s top earners and the all-time leaders to the announcements channel every Sunday at noon Eastern. Members who hid themselves are left out. Use the button for an extra post (it doesn\'t replace Sunday\'s).'
        : 'Set the ANNOUNCEMENTS_CHANNEL_ID secret to turn on the Sunday post.' }),
      el('div', { class: 'btn-row' }, [btn]),
      status
    ]);
  }

  let give = null;
  let scores = null;
  async function load() {
    let d;
    try {
      d = await api('/api/tickets/staff');
    } catch (err) {
      if (err.status === 401 || err.status === 403) slot.replaceChildren();
      return;
    }
    const list = el('ul', { class: 'pass-queue' }, d.orders.map(orderItem));
    give = give || giveForm();
    scores = scores || scoresPanel(Boolean(d.announcements));
    slot.replaceChildren(
      el('div', { class: 'panel pass-panel' }, [
        el('div', { class: 'panel-head' }, [el('h2', { text: `Orders waiting (${d.orders.length})` })]),
        d.orders.length ? list : el('p', { class: 'gn-note', text: 'Nobody at the counter.' })
      ]),
      give,
      scores
    );
  }
  load();
})();
