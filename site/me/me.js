// Your Ticket Booth (/me/): what's waiting for you, your tickets, the daily punch card, Find the Pea,
// game-night check-in, the Prize Booth, High Scores and your ticket stubs. Every outcome is decided by the
// server; this page only shows it.
(() => {
  const gate = document.getElementById('tb-gate');
  const app = document.getElementById('tb-app');
  if (!gate || !app) return;
  const $ = (id) => document.getElementById(id);
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, calm.matches ? 0 : ms));
  let me = null;
  let t = null;

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
  const tickets = (n) => `${Number(n).toLocaleString()} ticket${Math.abs(n) === 1 ? '' : 's'}`;
  const when = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  async function api(path, body) {
    const res = await fetch(path, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }
      : { headers: { Accept: 'application/json' }, credentials: 'same-origin', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || 'Something went wrong. Try again.'), { status: res.status, code: data.error });
    return data;
  }
  function flash(text, kind = 'ok') {
    const box = $('tb-flash');
    box.replaceChildren(el('p', { class: `msg ${kind}`, role: kind === 'error' ? 'alert' : 'status', text }));
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => box.replaceChildren(), 6000);
  }
  const announce = () => document.dispatchEvent(new CustomEvent('belpire:tickets', { detail: { balance: t?.wallet.balance ?? 0 } }));

  // ---------------------------------------------------------------- gate

  function showGate() {
    app.hidden = true;
    gate.hidden = false;
    if (!me?.signedIn) {
      gate.replaceChildren(el('div', { class: 'panel' }, [
        el('h2', { text: 'Show your ticket at the gate' }),
        el('p', { text: 'Sign in with Discord to see your tickets, play the carnival games and cash in at the Prize Booth.' }),
        el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-gold', href: '/auth/login?return=/me/', text: 'Sign in with Discord' })]),
        el('p', { class: 'meta', text: 'We only check your Discord account and server membership; see the Privacy Policy.' })
      ]));
    } else {
      gate.replaceChildren(el('div', { class: 'panel' }, [
        el('h2', { text: `Almost in, ${me.name}` }),
        el('p', { text: 'Tickets, games and prizes are for members of the Belpire Discord. Grab your ticket into the server, then come back here.' }),
        el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-gold', href: '/join/', text: 'Get your ticket' })])
      ]));
    }
  }

  // ---------------------------------------------------------------- what's waiting

  function todo() {
    const cards = [];
    const card = (href, icon, title, text, hot = true) => cards.push(el('li', {}, el('a', { class: `tb-card${hot ? ' hot' : ''}`, href }, [
      el('span', { class: 'tb-card-icon', 'aria-hidden': 'true', text: icon }),
      el('span', { class: 'tb-card-body' }, [el('strong', { text: title }), el('span', { text })])
    ])));
    if (!t.wallet.punchedToday) card('#punch', '🕳️', 'Punch card ready', `+${tickets(t.wallet.nextPunch)} waiting today`);
    for (const p of me.polls?.unvoted || []) card(`/big-tent/?poll=${encodeURIComponent(p.id)}`, '🗳️', `Vote: ${p.title}`, 'Rank your four, or dare the Wheel of Doom');
    if (me.live?.live) card('/big-tent/', '🔴', 'Live on The Main Stage', me.live.canJoin ? 'A Ringleader is on. Hop in and check in for tickets' : 'A Ringleader is on stage right now');
    if (me.pass === 'none') card('/big-tent/#passes', '🎪', 'Get a Game Night pass', 'Your key to The Main Stage');
    else if (me.pass === 'pending') card('/big-tent/#passes', '⏳', 'Pass waiting for a stamp', 'A Ringleader will DM you', false);
    if (me.manager && me.staff) {
      const s = me.staff;
      const bits = [s.passes && `${s.passes} pass${s.passes === 1 ? '' : 'es'}`, s.oddities && `${s.oddities} to review`, s.prizes && `${s.prizes} prize${s.prizes === 1 ? '' : 's'}`].filter(Boolean);
      card('/backstage/', '🎭', 'Backstage', bits.length ? `${bits.join(' · ')} waiting` : 'All quiet back there', bits.length > 0);
    }
    card('/oddities/', '🖼️', 'The Hall of Oddities', 'Hang a screenshot or a clip', false);
    if (!cards.some((c) => c.firstChild.classList.contains('hot'))) cards.unshift(el('li', {}, el('p', { class: 'tb-card done', text: '✓ You\'re all caught up. The carnival thanks you.' })));
    $('tb-todo').replaceChildren(...cards);
  }

  // ---------------------------------------------------------------- tickets

  function wallet() {
    const w = t.wallet;
    $('tb-wallet').replaceChildren(
      el('div', { class: 'tb-ticket', role: 'img', 'aria-label': `${tickets(w.balance)} to spend` }, [
        el('span', { class: 'tb-ticket-kicker', text: 'ADMIT ONE · BELPIRE' }),
        el('span', { class: 'tb-ticket-num', text: w.balance.toLocaleString() }),
        el('span', { class: 'tb-ticket-label', text: 'tickets to spend' })
      ]),
      el('p', { class: 'meta', text: `${tickets(w.lifetime)} won all-time${w.rank ? ` · #${w.rank} on the High Scores` : w.hidden ? ' · hidden from the High Scores' : ''}` })
    );
  }

  function punchCard() {
    const w = t.wallet;
    const holes = el('ol', { class: 'tb-holes', 'aria-label': `Streak: ${w.streak} day${w.streak === 1 ? '' : 's'}` });
    const filled = w.streak ? ((w.streak - 1) % 7) + 1 : 0;
    for (let i = 1; i <= 7; i++) holes.append(el('li', { class: i <= filled ? 'punched' : '', text: String(i) }));
    const btn = el('button', { type: 'button', class: 'btn btn-gold', text: w.punchedToday ? 'Punched today ✓' : `Punch today's card (+${w.nextPunch})`, disabled: w.punchedToday });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = await api('/api/tickets/punch', {});
        holes.classList.add('ka-chunk');
        flash(`Ka-chunk! +${tickets(r.amount)}${r.streak > 1 ? ` · ${r.streak}-day streak` : ''}.`);
        await load();
      } catch (err) {
        flash(err.message, 'error');
        btn.disabled = false;
      }
    });
    $('tb-punch').replaceChildren(
      holes,
      el('div', { class: 'btn-row' }, [btn]),
      el('p', { class: 'meta', text: `${t.rules.punchBase} tickets a day, plus ${t.rules.punchStreakStep} more for every day in a row (up to +${t.rules.punchStreakStep * t.rules.punchStreakMax}). Miss a day and the streak starts over. Resets at midnight Eastern.` })
    );
  }

  function show() {
    const box = $('show');
    if (!t.show) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const s = t.show;
    const kids = [el('p', {}, [el('strong', { text: s.title }), document.createTextNode(` is on. Be in The Main Stage (not deafened) to earn ${t.rules.attendPerCheck} tickets every 10 minutes, up to ${s.cap} a show.`)])];
    if (s.checkedIn) {
      kids.push(el('div', { class: 'tb-meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(s.cap), 'aria-valuenow': String(s.paid), 'aria-label': 'Attendance tickets this show' }, el('span', { class: 'tb-meter-fill' })));
      kids.push(el('p', { class: 'meta', text: `Checked in ✓ ${s.paid} of ${s.cap} earned so far.` }));
    } else {
      const btn = el('button', { type: 'button', class: 'btn btn-gold', text: 'Check in to the show' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await api('/api/tickets/checkin', {});
          flash(`You're checked in to ${r.show}.${r.earned ? ` +${tickets(r.earned)}.` : ''}`);
          await load();
        } catch (err) {
          flash(err.message, 'error');
          btn.disabled = false;
        }
      });
      kids.push(el('div', { class: 'btn-row' }, [btn, el('span', { class: 'meta', text: 'Or type /checkin in Discord.' })]));
    }
    $('tb-show').replaceChildren(...kids);
    box.querySelector('.tb-meter-fill')?.style.setProperty('--fill', `${Math.round((100 * s.paid) / s.cap)}%`);
  }

  // ---------------------------------------------------------------- Find the Pea

  let peaBusy = false;
  let peaLast = ''; // the last result stays on screen after the table resets
  function pea() {
    const left = t.games.shell.left;
    $('tb-pea-left').textContent = `${left} ${left === 1 ? 'game' : 'games'} left today`;
    const msg = el('p', { class: 'tb-pea-msg', role: 'status', text: [peaLast, left ? (peaLast ? 'Play again?' : 'Pick a shell.') : 'That\'s all for today. The barker reopens at midnight Eastern.'].filter(Boolean).join(' ') });
    const table = el('div', { class: 'tb-shells' });
    const shells = [0, 1, 2].map((i) => {
      const b = el('button', { type: 'button', class: 'tb-shell', 'aria-label': `Shell ${i + 1}`, disabled: !left }, [
        el('span', { class: 'tb-shell-cup', 'aria-hidden': 'true' }),
        el('span', { class: 'tb-shell-pea', 'aria-hidden': 'true' })
      ]);
      b.addEventListener('click', () => play(i));
      return b;
    });
    table.append(...shells);
    async function play(pick) {
      if (peaBusy) return;
      peaBusy = true;
      shells.forEach((s) => { s.disabled = true; s.classList.remove('lifted', 'has-pea', 'picked'); });
      shells[pick].classList.add('picked');
      table.classList.add('shuffling');
      msg.textContent = 'The barker shuffles…';
      let r;
      try {
        [r] = await Promise.all([api('/api/tickets/games/shell', { pick }), sleep(900)]);
      } catch (err) {
        table.classList.remove('shuffling');
        msg.textContent = err.message;
        peaBusy = false;
        return;
      }
      table.classList.remove('shuffling');
      shells[r.pea].classList.add('has-pea', 'lifted');
      if (r.pea !== pick) shells[pick].classList.add('lifted');
      peaLast = r.win ? `Found it! +${tickets(r.amount)}.` : `Not under that one. It was shell ${r.pea + 1}.`;
      msg.textContent = peaLast;
      t.wallet.balance = r.balance;
      t.games.shell.left = r.playsLeft;
      wallet();
      announce();
      await new Promise((res) => setTimeout(res, 1600)); // time to see the shells, even with reduced motion
      peaBusy = false;
      load();
    }
    $('tb-pea').replaceChildren(table, msg);
  }

  // ---------------------------------------------------------------- Ring Toss

  let ringsBusy = false;
  let ringsLast = '';
  function rings() {
    const left = t.games.rings.left;
    $('tb-rings-left').textContent = `${left} ${left === 1 ? 'ring' : 'rings'} left today`;
    const rows = t.rules.ringRows;
    const crate = el('div', { class: 'tb-crate', 'aria-hidden': 'true' });
    const bottles = {};
    for (const row of ['back', 'middle', 'front']) {
      const line = el('div', { class: `tb-bottles ${row}` });
      bottles[row] = [0, 1, 2, 3].map(() => el('span', { class: 'tb-bottle' }, el('span', { class: 'tb-neck' })));
      line.append(...bottles[row]);
      crate.append(line);
    }
    const msg = el('p', { class: 'tb-pea-msg', role: 'status', text: [ringsLast, left ? (ringsLast ? 'Another ring?' : 'Choose a row to throw at.') : 'Out of rings for today. Back at midnight Eastern.'].filter(Boolean).join(' ') });
    const buttons = ['front', 'middle', 'back'].map((row) => {
      const b = el('button', { type: 'button', class: 'btn btn-ghost btn-sm tb-row-btn', disabled: !left }, [
        el('strong', { text: `${row[0].toUpperCase()}${row.slice(1)} row` }),
        el('span', { class: 'meta', text: `${rows[row].odds / 10}% · ${rows[row].prize} tickets` })
      ]);
      b.addEventListener('click', () => toss(row));
      return b;
    });
    async function toss(row) {
      if (ringsBusy) return;
      ringsBusy = true;
      buttons.forEach((b) => { b.disabled = true; });
      crate.querySelectorAll('.tb-ring').forEach((r) => r.remove());
      msg.textContent = 'The ring sails through the air…';
      let r;
      try {
        [r] = await Promise.all([api('/api/tickets/games/rings', { row }), sleep(500)]);
      } catch (err) {
        msg.textContent = err.message;
        ringsBusy = false;
        buttons.forEach((b) => { b.disabled = false; });
        return;
      }
      const target = bottles[r.row][r.bottle];
      target.append(el('span', { class: `tb-ring ${r.win ? 'on' : 'off'}` }));
      ringsLast = r.win ? `Clink! A ringer on the ${r.row} row: +${tickets(r.amount)}.` : 'It bounced off the bottle necks.';
      msg.textContent = ringsLast;
      t.wallet.balance = r.balance;
      t.games.rings.left = r.playsLeft;
      wallet();
      announce();
      await new Promise((res) => setTimeout(res, 1600));
      ringsBusy = false;
      load();
    }
    $('tb-rings').replaceChildren(crate, el('div', { class: 'tb-row-btns' }, buttons), msg);
  }

  // ---------------------------------------------------------------- High Striker

  let strikerBusy = false;
  let strikerLast = '';
  function striker() {
    const left = t.games.striker.left;
    $('tb-striker-left').textContent = `${left} ${left === 1 ? 'swing' : 'swings'} left today`;
    const puck = el('span', { class: 'tb-puck' });
    const bell = el('span', { class: 'tb-bell', text: '🔔' });
    const scale = el('ol', { class: 'tb-scale', reversed: true });
    for (let i = 10; i >= 1; i--) scale.append(el('li', { text: String(i) }));
    const tower = el('div', { class: 'tb-tower', 'aria-hidden': 'true' }, [bell, el('div', { class: 'tb-track' }, puck), scale]);
    const tiers = el('ul', { class: 'tb-tiers' }, t.rules.strikerTiers.slice().reverse().map((x) => el('li', {}, [
      el('strong', { text: x.label }),
      el('span', { class: 'meta', text: `${x.heights.length > 1 ? `${x.heights[0]}–${x.heights.at(-1)}` : x.heights[0]} · ${x.prize ? `${x.prize} tickets` : 'no prize'}` })
    ])));
    const msg = el('p', { class: 'tb-pea-msg', role: 'status', text: [strikerLast, left ? (strikerLast ? 'Swing again?' : 'Step up and swing.') : 'Your arms need a rest. Back at midnight Eastern.'].filter(Boolean).join(' ') });
    const btn = el('button', { type: 'button', class: 'btn btn-gold', text: '🔨 Swing the mallet', disabled: !left });
    btn.addEventListener('click', async () => {
      if (strikerBusy) return;
      strikerBusy = true;
      btn.disabled = true;
      tower.classList.remove('rung');
      puck.style.setProperty('--h', '0');
      msg.textContent = 'WHAM!';
      let r;
      try {
        [r] = await Promise.all([api('/api/tickets/games/striker', {}), sleep(250)]);
      } catch (err) {
        msg.textContent = err.message;
        strikerBusy = false;
        btn.disabled = false;
        return;
      }
      puck.style.setProperty('--h', String(r.height));
      await sleep(900);
      if (r.bell) tower.classList.add('rung');
      strikerLast = r.bell ? `DING DING DING! You rang the bell: +${tickets(r.amount)}.` : `${r.label}! The puck reached ${r.height}.${r.amount ? ` +${tickets(r.amount)}.` : ''}`;
      msg.textContent = strikerLast;
      t.wallet.balance = r.balance;
      t.games.striker.left = r.playsLeft;
      wallet();
      announce();
      await new Promise((res) => setTimeout(res, 1800));
      strikerBusy = false;
      load();
    });
    $('tb-striker').replaceChildren(el('div', { class: 'tb-striker' }, [tower, el('div', { class: 'tb-striker-side' }, [tiers, btn])]), msg);
  }

  // ---------------------------------------------------------------- Prize Booth

  function prizes() {
    const list = $('tb-prize-list');
    list.replaceChildren();
    const waiting = new Set(t.orders.filter((o) => o.status === 'pending').map((o) => o.prize));
    for (const p of t.prizes) {
      const short = t.wallet.balance < p.cost;
      const li = el('li', { class: 'tb-prize' });
      const head = el('div', { class: 'tb-prize-head' }, [el('strong', { text: p.name }), el('span', { class: 'tb-cost', text: `🎟 ${p.cost.toLocaleString()}` })]);
      const btn = el('button', {
        type: 'button', class: short || waiting.has(p.id) ? 'btn btn-ghost btn-sm' : 'btn btn-gold btn-sm',
        text: waiting.has(p.id) ? 'Waiting for a Ringleader' : short ? `${(p.cost - t.wallet.balance).toLocaleString()} more to go` : 'Redeem',
        disabled: short || waiting.has(p.id)
      });
      btn.addEventListener('click', () => openRedeem(p, li, btn));
      li.append(head, el('p', { class: 'meta', text: p.blurb }), el('div', { class: 'btn-row' }, [btn]));
      list.append(li);
    }
    const mine = t.orders;
    const STATUS = { pending: 'Waiting', done: 'Done', refunded: 'Refunded' };
    $('tb-orders').replaceChildren(...(mine.length ? [
      el('h3', { text: 'Your orders' }),
      el('ul', { class: 'tb-orders' }, mine.map((o) => el('li', {}, [
        el('span', { class: `pill ${o.status === 'done' ? 'open' : o.status === 'pending' ? 'closed' : ''}`, text: STATUS[o.status] || o.status }),
        el('span', { text: `${o.name}${o.game ? `: ${o.game}` : o.detail ? `: “${o.detail}”` : ''}` }),
        el('span', { class: 'meta', text: `${when(o.at)}${o.reason ? ` · ${o.reason}` : ''}` })
      ])))
    ] : []));
  }

  function openRedeem(p, li, btn) {
    li.querySelector('.tb-redeem')?.remove();
    btn.hidden = true;
    const form = el('form', { class: 'tb-redeem' });
    let input = null;
    if (p.needs === 'note') {
      input = el('input', { type: 'text', id: `tb-note-${p.id}`, maxlength: '200', required: true, autocomplete: 'off' });
      form.append(el('div', { class: 'field' }, [el('label', { for: input.id, text: p.id === 'name-color' ? 'Which colour?' : p.id === 'pin-oddity' ? 'Which oddity? (its title)' : 'Your pick' }), input]));
    }
    if (p.needs === 'game') {
      input = el('select', { id: `tb-game-${p.id}`, required: true }, [el('option', { value: '', text: 'Choose a game…' })]);
      const groups = new Map();
      for (const c of t.catalog) {
        if (!groups.has(c.group)) groups.set(c.group, el('optgroup', { label: c.group }));
        groups.get(c.group).append(el('option', { value: c.key, text: c.name }));
      }
      input.append(...groups.values());
      form.append(el('div', { class: 'field' }, [el('label', { for: input.id, text: 'Which game?' }), input]));
    }
    const confirm = el('button', { type: 'submit', class: 'btn btn-gold btn-sm', text: `Spend ${tickets(p.cost)}` });
    const cancel = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Never mind' });
    cancel.addEventListener('click', () => { form.remove(); btn.hidden = false; btn.focus(); });
    form.append(el('div', { class: 'btn-row' }, [confirm, cancel]));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      confirm.disabled = true;
      try {
        const body = { prize: p.id };
        if (p.needs === 'note') body.detail = input.value;
        if (p.needs === 'game') body.game = input.value;
        await api('/api/tickets/redeem', body);
        flash(`${p.name} ordered! A Ringleader will sort it out and the Usher will DM you.`);
        await load();
      } catch (err) {
        flash(err.message, 'error');
        confirm.disabled = false;
      }
    });
    li.append(form);
    (input || confirm).focus();
  }

  // ---------------------------------------------------------------- scores and stubs

  function scores() {
    const list = $('tb-scores');
    list.replaceChildren(...(t.highScores.length ? t.highScores.map((r) => el('li', { class: r.me ? 'me' : '' }, [
      el('span', { class: 'tb-rank', text: `#${r.rank}` }),
      el('span', { class: 'tb-score-name', text: r.name }),
      r.badge ? el('span', { class: 'tb-badge', title: 'Fan Favorite', 'aria-label': 'Fan Favorite', text: '✦' }) : null,
      el('span', { class: 'tb-score', text: r.lifetime.toLocaleString() })
    ])) : [el('li', { class: 'meta', text: 'Nobody on the board yet. Punch your card to get on it.' })]));
    const hide = $('tb-hide');
    hide.checked = t.wallet.hidden;
    hide.onchange = async () => {
      hide.disabled = true;
      try {
        await api('/api/tickets/privacy', { hidden: hide.checked });
        flash(hide.checked ? 'You\'re off the High Scores. Your tickets still count.' : 'You\'re back on the High Scores.');
        await load();
      } catch (err) {
        flash(err.message, 'error');
        hide.checked = !hide.checked;
      } finally {
        hide.disabled = false;
      }
    };
  }

  function history() {
    $('tb-history').replaceChildren(...(t.history.length ? t.history.map((h) => el('li', {}, [
      el('span', { class: `tb-amt ${h.amount > 0 ? 'plus' : 'minus'}`, text: `${h.amount > 0 ? '+' : '−'}${Math.abs(h.amount).toLocaleString()}` }),
      el('span', { class: 'tb-stub-note', text: h.note || h.kind }),
      el('time', { class: 'meta', datetime: h.at, text: when(h.at) })
    ])) : [el('li', { class: 'meta', text: 'No stubs yet. Punch your card or find the pea.' })]));
  }

  // ---------------------------------------------------------------- load

  async function load() {
    try {
      [me, t] = await Promise.all([api('/api/me'), api('/api/tickets').catch((err) => (err.status === 401 || err.status === 403 ? null : Promise.reject(err)))]);
    } catch {
      gate.replaceChildren(el('div', { class: 'panel' }, [el('p', { text: 'The ticket booth is closed for a moment. Try again shortly.' })]));
      return;
    }
    if (!me.signedIn || !me.member || !t) return showGate();
    gate.hidden = true;
    app.hidden = false;
    $('tb-greeting').textContent = `Welcome back, ${me.name}. Here's what's waiting, and the tickets you've won along the way.`;
    todo();
    wallet();
    punchCard();
    show();
    if (!peaBusy) pea();
    if (!ringsBusy) rings();
    if (!strikerBusy) striker();
    prizes();
    scores();
    history();
    announce();
    if (!load.arrived && location.hash.length > 1) {
      load.arrived = true;
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    }
  }
  load();
})();
