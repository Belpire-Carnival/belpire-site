// The header on every page: on narrow screens the links fold into a Menu button, and the sign-in button
// in the top right becomes your account menu.
// The sign-in button in the top right of every page. Signed out it's a plain link to "Verify with Discord".
// Signed in it becomes a menu that shows what matters to you: your tickets, your punch card, polls you
// haven't voted in, your Game Night pass, and (for Ringleaders) what's waiting Backstage.
(() => {
  const link = document.querySelector('[data-account]');
  if (!link) return;
  const SEEN_KEY = 'belpire:greenroom-seen';
  const here = location.pathname;

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
  const seenChat = () => {
    try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
  };
  // Plain letters first, so decorated names like "𓄿 Synister 𓄿" show "SY".
  const initials = (name) => (String(name).match(/[A-Za-z0-9]/g) || String(name).match(/[\p{L}\p{N}]/gu) || ['?']).slice(0, 2).join('').toUpperCase();

  // Only one header menu open at a time.
  const closeOthers = (which) => document.dispatchEvent(new CustomEvent('belpire:menu', { detail: which }));

  // ------------------------------------------------------------ mobile Menu button
  const nav = link.closest('.nav');
  const links = link.closest('.nav-links');
  if (nav && links) {
    if (!links.id) links.id = 'nav-links';
    const toggle = el('button', { type: 'button', class: 'nav-toggle', 'aria-expanded': 'false', 'aria-controls': links.id }, [
      el('span', { class: 'nav-toggle-icon', 'aria-hidden': 'true' }),
      el('span', { class: 'nav-toggle-text', text: 'Menu' })
    ]);
    const end = el('div', { class: 'nav-end' });
    links.after(end);
    end.append(link, toggle);
    nav.classList.add('js-nav');
    const setOpen = (on) => {
      nav.classList.toggle('open', on);
      toggle.setAttribute('aria-expanded', String(on));
      if (on) closeOthers('nav');
    };
    toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
    links.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    nav.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false);
        toggle.focus();
      }
    });
    document.addEventListener('click', (e) => { if (!nav.contains(e.target)) setOpen(false); });
    document.addEventListener('belpire:menu', (e) => { if (e.detail !== 'nav') setOpen(false); });
    window.matchMedia('(min-width: 961px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
  }

  // Come back to this page after signing in, unless it's a page with nothing to show signed-out visitors.
  link.href = `/auth/login?return=${encodeURIComponent(here === '/' || here === '/join/' ? '/me/' : here)}`;

  function item(href, icon, text, { note, hot, current } = {}) {
    return el('li', {}, el('a', { class: `acct-item${hot ? ' hot' : ''}`, href, 'aria-current': current ? 'page' : null }, [
      el('span', { class: 'acct-icon', 'aria-hidden': 'true', text: icon }),
      el('span', { class: 'acct-text', text }),
      note ? el('span', { class: 'acct-note', text: note }) : null
    ]));
  }

  function build(me) {
    const items = [];
    let attention = 0;
    if (me.member === false) {
      items.push(item('/join/', '🎟️', 'Get your ticket to the Discord', { hot: true }));
      attention++;
    }
    if (me.member) {
      const t = me.tickets;
      items.push(item('/me/', '🎟️', 'Your Ticket Booth', { note: t ? `${t.balance.toLocaleString()} tickets` : null, current: here === '/me/' }));
      if (t && !t.punchedToday) {
        items.push(item('/me/#punch', '🕳️', 'Punch card ready', { note: `+${t.nextPunch}`, hot: true }));
        attention++;
      }
      for (const p of (me.polls?.unvoted || []).slice(0, 3)) {
        items.push(item(`/big-tent/?poll=${encodeURIComponent(p.id)}`, '🗳️', `Vote: ${p.title}`, { hot: true }));
        attention++;
      }
      if (me.live?.live) items.push(item('/big-tent/', '🔴', me.live.canJoin ? 'Live now: join The Main Stage' : 'Live now on The Main Stage', { hot: true }));
      if (me.pass === 'none') items.push(item('/big-tent/#passes', '🎪', 'Get a Game Night pass'));
      else if (me.pass === 'pending') items.push(item('/big-tent/#passes', '⏳', 'Pass waiting for a stamp'));
      items.push(item('/oddities/', '🖼️', 'Hang something in the Hall of Oddities'));
    }
    if (me.manager && me.staff) {
      const s = me.staff;
      const waiting = s.passes + s.oddities + s.prizes;
      const newChat = s.chatLatest && s.chatLatest > seenChat();
      const bits = [s.passes && `${s.passes} pass${s.passes === 1 ? '' : 'es'}`, s.oddities && `${s.oddities} to review`, s.prizes && `${s.prizes} prize${s.prizes === 1 ? '' : 's'}`, newChat && 'new message'].filter(Boolean);
      items.push(el('li', { class: 'acct-sep', 'aria-hidden': 'true' }));
      items.push(item('/backstage/', '🎭', 'Backstage', { note: bits.join(' · ') || 'all quiet', hot: waiting > 0 || newChat, current: here === '/backstage/' }));
      if (waiting || newChat) attention++;
    }

    const id = 'acct-menu';
    const toggle = el('button', { type: 'button', class: 'acct-toggle', 'aria-expanded': 'false', 'aria-controls': id, 'aria-haspopup': 'true' }, [
      el('span', { class: 'acct-badge', 'aria-hidden': 'true', text: initials(me.name) }),
      el('span', { class: 'acct-name', text: me.name }),
      me.tickets ? el('span', { class: 'acct-tix', text: `🎟 ${me.tickets.balance.toLocaleString()}` }) : null,
      attention ? el('span', { class: 'acct-dot', 'aria-hidden': 'true' }) : null,
      el('span', { class: 'visually-hidden', text: attention ? ` (${attention} thing${attention === 1 ? '' : 's'} waiting)` : '' })
    ]);
    const signOut = el('form', { method: 'post', action: '/auth/logout', class: 'acct-signout' }, el('button', { type: 'submit', class: 'linklike', text: 'Sign out' }));
    const menu = el('div', { class: 'acct-menu', id, hidden: true }, [
      el('p', { class: 'acct-who' }, [el('span', { text: 'Signed in as ' }), el('strong', { text: me.name }), me.manager ? el('span', { class: 'acct-role', text: 'Ringleader' }) : null]),
      el('ul', { class: 'acct-list' }, items),
      signOut
    ]);
    const wrap = el('div', { class: 'acct' }, [toggle, menu]);

    const open = (on) => {
      menu.hidden = !on;
      toggle.setAttribute('aria-expanded', String(on));
      if (on) {
        closeOthers('account');
        menu.querySelector('a, button')?.focus();
      }
    };
    document.addEventListener('belpire:menu', (e) => { if (e.detail !== 'account') open(false); });
    toggle.addEventListener('click', () => open(menu.hidden));
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) {
        open(false);
        toggle.focus();
      }
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) open(false); });
    wrap.addEventListener('focusout', (e) => { if (e.relatedTarget && !wrap.contains(e.relatedTarget)) open(false); });
    link.replaceWith(wrap);
    // The Ticket Booth page tells us when your balance changes.
    document.addEventListener('belpire:tickets', (e) => {
      const tix = toggle.querySelector('.acct-tix');
      if (tix && Number.isFinite(e.detail?.balance)) tix.textContent = `🎟 ${e.detail.balance.toLocaleString()}`;
    });
  }

  fetch('/api/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => { if (me?.signedIn) build(me); })
    .catch(() => {});
})();
