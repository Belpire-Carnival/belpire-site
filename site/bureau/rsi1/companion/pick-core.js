// Matching for the strict pickers: no DOM here, so it is tested on its own.
// Text is compared without case, accents or punctuation ("Hyun" finds Hyūn, "cf 337" finds CF-337).
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const uniq = (list) => { const seen = new Set(), out = []; for (const x of Array.isArray(list) ? list : []) { const k = norm(x); if (k && !seen.has(k)) { seen.add(k); out.push(String(x)); } } return out; };

// The best matches for what was typed: names that start with it first, then word starts, then anything containing every word.
export function rank(list, q, limit = 8) {
  const n = norm(q), all = uniq(list);
  if (!n) return all.sort((a, b) => a.localeCompare(b)).slice(0, limit);
  const words = n.split(' ');
  const scored = [];
  for (const x of all) {
    const nx = norm(x);
    const s = nx.startsWith(n) ? 0 : ` ${nx}`.includes(` ${n}`) ? 1 : nx.includes(n) ? 2 : words.every((w) => nx.includes(w)) ? 3 : -1;
    if (s >= 0) scored.push([s, x]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1])).slice(0, limit).map((r) => r[1]);
}

// The list's own spelling of the entry the text names exactly, or ''.
export function exact(list, q) {
  const n = norm(q);
  if (!n) return '';
  for (const x of Array.isArray(list) ? list : []) if (norm(x) === n) return String(x);
  return '';
}
