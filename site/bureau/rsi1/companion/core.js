// Pure logic for the Citizen Arsenal companion: no DOM, unit-tested in worker/test/companion-core.test.mjs.
const CORE = (() => {
  const PATCH = { version: '4.10.2', build: '4.10.2-LIVE.12881860', verified: '2026-11-07' };

  // Day lengths verified on starcitizen.tools for 4.10.2-LIVE. microTech unknown -> null.
  const BODIES = [
    { code: 'HURSTON', name: 'Hurston', P: 8928 },
    { code: 'ARCCORP', name: 'ArcCorp', P: 11196 },
    { code: 'CRUSADER', name: 'Crusader', P: 18360 },
    { code: 'MICROTECH', name: 'microTech', P: null },
  ];
  const TW = { dawnStart: 0.22, dawnEnd: 0.30, duskStart: 0.70, duskEnd: 0.78, sunrise: 0.25 };
  const BOUNDS = [[TW.dawnStart, 'DAWN'], [TW.dawnEnd, 'DAY'], [TW.duskStart, 'DUSK'], [TW.duskEnd, 'NIGHT']];

  function frac(nowMs, P, offset = 0) {
    if (!P || P <= 0) return null;
    const f = (nowMs / 1000 + offset) / P;
    return f - Math.floor(f);
  }
  function phase(f) {
    if (f >= TW.dawnStart && f < TW.dawnEnd) return 'DAWN';
    if (f >= TW.dawnEnd && f < TW.duskStart) return 'DAY';
    if (f >= TW.duskStart && f < TW.duskEnd) return 'DUSK';
    return 'NIGHT';
  }
  function next(f, P) {
    for (const [at, to] of BOUNDS) if (at > f) return { to, s: (at - f) * P };
    return { to: BOUNDS[0][1], s: (BOUNDS[0][0] + 1 - f) * P };
  }
  // offset so that frac(nowMs) == sunrise
  function calibrateSunrise(nowMs, P) {
    const t = nowMs / 1000;
    let off = TW.sunrise * P - (t % P);
    off = ((off % P) + P) % P;
    return off;
  }
  function clock(f) {
    const tot = Math.floor(f * 86400) % 86400;
    const p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(tot / 3600))}:${p(Math.floor((tot % 3600) / 60))}:${p(tot % 60)}`;
  }
  function dur(sec) {
    const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}h ${String(m).padStart(2, '0')}m ${String(r).padStart(2, '0')}s` : `${m}m ${String(r).padStart(2, '0')}s`;
  }

  const n = (v) => { const x = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const nOrNull = (v) => { if (v === '' || v == null) return null; const x = parseFloat(v); return Number.isFinite(x) ? x : null; };

  function salvage(i) {
    const crew = Math.max(1, Math.round(n(i.crew) || 1));
    const rmcValue = n(i.rmcScu) * n(i.rmcPrice);
    const cmRefined = n(i.cmRawScu) * n(i.cmYield) / 100;
    const cmValue = cmRefined * n(i.cmPrice);
    const gross = rmcValue + cmValue + n(i.components) + n(i.contract);
    const costs = n(i.refineFee) + n(i.expenses);
    const net = gross - costs;
    const mins = n(i.minutes);
    const perHour = mins > 0 ? net / (mins / 60) : null;
    return { rmcValue, cmRefined, cmValue, gross, costs, net, crew, perCrew: net / crew,
             perHour, perCrewHour: perHour == null ? null : perHour / crew };
  }

  function mining(lines, i) {
    let gross = 0, refined = 0, raw = 0;
    const rows = lines.map((l) => {
      const r = n(l.raw) * n(l.yieldPct) / 100;
      const v = r * n(l.price);
      raw += n(l.raw); refined += r; gross += v;
      return { refined: r, value: v };
    });
    const crew = Math.max(1, Math.round(n(i.crew) || 1));
    const net = gross - n(i.fee) - n(i.expenses);
    const mins = n(i.minutes);
    const perHour = mins > 0 ? net / (mins / 60) : null;
    return { rows, raw, refined, gross, net, crew, perCrew: net / crew, perHour };
  }

  function tradeChain(capital, holdScu, legs) {
    let cap = n(capital);
    const hold = Math.max(0, Math.floor(n(holdScu)));
    let profit = 0, minutes = 0, peakSpend = 0;
    const out = legs.map((L) => {
      const buy = n(L.buy), sell = n(L.sell);
      const stock = nOrNull(L.stock);
      let qty = hold;
      if (buy > 0) qty = Math.min(qty, Math.floor(cap / buy));
      if (stock != null) qty = Math.min(qty, Math.floor(stock));
      qty = Math.max(0, qty);
      const spend = qty * buy, p = qty * (sell - buy);
      peakSpend = Math.max(peakSpend, spend);
      cap += p; profit += p; minutes += n(L.minutes);
      const limit = qty === hold ? 'hold' : (stock != null && qty === Math.floor(stock)) ? 'stock' : 'capital';
      return { qty, spend, profit: p, margin: sell - buy, roi: spend > 0 ? p / spend : null, limit };
    });
    return { legs: out, profit, endCapital: cap, minutes, perHour: minutes > 0 ? profit / (minutes / 60) : null, peakSpend };
  }

  function hauling(i) {
    const pay = n(i.payout), scu = n(i.scu), mins = n(i.minutes), exp = n(i.expenses);
    const net = pay - exp;
    return { net, perScu: scu > 0 ? net / scu : null, perHour: mins > 0 ? net / (mins / 60) : null };
  }

  // Standard SCU container footprints in 1-SCU cells [w, l, h].
  const BOX = { 1: [1, 1, 1], 2: [1, 2, 1], 4: [2, 2, 1], 8: [2, 2, 2], 16: [2, 4, 2], 32: [2, 8, 2] };
  const SIZES = [32, 16, 8, 4, 2, 1];

  function makeGrid(X, Y, Z) { return { X, Y, Z, occ: new Int32Array(X * Y * Z), boxes: [] }; }
  const idx = (g, x, y, z) => (z * g.Y + y) * g.X + x;
  function fits(g, x, y, z, w, l, h) {
    if (x < 0 || y < 0 || z < 0 || x + w > g.X || y + l > g.Y || z + h > g.Z) return false;
    for (let dz = 0; dz < h; dz++) for (let dy = 0; dy < l; dy++) for (let dx = 0; dx < w; dx++)
      if (g.occ[idx(g, x + dx, y + dy, z + dz)]) return false;
    // supported: bottom layer or every cell underneath occupied
    if (z > 0) for (let dy = 0; dy < l; dy++) for (let dx = 0; dx < w; dx++)
      if (!g.occ[idx(g, x + dx, y + dy, z - 1)]) return false;
    return true;
  }
  function place(g, scu, x, y, z, rot) {
    const [a, b, h] = BOX[scu]; const w = rot ? b : a, l = rot ? a : b;
    if (!fits(g, x, y, z, w, l, h)) return null;
    const id = g.boxes.length ? Math.max(...g.boxes.map((B) => B.id)) + 1 : 1;
    for (let dz = 0; dz < h; dz++) for (let dy = 0; dy < l; dy++) for (let dx = 0; dx < w; dx++)
      g.occ[idx(g, x + dx, y + dy, z + dz)] = id;
    const B = { id, scu, x, y, z, w, l, h };
    g.boxes.push(B);
    return B;
  }
  function remove(g, id) {
    for (let i = 0; i < g.occ.length; i++) if (g.occ[i] === id) g.occ[i] = 0;
    g.boxes = g.boxes.filter((B) => B.id !== id);
  }
  // Greedy: largest first; scan far end (y=0) toward the door, bottom up, left to right.
  function autopack(g, counts) {
    const unplaced = {};
    for (const s of SIZES) {
      let c = Math.max(0, Math.floor(n(counts[s])));
      outer: while (c > 0) {
        for (let y = 0; y < g.Y; y++) for (let z = 0; z < g.Z; z++) for (let x = 0; x < g.X; x++)
          for (const rot of [false, true]) if (place(g, s, x, y, z, rot)) { c--; continue outer; }
        break;
      }
      if (c > 0) unplaced[s] = c;
    }
    return unplaced;
  }
  function sequence(g) {
    return [...g.boxes].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  }
  const usedScu = (g) => g.boxes.reduce((s, B) => s + B.scu, 0);

  function ttk(w, hp, armor, zone) {
    const pellets = Math.max(1, Math.round(n(w.pellets) || 1));
    const dmg = (n(w.phys) * n(armor.phys) + n(w.energy) * n(armor.energy)) * pellets * (n(zone) || 1);
    const H = n(hp), rpm = n(w.rpm), mag = Math.max(0, Math.round(n(w.mag)));
    if (dmg <= 0 || H <= 0 || rpm <= 0) return null;
    const shots = Math.ceil(H / dmg - 1e-9);
    const iv = 60 / rpm;
    let t = (shots - 1) * iv;
    const burst = Math.round(n(w.burst));
    if (w.mode === 'BURST' && burst > 1) {
      const gaps = Math.floor((shots - 1) / burst);
      t += gaps * Math.max(0, n(w.cooldown) - iv);
    }
    const reloads = mag > 0 ? Math.floor((shots - 1) / mag) : 0;
    t += reloads * n(w.reload);
    return { dmg, shots, reloads, ttk: t };
  }

  // Linear decay from a list of dose timestamps (ms).
  function bdl(doses, perDose, decayPerS, nowMs) {
    let level = 0, last = null;
    for (const t of [...doses].sort((a, b) => a - b)) {
      if (t > nowMs) break;
      if (last != null) level = Math.max(0, level - (t - last) / 1000 * n(decayPerS));
      level += n(perDose); last = t;
    }
    if (last != null) level = Math.max(0, level - (nowMs - last) / 1000 * n(decayPerS));
    return level;
  }

  // Split a cargo total into the fewest standard boxes no bigger than maxBox.
  function boxesFor(totalScu, maxBox) {
    let left = Math.max(0, Math.round(n(totalScu)));
    const cap = n(maxBox) > 0 ? n(maxBox) : 32;
    const out = {};
    for (const s of SIZES) if (s <= cap && left >= s) { out[s] = Math.floor(left / s); left -= out[s] * s; }
    return out;
  }

  const fmt = (v, d = 0) => (v == null || !Number.isFinite(v)) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

  return { PATCH, BODIES, TW, frac, phase, next, calibrateSunrise, clock, dur, n, nOrNull, salvage, mining, tradeChain,
           hauling, boxesFor, BOX, SIZES, makeGrid, fits, place, remove, autopack, sequence, usedScu, ttk, bdl, fmt };
})();
export default CORE;
