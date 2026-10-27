// Fills the "Your Ringleaders" cards with live Discord names and avatars.
// Without JavaScript, or if the lookup fails, the cards keep their written titles and monograms.
(async () => {
  const cards = document.querySelectorAll('.ringleader[data-slot]');
  if (!cards.length) return;
  const showAvatar = (card, src) => {
    const box = card.querySelector('.avatar');
    if (!box) return;
    const img = new Image();
    img.alt = '';
    img.width = 112;
    img.height = 112;
    img.decoding = 'async';
    img.onload = () => box.replaceChildren(img);
    img.src = src;
  };
  // A card can carry its own animated avatar (data-avatar, a file under /ringleaders/); it wins over Discord's.
  const own = (card) => (card.dataset.avatar || '').startsWith('/ringleaders/') ? card.dataset.avatar : null;
  for (const card of cards) if (own(card)) showAvatar(card, own(card));
  let leaders = [];
  try {
    const res = await fetch('/api/ringleaders', { headers: { Accept: 'application/json' } });
    if (res.ok) leaders = (await res.json()).leaders || [];
  } catch { return; }
  for (const l of leaders) {
    const card = document.querySelector(`.ringleader[data-slot="${Number(l.slot)}"]`);
    if (!card) continue;
    const nameEl = card.querySelector('.rl-name');
    if (nameEl && typeof l.name === 'string') {
      if (typeof l.profile === 'string' && l.profile.startsWith('https://discord.com/users/')) {
        const a = document.createElement('a');
        a.href = l.profile;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = l.name;
        a.setAttribute('aria-label', `${l.name} on Discord (${l.role})`);
        nameEl.replaceChildren(a);
      } else nameEl.textContent = l.name;
    }
    if (!own(card) && typeof l.avatar === 'string' && l.avatar.startsWith('/api/ringleaders/avatar/')) showAvatar(card, l.avatar);
  }
})();
