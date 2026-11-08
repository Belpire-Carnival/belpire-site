// The Sliver coin: one coin per member, chosen by the Slivers they have won all-time (lifetime), so it only
// ever restores, like the Pass. Fifteen tiers, named after the carnival's districts, from a shattered,
// bloodied sliver at The Gate to the ruby coin of The Witching Hour. Used by /api/me, /api/tickets (wallet,
// the coin ladder and the High Scores) and the Usher's /slivers.
// Images: site/assets/slivers/<slug>-64.webp (header), -128.webp (lists) and -384.webp (the big coin),
// cut out to transparent squares from the owner's art and never tinted or recoloured.

export const COINS = [
  { slug: 'the-gate', name: 'The Gate', min: 0, look: 'A shattered, razor-sharp brass sliver, stained with dried blood and rust.' },
  { slug: 'the-ticket-booth', name: 'The Ticket Booth', min: 125, look: 'A heavily fractured brass shard, blackened with grime and missing a massive chunk.' },
  { slug: 'the-midway', name: 'The Midway', min: 500, look: 'A battered, dented, misshapen coin still trying to hold its circle.' },
  { slug: 'the-green-room', name: 'The Green Room', min: 1100, look: 'Dark, heavily tarnished brass covered in deep scratches and gouges.' },
  { slug: 'the-concession-tent', name: 'The Concession Tent', min: 2000, look: 'Worn brass with faded relief and creeping green verdigris.' },
  { slug: 'the-fortune-tellers-tent', name: 'The Fortune Teller\'s Tent', min: 3200, look: 'A whole circle again, but dull, oxidized and without any shine.' },
  { slug: 'the-generator-shed', name: 'The Generator Shed', min: 5000, look: 'Slightly dull brass with minor edge wear and surface scuffs.' },
  { slug: 'the-prize-booth', name: 'The Prize Booth', min: 7200, look: 'A circulated brass coin with dirt settled deep in the faces.' },
  { slug: 'the-hall-of-oddities', name: 'The Hall of Oddities', min: 10000, look: 'Clean brass beginning to show a soft, warm sheen.' },
  { slug: 'the-sideshow', name: 'The Sideshow', min: 13500, look: 'Nicely polished; the tent and faces are sharp and clear.' },
  { slug: 'the-scream-reel', name: 'The Scream Reel', min: 18000, look: 'Bright, shiny brass that catches every light.' },
  { slug: 'the-closet', name: 'The Closet', min: 24000, look: 'Immaculate, gleaming brass with no wear at all.' },
  { slug: 'the-big-tent', name: 'The Big Tent', min: 31000, look: 'A flawless, ultra-shiny blend of gold and brass.' },
  { slug: 'the-main-stage', name: 'The Main Stage', min: 42424, look: 'Pristine, gleaming gold: the end of the Patron\'s standard trials.' },
  { slug: 'the-witching-hour', name: 'The Witching Hour', min: 666666, look: 'A flawless, translucent blood-red ruby with a dark red aura.' }
];

const art = (c, i) => ({ slug: c.slug, name: c.name, min: c.min, look: c.look, tier: i + 1, icon: `/assets/slivers/${c.slug}-64.webp`, thumb: `/assets/slivers/${c.slug}-128.webp`, image: `/assets/slivers/${c.slug}-384.webp` });

export function coinIndex(lifetime) {
  const b = Math.max(0, Number(lifetime) || 0);
  let i = 0;
  while (i + 1 < COINS.length && b >= COINS[i + 1].min) i++;
  return i;
}

// lifetime Slivers → { slug, name, min, look, tier (1–15), icon, thumb, image, next: { name, min, need } | null }
export function coinFor(lifetime) {
  const i = coinIndex(lifetime);
  const n = COINS[i + 1];
  return { ...art(COINS[i], i), next: n ? { name: n.name, min: n.min, need: n.min - Math.max(0, Number(lifetime) || 0) } : null };
}

export const coinLadder = () => COINS.map(art);
