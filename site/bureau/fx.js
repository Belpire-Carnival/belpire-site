// Brings the division hero art to life. The painted scene (img/scene-<code>.webp, 1200x804) sits in a
// stage; this script draws effects on a canvas laid exactly over it, using hotspots measured on each
// picture (fires, radars, camera feeds, gun barrels, engines), plus a slow camera drift and pointer
// parallax. Decoration only: the page reads the same without it, and reduced motion turns it all off.

const stage = document.querySelector('.stage');
const canvas = document.getElementById('fx');
if (stage && canvas && canvas.getContext) start();

function start() {
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const IW = 1200, IH = 804;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const TAU = Math.PI * 2;

  // Hotspots in image pixels. glow: [x, y, r, 'r, g, b', strength]; radar: [x, y, r]; rects: [x0, y0, x1, y1].
  const SCENES = {
    bf1: {
      glows: [[430, 450, 95, '255, 120, 40', 0.5], [1160, 500, 120, '255, 110, 40', 0.5], [340, 620, 80, '255, 130, 50', 0.45], [175, 505, 85, '255, 120, 40', 0.4], [985, 600, 95, '255, 120, 40', 0.4], [610, 560, 70, '255, 140, 60', 0.3]],
      radars: [[1050, 105, 78], [130, 678, 60]],
      muzzles: [[163, 436, -1], [1084, 428, 1]],
      rotors: [[265, 176, 128], [900, 238, 88], [140, 278, 38]],
      tracers: { from: [[60, 520, 380, 640], [820, 300, 1180, 520]], rate: 2.2, cols: ['#FFD08A', '#FFB45A', '#FFE7A8'] },
      embers: { rate: 70, area: [0, 380, 1200, 804], cols: ['#FFB45A', '#FFD98A', '#FF8A3D'] },
      smoke: { rate: 1.6, area: [0, 120, 1200, 460] }
    },
    sq1: {
      radars: [[585, 620, 56], [782, 620, 56], [167, 670, 48]],
      cctv: [[922, 230, 1157, 375], [922, 425, 1157, 567], [922, 617, 1157, 757]],
      map: [47, 205, 276, 374],
      logs: [47, 432, 276, 562],
      bars: { xs: [797, 822, 847, 872], w: 10, top: 410, bottom: 488 },
      blinks: [[1150, 15], [250, 186], [1150, 206], [1150, 400], [1150, 597], [880, 522], [1140, 780], [245, 590]],
      scan: true
    },
    rsi1: {
      glows: [[160, 358, 125, '255, 150, 60', 0.6], [200, 128, 48, '255, 170, 80', 0.55], [118, 520, 60, '255, 130, 50', 0.35]],
      radars: [[100, 698, 58]],
      reticle: [595, 652, 26],
      lasers: { rate: 2.6, lanes: [[[300, 150, 520, 330], [700, 180, 1150, 420]], [[860, 120, 1160, 300], [150, 200, 420, 520]]], cols: ['#FF5A6A', '#FF8A8A', '#7FB2FF', '#B9D4FF'] },
      bursts: [[160, 358], [200, 128], [95, 470]],
      twinkle: 70,
      embers: { rate: 18, area: [40, 260, 360, 520], cols: ['#FFB45A', '#FFE7A8', '#FFFFFF'], drift: true }
    },
    se1: {
      glows: [[110, 340, 46, '255, 150, 60', 0.6], [1055, 300, 44, '255, 150, 60', 0.6], [1000, 96, 34, '255, 150, 60', 0.55], [310, 240, 26, '255, 160, 70', 0.5], [700, 598, 110, '255, 100, 30', 0.5], [420, 508, 100, '255, 110, 30', 0.45], [300, 612, 80, '255, 90, 30', 0.4], [920, 650, 90, '255, 90, 30', 0.35]],
      meteors: { rate: 0.9 },
      beams: [[1030, 528, 610, 560], [772, 576, 560, 556], [1020, 520, 820, 470]],
      blasts: [[720, 588], [400, 508], [880, 640]],
      embers: { rate: 80, area: [0, 420, 1200, 804], cols: ['#FFB45A', '#FF8A3D', '#FFD98A'] },
      smoke: { rate: 1.2, area: [700, 200, 1200, 520] }
    }
  };
  const S = SCENES[stage.dataset.scene];
  if (!S) return;

  let scale = 1, dpr = 1, t = 0, last = 0, running = false;
  let embers = [], smoke = [], sparks = [], bolts = [], meteors = [], flashes = [], pings = [], stars = [];
  const timers = {};
  const every = (key, lo, hi, dt) => {
    timers[key] = (timers[key] ?? rand(0, hi)) - dt;
    if (timers[key] > 0) return false;
    timers[key] = rand(lo, hi);
    return true;
  };

  function resize() {
    const box = stage.getBoundingClientRect();
    scale = box.width / IW;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    if (S.twinkle) stars = Array.from({ length: S.twinkle }, () => ({ x: rand(300, 1180), y: rand(10, 420), r: rand(0.6, 1.6), p: rand(0, TAU), s: rand(1, 3) }));
    if (!running) draw();
  }

  // ---------------------------------------------------------------- simulation

  function burst(x, y, n, cols, power = 160) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), v = rand(30, power);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.3, 0.9), col: pick(cols) });
    }
  }

  function step(dt) {
    t += dt;
    const E = S.embers;
    if (E) {
      let n = E.rate * dt;
      while (n > 0) {
        if (Math.random() < n) embers.push({ x: rand(E.area[0], E.area[2]), y: rand(E.area[1], E.area[3]), vx: rand(-14, 14), vy: E.drift ? rand(-20, 20) : rand(-70, -25), life: rand(1.5, 4), max: 4, r: rand(0.7, 2), col: pick(E.cols), p: rand(0, TAU) });
        n -= 1;
      }
    }
    if (S.smoke && Math.random() < dt * S.smoke.rate) {
      const a = S.smoke.area;
      smoke.push({ x: rand(a[0], a[2]), y: rand(a[1], a[3]), r: rand(40, 90), vx: rand(6, 16), vy: rand(-6, 2), life: rand(6, 10), max: 10 });
    }
    if (S.tracers && Math.random() < dt * S.tracers.rate) {
      const [ax, ay, bx, by] = pick(S.tracers.from);
      const x = rand(ax, bx), y = rand(ay, by);
      const ang = (x < 600 ? 0 : Math.PI) + rand(-0.18, 0.08);
      for (let i = 0; i < 3; i++) bolts.push({ x: x - Math.cos(ang) * i * 26, y: y - Math.sin(ang) * i * 26, vx: Math.cos(ang) * 900, vy: Math.sin(ang) * 900, life: 0.5, col: pick(S.tracers.cols), w: 1.6 });
    }
    if (S.muzzles) {
      S.muzzles.forEach(([x, y, dir], i) => {
        if (!every('muzzle' + i, 2.4, 5, dt)) return;
        flashes.push({ x, y, r: 70, life: 0.25, max: 0.25, rgb: '255, 230, 170' });
        burst(x, y, 18, ['#FFE7A8', '#FFB45A', '#FF8A3D'], 220);
        for (let k = 0; k < 6; k++) smoke.push({ x: x + dir * k * 8, y: y + rand(-6, 6), r: rand(10, 22), vx: dir * rand(10, 40), vy: rand(-10, 2), life: rand(1.5, 3), max: 3 });
      });
    }
    if (S.lasers && Math.random() < dt * S.lasers.rate) {
      const [from, to] = pick(S.lasers.lanes);
      const x0 = rand(from[0], from[2]), y0 = rand(from[1], from[3]), x1 = rand(to[0], to[2]), y1 = rand(to[1], to[3]);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const col = pick(S.lasers.cols);
      for (const off of [-4, 4]) bolts.push({ x: x0 - Math.sin(ang) * off, y: y0 + Math.cos(ang) * off, vx: Math.cos(ang) * 1100, vy: Math.sin(ang) * 1100, life: Math.hypot(x1 - x0, y1 - y0) / 1100, col, w: 2.4, hit: [x1, y1] });
    }
    if (S.bursts && every('burst', 0.8, 2.2, dt)) {
      const [x, y] = pick(S.bursts);
      flashes.push({ x, y, r: rand(50, 110), life: 0.5, max: 0.5, rgb: '255, 200, 120' });
      burst(x, y, 26, ['#FFE7A8', '#FFB45A', '#FFFFFF'], 260);
    }
    if (S.meteors && Math.random() < dt * S.meteors.rate) {
      const x = rand(60, 1140), dir = x < 600 ? 1 : -1;
      meteors.push({ x, y: -20, vx: dir * rand(60, 160), vy: rand(380, 520), stop: rand(220, 520) });
    }
    if (S.beams && every('beam', 0.6, 1.8, dt)) {
      const b = pick(S.beams);
      bolts.push({ beam: b, life: 0.35, max: 0.35 });
      flashes.push({ x: b[0], y: b[1], r: 26, life: 0.2, max: 0.2, rgb: '255, 110, 90' });
      burst(b[2], b[3], 10, ['#FF7A5A', '#FFB45A'], 120);
    }
    if (S.blasts && every('blast', 1.4, 3.2, dt)) {
      const [x, y] = pick(S.blasts);
      flashes.push({ x, y, r: rand(60, 120), life: 0.6, max: 0.6, rgb: '255, 170, 80' });
      burst(x, y, 30, ['#FFE7A8', '#FF8A3D', '#FFB45A'], 240);
      for (let k = 0; k < 5; k++) smoke.push({ x: x + rand(-20, 20), y: y - rand(0, 20), r: rand(16, 30), vx: rand(-8, 8), vy: rand(-26, -10), life: rand(2, 4), max: 4 });
    }
    if (S.map && every('ping', 0.6, 1.6, dt)) {
      const [x0, y0, x1, y1] = S.map;
      pings.push({ x: rand(x0 + 20, x1 - 20), y: rand(y0 + 20, y1 - 20), life: 1.4, max: 1.4 });
    }

    for (const m of meteors) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      for (let i = 0; i < 2; i++) sparks.push({ x: m.x + rand(-3, 3), y: m.y + rand(-3, 3), vx: rand(-15, 15), vy: rand(-40, -5), life: rand(0.3, 0.7), col: pick(['#FFE7A8', '#FFB45A', '#FF8A3D']) });
      if (m.y > m.stop) {
        m.done = true;
        flashes.push({ x: m.x, y: m.y, r: 60, life: 0.4, max: 0.4, rgb: '255, 180, 90' });
      }
    }
    for (const b of bolts) {
      if (b.beam) { b.life -= dt; continue; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 && b.hit && !b.boomed) {
        b.boomed = true;
        burst(b.hit[0], b.hit[1], 8, ['#FFE7A8', '#FFFFFF', b.col], 140);
      }
    }
    for (const p of sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy = p.vy * 0.96 + 30 * dt;
      p.life -= dt;
    }
    for (const e of embers) {
      e.x += (e.vx + Math.sin(t * 1.6 + e.p) * 10) * dt;
      e.y += e.vy * dt;
      e.life -= dt;
    }
    for (const s of smoke) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.r += 6 * dt;
      s.life -= dt;
    }
    for (const f of flashes) f.life -= dt;
    for (const p of pings) p.life -= dt;
    embers = embers.filter((e) => e.life > 0).slice(-500);
    smoke = smoke.filter((s) => s.life > 0).slice(-80);
    sparks = sparks.filter((p) => p.life > 0).slice(-700);
    bolts = bolts.filter((b) => b.life > 0);
    meteors = meteors.filter((m) => !m.done);
    flashes = flashes.filter((f) => f.life > 0);
    pings = pings.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------- drawing

  const radial = (x, y, r, rgb, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(0.45, `rgba(${rgb}, ${a * 0.35})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };

  function drawRadar([x, y, r], i) {
    const a = t * 1.3 + i * 2;
    ctx.save();
    ctx.translate(x, y);
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = `rgba(232, 201, 152, ${0.22 * (1 - k / 14)})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, a - (k + 1) * 0.06, a - k * 0.06);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(246, 226, 192, .75)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
    // Two contacts that light up as the sweep passes them.
    for (const [ang, d] of [[0.9 + i, 0.55], [3.6 + i * 1.7, 0.75]]) {
      const since = ((a - ang) % TAU + TAU) % TAU;
      const k = Math.max(0, 1 - since / 2.5);
      if (k <= 0) continue;
      ctx.fillStyle = `rgba(255, 236, 190, ${k})`;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * r * d, Math.sin(ang) * r * d, 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCctv([x0, y0, x1, y1], i) {
    const w = x1 - x0, h = y1 - y0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    // Grain.
    for (let k = 0; k < 90; k++) {
      ctx.fillStyle = `rgba(255, 255, 255, ${rand(0.02, 0.09)})`;
      ctx.fillRect(x0 + rand(0, w), y0 + rand(0, h), rand(1, 3), 1);
    }
    // Rolling bar and the odd signal drop.
    const bar = y0 + ((t * 40 + i * 50) % (h + 40)) - 20;
    const g = ctx.createLinearGradient(0, bar - 14, 0, bar + 14);
    g.addColorStop(0, 'rgba(255, 255, 255, 0)');
    g.addColorStop(0.5, 'rgba(255, 255, 255, .07)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, bar - 14, w, 28);
    if (Math.sin(t * 0.7 + i * 2.1) > 0.985) {
      ctx.fillStyle = 'rgba(200, 210, 230, .18)';
      ctx.fillRect(x0, y0, w, h);
    }
    ctx.restore();
    if (Math.sin(t * 3 + i) > 0) {
      ctx.fillStyle = 'rgba(255, 70, 60, .9)';
      ctx.beginPath();
      ctx.arc(x1 - 10, y0 + 10, 3, 0, TAU);
      ctx.fill();
    }
  }

  function drawCommandCenter() {
    const [mx0, my0, mx1, my1] = S.map;
    ctx.save();
    ctx.beginPath();
    ctx.rect(mx0, my0, mx1 - mx0, my1 - my0);
    ctx.clip();
    for (const p of pings) {
      const k = 1 - p.life / p.max;
      ctx.strokeStyle = `rgba(246, 211, 106, ${1 - k})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4 + k * 26, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 236, 190, ${1 - k})`;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.restore();
    // A highlight row scanning the field logs.
    const [lx0, ly0, lx1, ly1] = S.logs;
    const row = ly0 + 16 + (Math.floor(t * 2.5) % 10) * 12.4;
    ctx.fillStyle = 'rgba(216, 169, 51, .16)';
    ctx.fillRect(lx0 + 2, row, lx1 - lx0 - 4, 11);
    ctx.fillStyle = 'rgba(246, 211, 106, .7)';
    ctx.fillRect(lx0 + 2, row, 2, 11);
    // Live telemetry bars.
    const B = S.bars;
    B.xs.forEach((x, i) => {
      const k = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * (1.1 + i * 0.37) + i * 1.9));
      ctx.fillStyle = 'rgba(8, 12, 22, .95)';
      ctx.fillRect(x - 1, B.top - 1, B.w + 2, B.bottom - B.top + 2);
      const top = B.bottom - (B.bottom - B.top) * k;
      const g = ctx.createLinearGradient(0, top, 0, B.bottom);
      g.addColorStop(0, '#F6D36A');
      g.addColorStop(1, '#8A6436');
      ctx.fillStyle = g;
      ctx.fillRect(x, top, B.w, B.bottom - top);
    });
    for (const [x, y] of S.blinks) {
      if (Math.sin(t * 2.4 + x * 0.013 + y * 0.021) > 0.2) {
        ctx.fillStyle = 'rgba(246, 211, 106, .85)';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, IW, IH);
    // Smoke under everything else.
    for (const s of smoke) {
      const a = Math.min(1, s.life / 2) * Math.min(1, (s.max - s.life) / 1.5) * 0.16;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, `rgba(110, 116, 132, ${a})`);
      g.addColorStop(1, 'rgba(110, 116, 132, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    if (S.cctv) S.cctv.forEach(drawCctv);
    if (S.map) drawCommandCenter();

    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      ctx.globalAlpha = Math.max(0, Math.sin(t * s.s + s.p)) * 0.9;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (S.glows) for (const [x, y, r, rgb, a] of S.glows) {
      const fl = 0.75 + 0.25 * Math.sin(t * 7 + x) * Math.sin(t * 3.3 + y);
      radial(x, y, r, rgb, a * fl);
    }
    if (S.rotors) S.rotors.forEach(([x, y, r], i) => {
      const a = t * 28 + i;
      ctx.strokeStyle = 'rgba(200, 210, 230, .16)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r * 0.16);
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.16);
      ctx.stroke();
    });
    if (S.radars) S.radars.forEach(drawRadar);
    if (S.reticle) {
      const [x, y, r] = S.reticle;
      ctx.strokeStyle = 'rgba(232, 201, 152, .6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, r, t * 1.5, t * 1.5 + 1.6);
      ctx.moveTo(x + Math.cos(t * 1.5 + Math.PI) * r, y + Math.sin(t * 1.5 + Math.PI) * r);
      ctx.arc(x, y, r, t * 1.5 + Math.PI, t * 1.5 + Math.PI + 1.6);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (const b of bolts) {
      if (b.beam) {
        const k = b.life / b.max;
        const [x0, y0, x1, y1] = b.beam;
        ctx.strokeStyle = `rgba(255, 90, 80, ${0.9 * k})`;
        ctx.shadowColor = '#FF5A4A';
        ctx.shadowBlur = 14;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.shadowBlur = 0;
        continue;
      }
      ctx.strokeStyle = b.col;
      ctx.lineWidth = b.w;
      ctx.shadowColor = b.col;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (const m of meteors) {
      const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.35, m.y - m.vy * 0.35);
      g.addColorStop(0, 'rgba(255, 240, 200, .95)');
      g.addColorStop(0.3, 'rgba(255, 150, 60, .6)');
      g.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(m.x - m.vx * 0.35, m.y - m.vy * 0.35);
      ctx.stroke();
      radial(m.x, m.y, 22, '255, 210, 140', 0.9);
    }
    for (const f of flashes) radial(f.x, f.y, f.r * (1.3 - 0.3 * (f.life / f.max)), f.rgb, 0.85 * (f.life / f.max));
    for (const p of sparks) {
      ctx.globalAlpha = Math.min(1, p.life * 1.6);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    for (const e of embers) {
      ctx.globalAlpha = Math.min(1, e.life / 1.2) * Math.min(1, (e.max - e.life) * 2) * 0.85;
      ctx.fillStyle = e.col;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (S.scan) {
      const y = (t * 60) % (IH + 80) - 40;
      const g = ctx.createLinearGradient(0, y - 30, 0, y + 30);
      g.addColorStop(0, 'rgba(246, 211, 106, 0)');
      g.addColorStop(0.5, 'rgba(246, 211, 106, .05)');
      g.addColorStop(1, 'rgba(246, 211, 106, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 30, IW, 60);
    }
  }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    step(dt);
    draw();
    requestAnimationFrame(frame);
  }

  let visible = true;
  function play() {
    if (running || still.matches || document.hidden || !visible) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
  }
  function settle() {
    pause();
    ctx.clearRect(0, 0, IW, IH);
  }

  // Pointer parallax: the whole stage leans a few pixels toward the pointer.
  const hero = stage.closest('.hero-art');
  hero?.addEventListener('pointermove', (e) => {
    if (still.matches) return;
    const r = hero.getBoundingClientRect();
    stage.style.setProperty('--px', `${((e.clientX - r.left) / r.width - 0.5) * -14}px`);
    stage.style.setProperty('--py', `${((e.clientY - r.top) / r.height - 0.5) * -10}px`);
  });
  hero?.addEventListener('pointerleave', () => {
    stage.style.setProperty('--px', '0px');
    stage.style.setProperty('--py', '0px');
  });

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : pause(); }).observe(stage);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  still.addEventListener('change', () => (still.matches ? settle() : play()));
  window.addEventListener('resize', resize);
  resize();
  for (let i = 0; i < 90; i++) step(1 / 30);
  if (still.matches) settle();
  else play();
}
