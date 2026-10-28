// Backstage (/backstage/): the green room, a message thread for the Ringleaders. The Worker also posts each
// message to the staff channel in Discord. Only Ringleaders get anything back from the API.
(() => {
  const slot = document.getElementById('gn-backstage-chat');
  if (!slot) return;
  const PATH = '/api/backstage/messages';
  const REFRESH_MS = 15000;

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
  const stamp = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  async function request(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }
      : { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Try again.'), { status: res.status });
    return data;
  }

  let built = false;
  let signature = '';
  let max = 1000;
  let timer = null;
  const log = el('ol', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Backstage messages', tabindex: '0' });
  const box = el('textarea', { id: 'chat-input', class: 'chat-input', rows: '3', placeholder: 'Message the crew…', autocomplete: 'off' });
  const count = el('span', { class: 'meta chat-count', 'aria-live': 'off' });
  const status = el('p', { class: 'chat-status', role: 'status' });
  const where = el('p', { class: 'meta chat-where' });
  const sendBtn = el('button', { type: 'button', class: 'btn btn-gold', text: 'Send' });

  function deleteButton(m) {
    const b = el('button', { type: 'button', class: 'linklike chat-delete', text: 'Delete', 'aria-label': 'Delete your message' });
    let armed = false;
    b.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        b.textContent = 'Delete here and in Discord?';
        setTimeout(() => { armed = false; b.textContent = 'Delete'; }, 4000);
        return;
      }
      b.disabled = true;
      try {
        await request(`${PATH}/${m.id}/delete`, {});
        load();
      } catch (err) {
        status.textContent = err.message;
        b.disabled = false;
      }
    });
    return b;
  }

  function renderLog(messages) {
    const sig = messages.map((m) => m.id + (m.posted ? '1' : '0')).join(',');
    if (sig === signature) return;
    signature = sig;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.replaceChildren();
    if (!messages.length) log.append(el('li', { class: 'chat-empty', text: 'Quiet in the green room. Say something to the crew.' }));
    for (const m of messages) {
      log.append(el('li', { class: `chat-msg${m.mine ? ' mine' : ''}` }, [
        el('p', { class: 'chat-head' }, [
          el('strong', { text: m.by }),
          el('time', { datetime: m.at, text: stamp(m.at) }),
          el('span', { class: `chat-sent ${m.posted ? 'ok' : 'local'}`, text: m.posted ? '✓ Moderation Tent' : 'site only', title: m.posted ? 'Also posted in Discord' : 'Not copied to Discord' })
        ]),
        el('p', { class: 'chat-body', text: m.body }),
        m.mine ? deleteButton(m) : null
      ]));
    }
    if (nearBottom || !built) log.scrollTop = log.scrollHeight;
    // The sign-in menu shows a "new message" note until you've seen the latest one here.
    const latest = messages.at(-1)?.at;
    if (latest) {
      try { localStorage.setItem('belpire:greenroom-seen', latest); } catch { /* private mode */ }
    }
  }

  function updateCount() {
    const left = max - box.value.length;
    count.textContent = left < 200 ? `${left} left` : '';
  }

  async function send() {
    const text = box.value.trim();
    if (!text) return box.focus();
    sendBtn.disabled = true;
    status.textContent = '';
    try {
      const r = await request(PATH, { body: text });
      box.value = '';
      updateCount();
      if (r.reason) status.textContent = `Saved here, but not posted to Discord: ${r.reason}`;
      signature = '';
      await load();
      log.scrollTop = log.scrollHeight;
    } catch (err) {
      status.textContent = err.message;
    } finally {
      sendBtn.disabled = false;
      box.focus();
    }
  }

  function build(d) {
    built = true;
    max = Number(d.max) || max;
    box.maxLength = max;
    where.textContent = d.discord
      ? 'Messages are also posted to the Moderation Tent in Discord by the Belpire Usher. Mentions never ping anyone.'
      : 'No staff channel is set up yet, so messages stay on this page.';
    box.addEventListener('input', updateCount);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send();
      }
    });
    sendBtn.addEventListener('click', send);
    slot.replaceChildren(el('div', { class: 'panel chat-panel' }, [
      log,
      el('div', { class: 'chat-compose' }, [
        el('label', { for: 'chat-input', class: 'visually-hidden', text: 'Message the crew' }),
        box,
        el('div', { class: 'btn-row chat-row' }, [sendBtn, el('span', { class: 'meta', text: 'Ctrl + Enter to send' }), count])
      ]),
      status,
      where
    ]));
  }

  async function load() {
    let d;
    try {
      d = await request(PATH);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        slot.replaceChildren();
        clearInterval(timer);
        timer = null;
      }
      return;
    }
    if (!built) build(d);
    renderLog(Array.isArray(d.messages) ? d.messages : []);
  }

  function schedule() {
    clearInterval(timer);
    timer = document.hidden ? null : setInterval(load, REFRESH_MS);
  }
  document.addEventListener('visibilitychange', () => {
    if (!built) return;
    if (!document.hidden) load();
    schedule();
  });
  load().then(() => { if (built) schedule(); });
})();
