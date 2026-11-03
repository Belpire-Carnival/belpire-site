// The hero backdrop on bureau.belpire.com: a running space battle over a dark world.
// Original art drawn on a canvas: stars, a planet horizon, searchlights from the citadel below,
// fighters trading navy-blue and bronze fire, explosions, smoke and rising embers, and two ground fronts below.
// Decoration only: the page reads the same without it. Reduced motion draws one still frame.

const canvas = document.getElementById('battle');
if (canvas && canvas.getContext) start(canvas);

function start(canvas) {
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const BLUE = ['#7FB2FF', '#4C86F0', '#B9D4FF'];
  const GOLD = ['#E8C998', '#D3A86A', '#F6E2C0'];

  let W = 0, H = 0, dpr = 1, stars = [], ridge = [], ships = [], bolts = [], sparks = [], smoke = [], flashes = [], embers = [];
  let running = false, last = 0, t = 0, nextShip = 0;

  // Ship outlines, nose pointing right, unit length 1 (scaled per ship). All original shapes.
  const SHAPES = {
    dart: [[1, 0], [0.35, -0.12], [0.1, -0.42], [-0.05, -0.42], [0.05, -0.12], [-0.35, -0.16], [-0.42, -0.06], [-0.42, 0.06], [-0.35, 0.16], [0.05, 0.12], [-0.05, 0.42], [0.1, 0.42], [0.35, 0.12]],
    lancer: [[1, 0], [0.55, -0.08], [0.2, -0.1], [-0.05, -0.3], [-0.3, -0.3], [-0.2, -0.1], [-0.45, -0.1], [-0.45, 0.1], [-0.2, 0.1], [-0.3, 0.3], [-0.05, 0.3], [0.2, 0.1], [0.55, 0.08]]
  };
  const ENGINES = { dart: [[-0.42, -0.04], [-0.42, 0.04]], lancer: [[-0.45, 0]] };
  let nebula = null;
  let fronts = null;

  function resize() {
    const box = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, box.width);
    H = Math.max(1, box.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((W * H) / 2600);
    stars = Array.from({ length: n }, () => ({ x: rand(0, W), y: rand(0, H * 0.82), r: Math.random() < 0.93 ? rand(0.3, 1.1) : rand(1.2, 1.9), p: rand(0, Math.PI * 2), s: rand(0.6, 2.2), c: Math.random() < 0.18 ? '#FFE7B0' : Math.random() < 0.3 ? '#BFD6FF' : '#FFFFFF' }));
    nebula = paintNebula();
    fronts = buildFronts();
    // Jagged ridge line for the ground, with a citadel spire in the middle.
    ridge = [];
    const base = H * 0.86;
    for (let x = -20; x <= W + 20; x += rand(18, 46)) ridge.push([x, base - rand(0, H * 0.07) - (Math.abs(x - W / 2) < W * 0.08 ? H * 0.05 : 0)]);
    if (!running) frame(performance.now(), true);
  }

  // Painted once per resize: coloured gas clouds in navy, blue and a little gold.
  function paintNebula() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W / 2));
    c.height = Math.max(1, Math.round(H / 2));
    const g = c.getContext('2d');
    const blobs = [
      [0.78, 0.18, 0.42, '38, 72, 160', 0.38], [0.2, 0.32, 0.38, '26, 52, 130', 0.42], [0.55, 0.08, 0.3, '70, 110, 210', 0.22],
      [0.9, 0.5, 0.28, '180, 130, 50', 0.12], [0.08, 0.1, 0.25, '120, 90, 40', 0.1], [0.45, 0.45, 0.5, '18, 36, 90', 0.35]
    ];
    for (const [x, y, r, rgb, a] of blobs) {
      for (let i = 0; i < 6; i++) {
        const cx = (x + rand(-0.06, 0.06)) * c.width, cy = (y + rand(-0.05, 0.05)) * c.height, rr = r * c.width * rand(0.4, 0.9);
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
        gr.addColorStop(0, `rgba(${rgb}, ${a * rand(0.5, 1)})`);
        gr.addColorStop(1, `rgba(${rgb}, 0)`);
        g.fillStyle = gr;
        g.fillRect(0, 0, c.width, c.height);
      }
    }
    return c;
  }

  // Two ground fronts under the space fight, one in each lower corner: a burning line held by
  // troopers (left) and an armoured push with a tank and a helicopter (right). Silhouettes only.
  function buildFronts() {
    const u = Math.max(0.75, Math.min(1.6, H / 640)) * Math.max(0.65, Math.min(1.1, W / 1200));
    const g = H * 0.86;
    const L = W * 0.2, R = W * 0.8;
    return {
      u, g, L, R,
      fires: [[L - 70 * u, 1.2], [L + 30 * u, 0.8], [L + 95 * u, 1], [R + 80 * u, 0.9]].map(([x, k]) => ({ x, k, p: rand(0, 6) })),
      troops: [
        ...[-110, -40, 55, 120].map((dx, i) => ({ x: L + dx * u, dir: 1, kneel: i % 2 === 1, cd: rand(0, 2), flash: 0 })),
        ...[-130, -70, 130].map((dx, i) => ({ x: R + dx * u, dir: -1, kneel: i === 1, cd: rand(0, 2), flash: 0 }))
      ],
      tank: { x: R - 10 * u, cd: rand(1, 3), flash: 0 },
      heli: { x: R + 40 * u, y: g - 92 * u, vx: 14 * u, p: 0 }
    };
  }

  function stepFronts(dt) {
    const f = fronts;
    if (!f) return;
    for (const fire of f.fires) {
      if (Math.random() < dt * 9 * fire.k) smoke.push({ x: fire.x + rand(-6, 6) * f.u, y: f.g - 22 * f.u * fire.k, r: rand(6, 12) * f.u, vx: rand(4, 16) * f.u, vy: rand(-46, -26) * f.u, life: rand(2.5, 4.5), max: 4.5 });
      if (Math.random() < dt * 6) embers.push({ x: fire.x + rand(-8, 8), y: f.g - 20 * f.u, vy: rand(-70, -30), vx: rand(-10, 20), life: rand(1.5, 3), r: rand(0.6, 1.6), p: rand(0, 6) });
    }
    for (const tr of f.troops) {
      tr.flash = Math.max(0, tr.flash - dt);
      tr.cd -= dt;
      if (tr.cd <= 0) {
        tr.cd = rand(0.6, 2.4);
        tr.flash = 0.08;
        const a = -Math.PI / 2 + tr.dir * rand(0.25, 0.9);
        const v = rand(500, 800);
        const mx = tr.x + tr.dir * 14 * f.u, my = f.g - (tr.kneel ? 16 : 24) * f.u;
        bolts.push({ x: mx, y: my, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.5, 0.9), col: pick(GOLD), team: 'ground' });
      }
    }
    const tk = f.tank;
    tk.flash = Math.max(0, tk.flash - dt);
    tk.cd -= dt;
    if (tk.cd <= 0) {
      tk.cd = rand(2.5, 5);
      tk.flash = 0.18;
      boom(tk.x - 70 * f.u, f.g - 32 * f.u, false);
      for (let i = 0; i < 5; i++) smoke.push({ x: tk.x - 70 * f.u, y: f.g - 30 * f.u, r: rand(5, 10) * f.u, vx: rand(-30, -5), vy: rand(-12, 4), life: rand(1, 2), max: 2 });
    }
    const h = f.heli;
    h.p += dt;
    h.x += h.vx * dt;
    if (Math.abs(h.x - (f.R + 40 * f.u)) > 90 * f.u) h.vx *= -1;
  }

  function trooper(x, g, u, dir, kneel, flash) {
    const h = kneel ? 17 : 25;
    ctx.save();
    ctx.translate(x, g);
    ctx.scale(dir * u, u);
    ctx.beginPath();
    ctx.arc(0, -h - 3, 3, 0, Math.PI * 2); // helmet
    ctx.moveTo(-3, -h);
    ctx.lineTo(3, -h);
    ctx.lineTo(4, -h + 11);
    ctx.lineTo(-4, -h + 11);
    ctx.closePath();
    if (kneel) {
      ctx.moveTo(-4, -h + 11); ctx.lineTo(-7, 0); ctx.lineTo(-3, 0); ctx.lineTo(-1, -h + 12);
      ctx.moveTo(2, -h + 11); ctx.lineTo(8, -4); ctx.lineTo(8, 0); ctx.lineTo(4, 0); ctx.lineTo(4, -3); ctx.lineTo(0, -h + 12);
    } else {
      ctx.moveTo(-4, -h + 11); ctx.lineTo(-5, 0); ctx.lineTo(-2, 0); ctx.lineTo(0, -h + 13);
      ctx.moveTo(1, -h + 11); ctx.lineTo(4, 0); ctx.lineTo(7, 0); ctx.lineTo(4, -h + 11);
    }
    ctx.fill();
    ctx.fillRect(1, -h + 3, 14, 2.2); // rifle
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255, 220, 140, .95)';
      ctx.beginPath();
      ctx.arc(16, -h + 4, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFronts() {
    const f = fronts;
    if (!f) return;
    const { u, g, L, R } = f;
    // Firelight and haze behind each front so the silhouettes read against it.
    ctx.globalCompositeOperation = 'lighter';
    const glowL = ctx.createRadialGradient(L, g, 0, L, g, 230 * u);
    glowL.addColorStop(0, `rgba(255, 140, 50, ${0.6 + 0.08 * Math.sin(t * 9)})`);
    glowL.addColorStop(0.5, 'rgba(200, 80, 30, .22)');
    glowL.addColorStop(1, 'rgba(120, 40, 10, 0)');
    ctx.fillStyle = glowL;
    ctx.fillRect(L - 240 * u, g - 240 * u, 480 * u, 260 * u);
    const glowR = ctx.createRadialGradient(R, g - 20 * u, 0, R, g - 20 * u, 240 * u);
    glowR.addColorStop(0, 'rgba(170, 195, 240, .42)');
    glowR.addColorStop(0.55, 'rgba(90, 110, 160, .16)');
    glowR.addColorStop(1, 'rgba(60, 70, 110, 0)');
    ctx.fillStyle = glowR;
    ctx.fillRect(R - 250 * u, g - 260 * u, 500 * u, 280 * u);
    ctx.globalCompositeOperation = 'source-over';
    // The ground each front stands on.
    ctx.fillStyle = '#03050B';
    for (const cx of [L, R]) {
      ctx.beginPath();
      ctx.moveTo(cx - 230 * u, H);
      ctx.lineTo(cx - 200 * u, g + 4 * u);
      ctx.lineTo(cx - 60 * u, g - 2 * u);
      ctx.lineTo(cx + 70 * u, g + 1 * u);
      ctx.lineTo(cx + 210 * u, g + 5 * u);
      ctx.lineTo(cx + 240 * u, H);
      ctx.fill();
    }
    // Fires.
    ctx.globalCompositeOperation = 'lighter';
    for (const fire of f.fires) {
      const k = fire.k * u;
      for (let i = 0; i < 4; i++) {
        const fl = 1 + 0.18 * Math.sin(t * (11 + i * 3) + fire.p + i);
        const fg = ctx.createRadialGradient(fire.x, g - 8 * k, 0, fire.x, g - 8 * k, 26 * k * fl);
        fg.addColorStop(0, 'rgba(255, 236, 170, .9)');
        fg.addColorStop(0.35, 'rgba(255, 150, 50, .6)');
        fg.addColorStop(1, 'rgba(200, 60, 20, 0)');
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.ellipse(fire.x + (i - 1.5) * 5 * k, g - 14 * k * fl, 9 * k, 22 * k * fl, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Troopers, the tank and the helicopter in silhouette.
    ctx.fillStyle = '#05070D';
    for (const tr of f.troops) {
      ctx.fillStyle = '#05070D';
      trooper(tr.x, g, u, tr.dir, tr.kneel, tr.flash);
    }
    const tk = f.tank;
    ctx.save();
    ctx.translate(tk.x, g);
    ctx.scale(u, u);
    ctx.fillStyle = '#05070D';
    ctx.beginPath();
    ctx.moveTo(-46, 0); ctx.lineTo(-52, -10); ctx.lineTo(-40, -20); ctx.lineTo(44, -20); ctx.lineTo(52, -10); ctx.lineTo(46, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-22, -20); ctx.lineTo(-16, -32); ctx.lineTo(16, -32); ctx.lineTo(24, -20);
    ctx.fill();
    ctx.fillRect(-70, -29, 56, 4); // barrel, aimed left
    ctx.strokeStyle = 'rgba(150, 175, 220, .35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-40, -20); ctx.lineTo(44, -20); ctx.moveTo(-16, -32); ctx.lineTo(16, -32);
    ctx.stroke();
    if (tk.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const mf = ctx.createRadialGradient(-74, -27, 0, -74, -27, 26);
      mf.addColorStop(0, 'rgba(255, 240, 200, 1)');
      mf.addColorStop(1, 'rgba(255, 150, 60, 0)');
      ctx.fillStyle = mf;
      ctx.beginPath();
      ctx.arc(-74, -27, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    const h = f.heli;
    ctx.save();
    ctx.translate(h.x, h.y + Math.sin(h.p * 1.3) * 4 * u);
    ctx.scale(u * (h.vx > 0 ? 1 : -1), u);
    ctx.rotate(0.08);
    ctx.fillStyle = '#070A12';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, -2); ctx.lineTo(-50, -4); ctx.lineTo(-56, -14); ctx.lineTo(-52, 0); ctx.lineTo(-14, 4);
    ctx.fill();
    ctx.fillRect(-8, 9, 22, 2);
    ctx.fillRect(-2, -12, 3, 5);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(160, 180, 220, .5)';
    ctx.beginPath();
    ctx.ellipse(0, -12, 34 + Math.sin(h.p * 40) * 4, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = Math.sin(h.p * 5) > 0.6 ? '#FF6A5A' : '#2A1515';
    ctx.fillRect(-55, -15, 2.5, 2.5);
    ctx.restore();
  }

  function spawnShip(initial = false) {
    const kind = pick(['dart', 'dart', 'lancer']);
    const fromLeft = Math.random() < 0.5;
    const side = fromLeft ? 1 : -1;
    const size = rand(26, 58) * Math.min(1.3, Math.max(0.6, W / 1300));
    const speed = rand(90, 170) * (W / 1200 + 0.4);
    const y = rand(H * 0.08, H * 0.62);
    ships.push({
      kind, size, side,
      x: initial ? rand(0, W) : fromLeft ? -size * 2 : W + size * 2,
      y, vy: rand(-18, 18), speed,
      team: fromLeft ? 'blue' : 'gold',
      wob: rand(0, 6), fire: rand(0.3, 1.6), hp: 2,
      smoking: false
    });
  }

  function fire(s) {
    const enemies = ships.filter((o) => o.team !== s.team);
    const target = enemies.length ? pick(enemies) : null;
    const ang = target ? Math.atan2(target.y - s.y, target.x - s.x) + rand(-0.12, 0.12) : (s.side > 0 ? 0 : Math.PI) + rand(-0.3, 0.3);
    const v = rand(700, 1000);
    const col = s.team === 'blue' ? pick(BLUE) : pick(GOLD);
    const n = 2;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 6;
      bolts.push({ x: s.x + Math.cos(ang) * s.size * 0.7 - Math.sin(ang) * off, y: s.y + Math.sin(ang) * s.size * 0.7 + Math.cos(ang) * off, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: rand(0.5, 0.9), col, team: s.team });
    }
  }

  function boom(x, y, big) {
    flashes.push({ x, y, r: big ? rand(70, 120) : rand(24, 44), life: big ? 0.7 : 0.35, max: big ? 0.7 : 0.35 });
    const n = big ? 60 : 16;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(40, big ? 420 : 220);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, big ? 1.6 : 0.8), col: pick(['#FFE7A8', '#F6B24A', '#FF8A3D', '#FFFFFF']) });
    }
    if (big) for (let i = 0; i < 14; i++) smoke.push({ x: x + rand(-20, 20), y: y + rand(-20, 20), r: rand(8, 22), vx: rand(-20, 20), vy: rand(-30, 5), life: rand(1.5, 3), max: 3 });
  }

  function step(dt) {
    t += dt;
    nextShip -= dt;
    const cap = Math.round(8 + W / 160);
    stepFronts(dt);
    // Flak and distant flashes keep the sky busy.
    if (Math.random() < dt * 1.4) boom(rand(0, W), rand(H * 0.05, H * 0.6), Math.random() < 0.25);
    if (nextShip <= 0 && ships.length < cap) {
      spawnShip();
      nextShip = rand(0.3, 1.1);
    }
    for (const s of ships) {
      s.x += s.side * s.speed * dt;
      s.y += Math.sin(t * 0.9 + s.wob) * s.vy * dt;
      s.fire -= dt;
      if (s.fire <= 0 && s.x > -20 && s.x < W + 20) {
        fire(s);
        s.fire = rand(0.4, 1.4);
      }
      if (s.smoking && Math.random() < 0.6) smoke.push({ x: s.x - s.side * s.size * 0.4, y: s.y, r: rand(3, 7), vx: rand(-8, 8), vy: rand(-10, 10), life: rand(1, 2.2), max: 2.2 });
    }
    for (const b of bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      for (const s of ships) {
        if (s.team === b.team || b.team === 'ground' || b.life <= 0) continue;
        if (Math.abs(s.x - b.x) < s.size * 0.5 && Math.abs(s.y - b.y) < s.size * 0.28) {
          b.life = 0;
          s.hp -= 1;
          boom(b.x, b.y, false);
          if (s.hp <= 2) s.smoking = true;
          if (s.hp <= 0) {
            boom(s.x, s.y, true);
            s.dead = true;
          }
        }
      }
    }
    for (const p of sparks) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.vy = p.vy * 0.97 + 20 * dt;
      p.life -= dt;
    }
    for (const p of smoke) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 10 * dt;
      p.life -= dt;
    }
    for (const f of flashes) f.life -= dt;
    // Embers drift up from the battlefield below.
    if (embers.length < W / 6) embers.push({ x: rand(0, W), y: H + 5, vy: rand(-60, -18), vx: rand(-12, 12), life: rand(3, 8), r: rand(0.6, 1.8), p: rand(0, 6) });
    for (const e of embers) {
      e.x += (e.vx + Math.sin(t * 1.5 + e.p) * 8) * dt;
      e.y += e.vy * dt;
      e.life -= dt;
    }
    ships = ships.filter((s) => !s.dead && s.x > -s.size * 3 && s.x < W + s.size * 3);
    bolts = bolts.filter((b) => b.life > 0);
    sparks = sparks.filter((p) => p.life > 0);
    smoke = smoke.filter((p) => p.life > 0).slice(-260);
    flashes = flashes.filter((f) => f.life > 0);
    embers = embers.filter((e) => e.life > 0 && e.y > -10);
  }

  function drawShip(s) {
    const pts = SHAPES[s.kind];
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.side, 1);
    ctx.rotate(Math.sin(t * 0.9 + s.wob) * s.vy * 0.004);
    ctx.scale(s.size, s.size);
    // Engine glow.
    ctx.globalCompositeOperation = 'lighter';
    for (const [ex, ey] of ENGINES[s.kind]) {
      const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, 0.32);
      const hue = s.team === 'blue' ? '120, 170, 255' : '255, 200, 110';
      g.addColorStop(0, `rgba(${hue}, .95)`);
      g.addColorStop(1, `rgba(${hue}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(ex - 0.12, ey, 0.34, 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Hull with a rim light from the planet's glow.
    const body = ctx.createLinearGradient(0, -0.4, 0, 0.4);
    body.addColorStop(0, s.team === 'blue' ? '#3A4A6B' : '#5A4A2A');
    body.addColorStop(0.55, '#141A26');
    body.addColorStop(1, '#0A0D14');
    ctx.fillStyle = body;
    ctx.strokeStyle = s.team === 'blue' ? 'rgba(140, 180, 255, .55)' : 'rgba(240, 200, 120, .55)';
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Panel lines, cockpit glass and running lights.
    ctx.strokeStyle = 'rgba(255, 255, 255, .12)';
    ctx.lineWidth = 0.01;
    ctx.beginPath();
    ctx.moveTo(-0.3, 0);
    ctx.lineTo(0.6, 0);
    ctx.stroke();
    ctx.fillStyle = s.team === 'blue' ? 'rgba(140, 190, 255, .55)' : 'rgba(255, 210, 140, .55)';
    ctx.beginPath();
    ctx.ellipse(0.45, 0, 0.12, 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = s.team === 'blue' ? '#9CC2FF' : '#FFD98A';
    if (Math.sin(t * 6 + s.wob) > 0.4) {
      ctx.beginPath();
      ctx.arc(0.15, 0, 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawScene() {
    ctx.clearRect(0, 0, W, H);
    // Stars.
    for (const s of stars) {
      ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(t * s.s * 0.5 + s.p));
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (nebula) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(nebula, 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Planet horizon: a huge dark world with a navy atmosphere and a thin bright limb.
    const R = W * 1.6, cx = W / 2, cy = H * 0.74 + R;
    const atmo = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.06);
    atmo.addColorStop(0, 'rgba(80, 130, 240, .75)');
    atmo.addColorStop(0.35, 'rgba(40, 80, 200, .35)');
    atmo.addColorStop(1, 'rgba(20, 40, 120, 0)');
    ctx.fillStyle = atmo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.06, 0, Math.PI * 2);
    ctx.fill();
    const ground = ctx.createLinearGradient(0, H * 0.72, 0, H);
    ground.addColorStop(0, '#0B1430');
    ground.addColorStop(1, '#03060E');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(170, 205, 255, .7)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI * 1.32, Math.PI * 1.68);
    ctx.stroke();
    // Searchlights sweeping up from the citadel.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const bx = W / 2 + (i - 2) * W * 0.07;
      const a = -Math.PI / 2 + Math.sin(t * 0.35 + i * 1.7) * 0.42;
      const len = H * 0.9;
      const g = ctx.createLinearGradient(bx, H * 0.86, bx + Math.cos(a) * len, H * 0.86 + Math.sin(a) * len);
      g.addColorStop(0, 'rgba(200, 220, 255, .16)');
      g.addColorStop(1, 'rgba(200, 220, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx, H * 0.86);
      ctx.lineTo(bx + Math.cos(a - 0.04) * len, H * 0.86 + Math.sin(a - 0.04) * len);
      ctx.lineTo(bx + Math.cos(a + 0.04) * len, H * 0.86 + Math.sin(a + 0.04) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Smoke (behind the fight).
    for (const p of smoke) {
      const a = Math.max(0, p.life / p.max) * 0.28;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(120, 128, 150, ${a})`);
      g.addColorStop(1, 'rgba(120, 128, 150, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Ships, far (small) first.
    ships.sort((a, b) => a.size - b.size).forEach(drawShip);
    // Bolts and sparks glow.
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of bolts) {
      const len = 0.035;
      ctx.strokeStyle = b.col;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = b.col;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * len, b.y - b.vy * len);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    for (const p of sparks) {
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    for (const f of flashes) {
      const k = f.life / f.max;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (1.4 - k * 0.4));
      g.addColorStop(0, `rgba(255, 245, 220, ${0.9 * k})`);
      g.addColorStop(0.35, `rgba(255, 170, 70, ${0.55 * k})`);
      g.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const e of embers) {
      ctx.globalAlpha = Math.min(1, e.life / 2) * 0.8;
      ctx.fillStyle = e.r > 1.3 ? '#FFB45A' : '#FFD98A';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // The ridge and citadel in silhouette, with a few lit windows.
    ctx.fillStyle = '#02040A';
    ctx.beginPath();
    ctx.moveTo(-20, H + 2);
    for (const [x, y] of ridge) ctx.lineTo(x, y);
    ctx.lineTo(W + 20, H + 2);
    ctx.closePath();
    ctx.fill();
    const sw = Math.max(16, W * 0.018), top = H * 0.6;
    ctx.beginPath();
    ctx.moveTo(W / 2 - sw, H);
    ctx.lineTo(W / 2 - sw * 0.6, top + H * 0.08);
    ctx.lineTo(W / 2 - sw * 0.25, top);
    ctx.lineTo(W / 2 + sw * 0.25, top);
    ctx.lineTo(W / 2 + sw * 0.6, top + H * 0.08);
    ctx.lineTo(W / 2 + sw, H);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 200, 110, .85)';
    for (let i = 0; i < 9; i++) {
      if (Math.sin(t * 0.7 + i * 2.3) > -0.2) ctx.fillRect(W / 2 - sw * 0.3 + (i % 3) * sw * 0.25, top + H * 0.1 + Math.floor(i / 3) * H * 0.035, 2, 3);
    }
    drawFronts();
  }

  function frame(now, once = false) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!once) step(dt);
    drawScene();
    if (running) requestAnimationFrame(frame);
  }

  function prime() {
    // Fill the sky before the first frame so a still (or first) frame isn't empty.
    for (let i = 0; i < 9; i++) spawnShip(true);
    for (let i = 0; i < 160; i++) step(1 / 30);
  }

  function play() {
    if (running || still.matches || document.hidden || !visible) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  const pause = () => { running = false; };

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : pause(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  still.addEventListener('change', () => (still.matches ? (pause(), frame(performance.now(), true)) : play()));
  window.addEventListener('resize', resize);
  resize();
  prime();
  frame(performance.now(), true);
  play();
}
