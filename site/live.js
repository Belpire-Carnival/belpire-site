// "Live on The Main Stage" banner. Asks /api/live every 30 seconds while the tab is visible and shows a banner
// when a Ringleader is streaming in The Main Stage. Only signed-in members get the link into the channel;
// everyone else sees who is live and a sign-in button. Text is set with textContent; the join link must be discord.com.
(() => {
  const main = document.querySelector('main');
  if (!main) return;
  let banner = null;
  let timer = null;

  const el = (tag, attrs = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v);
    }
    for (const c of [].concat(kids)) if (c) n.append(c);
    return n;
  };
  const listNames = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
  const safeJoin = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.host === 'discord.com' && /^\/channels\/\d{17,20}\/\d{17,20}$/.test(u.pathname) ? u.href : null;
    } catch {
      return null;
    }
  };

  function show(s) {
    const join = safeJoin(s.joinUrl);
    const names = (Array.isArray(s.streamers) ? s.streamers : []).map(String).slice(0, 4);
    if (!s.live || !names.length) return hide();
    const stage = el('div', { class: 'live-text' }, [
      el('p', { class: 'live-kicker' }, [el('span', { class: 'live-dot', 'aria-hidden': 'true' }), document.createTextNode(s.event?.title ? `LIVE NOW · ${s.event.title}` : 'LIVE NOW')]),
      el('p', { class: 'live-who', text: `${listNames(names)} ${names.length === 1 ? 'is' : 'are'} streaming in The Main Stage` }),
      Array.isArray(s.onStage) && s.onStage.length ? el('p', { class: 'live-also', text: `Also on stage: ${listNames(s.onStage.map(String).slice(0, 4))}` }) : null
    ]);
    let action;
    if (s.access === 'member' && join) {
      action = el('a', { class: 'btn btn-gold', href: join, target: '_blank', rel: 'noopener', text: 'Step Right Up to The Main Stage' });
    } else if (s.access === 'no_pass') {
      action = el('a', { class: 'btn btn-gold', href: '/big-tent/#passes', text: 'Get Your Game Night Pass' });
    } else if (s.access === 'pass_pending') {
      action = el('p', { class: 'live-note', text: 'Your Game Night pass is with the Ringleaders for stamping.' });
    } else if (s.access === 'not_member') {
      action = el('p', { class: 'live-note', text: 'The Main Stage is for Belpire members only.' });
    } else {
      const back = encodeURIComponent(location.pathname + location.search);
      action = el('a', { class: 'btn btn-gold', href: `/auth/login?return=${back}`, text: 'Members: Step Right Up' });
    }
    const actions = el('div', { class: 'live-actions' }, [action]);
    const next = el('aside', { class: 'live-banner', role: 'status', 'aria-label': 'Live on The Main Stage' }, [el('div', { class: 'wrap live-inner' }, [stage, actions])]);
    if (banner) banner.replaceWith(next);
    else main.prepend(next);
    banner = next;
  }
  function hide() {
    banner?.remove();
    banner = null;
  }

  async function check() {
    try {
      const res = await fetch('/api/live', { headers: { Accept: 'application/json' } });
      if (res.ok) show(await res.json());
    } catch {
      // leave whatever is showing; try again next round
    }
  }
  function start() {
    clearInterval(timer);
    check();
    timer = setInterval(check, 30_000);
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? clearInterval(timer) : start()));
  start();
})();
