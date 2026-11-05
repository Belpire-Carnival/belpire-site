// The Sliver coin: one coin per member, chosen by how many Slivers they hold right now. It starts broken
// and restores as they save, so spending can take it back down. Used by /api/me, /api/tickets (wallet,
// the coin ladder and the High Scores) and the Usher's /slivers.
// Images: site/assets/slivers/<slug>-64.webp and -256.webp (cut out, square, transparent).

export const COINS = [
  { slug: 'shattered', name: 'Shattered', min: 0 },
  { slug: 'chipped', name: 'Chipped', min: 100 },
  { slug: 'cracked', name: 'Cracked', min: 300 },
  { slug: 'verdigris', name: 'Verdigris', min: 600 },
  { slug: 'tarnished', name: 'Tarnished', min: 1000 },
  { slug: 'aged-bronze', name: 'Aged Bronze', min: 1600 },
  { slug: 'worn-bronze', name: 'Worn Bronze', min: 2400 },
  { slug: 'brass', name: 'Brass', min: 3600 },
  { slug: 'gold', name: 'Gold', min: 5000 },
  { slug: 'gilded', name: 'Gilded', min: 8000 },
  { slug: 'crimson-rare', name: 'Crimson Rare', min: 666666 }
];

const art = (c) => ({ slug: c.slug, name: c.name, min: c.min, icon: `/assets/slivers/${c.slug}-64.webp`, image: `/assets/slivers/${c.slug}-256.webp` });

export function coinIndex(balance) {
  const b = Math.max(0, Number(balance) || 0);
  let i = 0;
  while (i + 1 < COINS.length && b >= COINS[i + 1].min) i++;
  return i;
}

// → { slug, name, min, icon, image, level (1–11), next: { name, min, need } | null }
export function coinFor(balance) {
  const i = coinIndex(balance);
  const n = COINS[i + 1];
  return { ...art(COINS[i]), level: i + 1, next: n ? { name: n.name, min: n.min, need: n.min - Math.max(0, Number(balance) || 0) } : null };
}

export const coinLadder = () => COINS.map(art);
