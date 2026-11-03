// The HQ hero backdrop on bureau.belpire.com (division pages use painted art + fx.js instead).
// One canvas, one scene picked from <body data-division>; the division scenes stay as a fallback for a
// new division that has no painted art yet:
//   hq    fighters in space over a planet and citadel, with a ground front in each lower corner
//   rsi1  Star Citizen: a dogfight through an asteroid field above a planet
//   se1   Helldivers: a hostile world at dusk, drop pods and orbital strikes, troopers holding off a swarm
//   bf1   Battlefield: combined arms, tanks and helicopters on the ground, jets overhead, artillery on the horizon
//   sq1   Squad: a night firefight between trench lines under drifting flares
// Original silhouettes only. Decoration: the page reads the same without it; reduced motion draws one still frame.

const canvas = document.getElementById('battle');
if (canvas && canvas.getContext) start(canvas);

function start(canvas) {
  const ctx = canvas.getContext('2d');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const BLUE = ['#7FB2FF', '#4C86F0', '#B9D4FF'];
  const GOLD = ['#E8C998', '#D3A86A', '#F6E2C0'];
  const INK = '#04060C';

  const SCENES = {
    hq: { space: true, planet: true, citadel: true, searchlights: true, ships: 1, flak: 1.4, embers: 1, corners: true },
    rsi1: { space: true, planet: true, ships: 1.5, flak: 1.8, asteroids: true },
    se1: { sky: ['#050A1C', '#24132E', '#7A3418'], haze: '255, 120, 50', stars: 0.5, embers: 1.6 },
    bf1: { sky: ['#060B1B', '#1C2840', '#5C544A'], haze: '200, 190, 170', stars: 0.35, embers: 1, jets: true },
    sq1: { sky: ['#02050D', '#071225', '#101C2C'], haze: '120, 150, 190', stars: 1, embers: 0.4 },
    tc1: { sky: ['#03070E', '#0E1E26', '#2E3A3A'], haze: '150, 190, 180', stars: 0.6, embers: 0.8, jets: true, cast: 'bf1' }
  };
  const MODE = SCENES[document.body.dataset.division] ? document.body.dataset.division : 'hq';
  const S = SCENES[MODE];
  const ACT = S.cast || MODE; // which cast of actors to use (tc1 borrows bf1's)

  let W = 0, H = 0, dpr = 1, u = 1, g = 0, hz = 0;
  let stars = [], ridge = [], hills = [], ships = [], bolts = [], sparks = [], smoke = [], flashes = [], embers = [];
  let troops = [], tanks = [], helis = [], fires = [], glows = [], critters = [], pods = [], beams = [], flares = [], rocks = [];
  let nebula = null, running = false, last = 0, t = 0, nextShip = 0, timers = {};

  // Ship outlines, nose pointing right, unit length 1 (scaled per ship).
  const SHAPES = {
    dart: [[1, 0], [0.35, -0.12], [0.1, -0.42], [-0.05, -0.42], [0.05, -0.12], [-0.35, -0.16], [-0.42, -0.06], [-0.42, 0.06], [-0.35, 0.16], [0.05, 0.12], [-0.05, 0.42], [0.1, 0.42], [0.35, 0.12]],
    lancer: [[1, 0], [0.55, -0.08], [0.2, -0.1], [-0.05, -0.3], [-0.3, -0.3], [-0.2, -0.1], [-0.45, -0.1], [-0.45, 0.1], [-0.2, 0.1], [-0.3, 0.3], [-0.05, 0.3], [0.2, 0.1], [0.55, 0.08]]
  };
  const ENGINES = { dart: [[-0.42, -0.04], [-0.42, 0.04]], lancer: [[-0.45, 0]] };

  // ------------------------------------------------------------------ layout

  function resize() {
    const box = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, box.width);
    H = Math.max(1, box.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    u = Math.max(0.75, Math.min(1.6, H / 640)) * Math.max(0.65, Math.min(1.1, W / 1200));
    g = H * 0.86;
    hz = H * 0.76;
    const n = Math.round((W * H) / 2600);
    stars = Array.from({ length: n }, () => ({ x: rand(0, W), y: rand(0, S.space ? H * 0.82 : hz * 0.9), r: Math.random() < 0.93 ? rand(0.3, 1.1) : rand(1.2, 1.9), p: rand(0, Math.PI * 2), s: rand(0.6, 2.2), c: Math.random() < 0.18 ? '#FFE7B0' : Math.random() < 0.3 ? '#BFD6FF' : '#FFFFFF' }));
    nebula = S.space ? paintNebula() : null;
    ridge = [];
    for (let x = -20; x <= W + 20; x += rand(18, 46)) {
      const lift = S.citadel && Math.abs(x - W / 2) < W * 0.08 ? H * 0.05 : 0;
      ridge.push([x, (S.space ? H * 0.86 - rand(0, H * 0.07) : g - rand(0, H * 0.025)) - lift]);
    }
    hills = [0, 1].map((layer) => {
      const pts = [];
      for (let x = -40; x <= W + 40; x += rand(40, 110)) pts.push([x, hz - rand(0, H * (layer ? 0.05 : 0.1)) + layer * H * 0.03]);
      return pts;
    });
    build();
    if (!running) frame(performance.now(), true);
  }

  function paintNebula() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W / 2));
    c.height = Math.max(1, Math.round(H / 2));
    const n = c.getContext('2d');
    const blobs = [
      [0.78, 0.18, 0.42, '38, 72, 160', 0.38], [0.2, 0.32, 0.38, '26, 52, 130', 0.42], [0.55, 0.08, 0.3, '70, 110, 210', 0.22],
      [0.9, 0.5, 0.28, '180, 130, 50', 0.12], [0.08, 0.1, 0.25, '120, 90, 40', 0.1], [0.45, 0.45, 0.5, '18, 36, 90', 0.35]
    ];
    for (const [x, y, r, rgb, a] of blobs) {
      for (let i = 0; i < 6; i++) {
        const cx = (x + rand(-0.06, 0.06)) * c.width, cy = (y + rand(-0.05, 0.05)) * c.height, rr = r * c.width * rand(0.4, 0.9);
        const gr = n.createRadialGradient(cx, cy, 0, cx, cy, rr);
        gr.addColorStop(0, `rgba(${rgb}, ${a * rand(0.5, 1)})`);
        gr.addColorStop(1, `rgba(${rgb}, 0)`);
        n.fillStyle = gr;
        n.fillRect(0, 0, c.width, c.height);
      }
    }
    return c;
  }

  const trooperAt = (x, dir, kneel = Math.random() < 0.4) => ({ x, dir, kneel, cd: rand(0, 2), flash: 0 });

  // Everyone on the ground for this scene.
  function build() {
    troops = []; tanks = []; helis = []; fires = []; glows = []; critters = []; rocks = [];
    const L = W * 0.2, R = W * 0.8;
    if (ACT === 'hq') {
      fires = [[L - 70 * u, 1.2], [L + 30 * u, 0.8], [L + 95 * u, 1], [R + 80 * u, 0.9]].map(([x, k]) => ({ x, k, p: rand(0, 6) }));
      troops = [...[-110, -40, 55, 120].map((dx, i) => trooperAt(L + dx * u, 1, i % 2 === 1)), ...[-130, -70, 130].map((dx, i) => trooperAt(R + dx * u, -1, i === 1))];
      tanks = [{ x: R - 10 * u, dir: -1, cd: rand(1, 3), flash: 0 }];
      helis = [{ x: R + 40 * u, y: g - 92 * u, vx: 14 * u, home: R + 40 * u, range: 90 * u, p: 0, cd: 99 }];
      glows = [{ x: L, y: g, r: 230, rgb: '255, 140, 50', a: 0.6, flicker: true }, { x: R, y: g - 20 * u, r: 240, rgb: '170, 195, 240', a: 0.42 }];
    } else if (ACT === 'rsi1') {
      rocks = Array.from({ length: Math.round(10 + W / 130) }, () => rock());
    } else if (ACT === 'se1') {
      for (let i = 0; i < 7; i++) troops.push(trooperAt(W * (0.06 + i * 0.06) + rand(-10, 10), 1));
      for (let i = 0; i < Math.round(10 + W / 120); i++) critters.push(critter(rand(W * 0.58, W * 1.05)));
      fires = [0.12, 0.3, 0.5, 0.72, 0.9].map((k) => ({ x: W * k + rand(-30, 30), k: rand(0.8, 1.4), p: rand(0, 6) }));
      glows = [{ x: W * 0.3, y: g, r: 420, rgb: '255, 120, 40', a: 0.45, flicker: true }, { x: W * 0.78, y: g, r: 380, rgb: '255, 90, 40', a: 0.35, flicker: true }];
    } else if (ACT === 'bf1') {
      tanks = [{ x: W * 0.16, dir: 1, cd: rand(1, 3), flash: 0 }, { x: W * 0.34, dir: 1, cd: rand(2, 4), flash: 0 }, { x: W * 0.82, dir: -1, cd: rand(1, 3), flash: 0 }];
      for (let i = 0; i < 5; i++) troops.push(trooperAt(W * (0.05 + i * 0.07) + rand(-12, 12), 1));
      for (let i = 0; i < 4; i++) troops.push(trooperAt(W * (0.66 + i * 0.07) + rand(-12, 12), -1));
      helis = [{ x: W * 0.26, y: g - 150 * u, vx: 18 * u, home: W * 0.26, range: 120 * u, p: 0, cd: rand(2, 4), dir: 1 }, { x: W * 0.74, y: g - 190 * u, vx: -14 * u, home: W * 0.74, range: 100 * u, p: 1, cd: rand(2, 4), dir: -1 }];
      fires = [0.24, 0.56, 0.88].map((k) => ({ x: W * k + rand(-30, 30), k: rand(0.7, 1.1), p: rand(0, 6) }));
      glows = [{ x: W * 0.5, y: hz, r: 600, rgb: '210, 190, 160', a: 0.22 }, { x: W * 0.2, y: g, r: 300, rgb: '255, 150, 60', a: 0.3, flicker: true }];
    } else if (ACT === 'sq1') {
      for (let i = 0; i < 6; i++) troops.push(trooperAt(W * (0.05 + i * 0.055) + rand(-8, 8), 1, Math.random() < 0.7));
      for (let i = 0; i < 6; i++) troops.push(trooperAt(W * (0.67 + i * 0.055) + rand(-8, 8), -1, Math.random() < 0.7));
      fires = [{ x: W * 0.5 + rand(-60, 60), k: 0.8, p: 0 }];
      glows = [{ x: W * 0.5, y: g, r: 260, rgb: '255, 140, 60', a: 0.25, flicker: true }];
    }
  }

  const critter = (x) => ({ x, vx: -rand(26, 60) * u, p: rand(0, 6), hp: 2, s: rand(0.8, 1.3) });

  function rock() {
    const r = rand(5, 26) * u;
    const n = 7 + Math.floor(rand(0, 4));
    // Keep the field to the sides so the crest and title stay clear.
    const side = Math.random() < 0.5 ? rand(-50, W * 0.32) : rand(W * 0.68, W + 50);
    return { x: side, y: rand(H * 0.05, H * 0.7), r, vx: rand(-8, 8), vy: rand(-4, 4), a: rand(0, 6), va: rand(-0.3, 0.3), pts: Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2), Math.sin((i / n) * Math.PI * 2), rand(0.65, 1)]) };
  }

  // ------------------------------------------------------------------ effects

  function boom(x, y, big) {
    flashes.push({ x, y, r: big ? rand(70, 120) : rand(24, 44), life: big ? 0.7 : 0.35, max: big ? 0.7 : 0.35 });
    const n = big ? 60 : 16;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(40, big ? 420 : 220);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, big ? 1.6 : 0.8), col: pick(['#FFE7A8', '#F6B24A', '#FF8A3D', '#FFFFFF']) });
    }
    if (big) for (let i = 0; i < 14; i++) smoke.push({ x: x + rand(-20, 20), y: y + rand(-20, 20), r: rand(8, 22), vx: rand(-20, 20), vy: rand(-30, 5), life: rand(1.5, 3), max: 3 });
  }

  const tracer = (x, y, ang, col, team = 'ground', v = rand(600, 900)) => bolts.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: rand(0.5, 1), col, team });
  const every = (key, lo, hi, dt) => {
    timers[key] = (timers[key] ?? rand(lo, hi)) - dt;
    if (timers[key] > 0) return false;
    timers[key] = rand(lo, hi);
    return true;
  };

  // ------------------------------------------------------------------ ships (space and jets)

  function spawnShip(initial = false) {
    const kind = pick(['dart', 'dart', 'lancer']);
    const fromLeft = Math.random() < 0.5;
    const side = fromLeft ? 1 : -1;
    const jet = S.jets;
    const size = (jet ? rand(16, 30) : rand(26, 58)) * Math.min(1.3, Math.max(0.6, W / 1300));
    const speed = (jet ? rand(260, 420) : rand(90, 170)) * (W / 1200 + 0.4);
    ships.push({
      kind, size, side,
      x: initial ? rand(0, W) : fromLeft ? -size * 2 : W + size * 2,
      y: jet ? rand(H * 0.06, H * 0.36) : rand(H * 0.08, H * 0.62), vy: rand(-18, 18), speed,
      team: fromLeft ? 'blue' : 'gold', wob: rand(0, 6), fire: rand(0.3, 1.6), hp: 2, smoking: false
    });
  }

  function fireShip(s) {
    const enemies = ships.filter((o) => o.team !== s.team);
    const target = enemies.length ? pick(enemies) : null;
    const ang = target ? Math.atan2(target.y - s.y, target.x - s.x) + rand(-0.12, 0.12) : (s.side > 0 ? 0 : Math.PI) + rand(-0.3, 0.3);
    const col = s.team === 'blue' ? pick(BLUE) : pick(GOLD);
    for (const off of [-3, 3]) tracer(s.x + Math.cos(ang) * s.size * 0.7 - Math.sin(ang) * off, s.y + Math.sin(ang) * s.size * 0.7 + Math.cos(ang) * off, ang, col, s.team, rand(700, 1000));
  }

  // ------------------------------------------------------------------ simulation

  function step(dt) {
    t += dt;
    const cap = S.space ? Math.round((8 + W / 160) * S.ships) : S.jets ? 3 : 0;
    nextShip -= dt;
    if (cap && nextShip <= 0 && ships.length < cap) {
      spawnShip();
      nextShip = S.jets ? rand(1.5, 3.5) : rand(0.3, 1.1);
    }
    if (S.flak && Math.random() < dt * S.flak) boom(rand(0, W), rand(H * 0.05, H * 0.6), Math.random() < 0.25);

    for (const s of ships) {
      s.x += s.side * s.speed * dt;
      s.y += Math.sin(t * 0.9 + s.wob) * s.vy * dt;
      s.fire -= dt;
      if (s.fire <= 0 && s.x > -20 && s.x < W + 20) {
        fireShip(s);
        s.fire = S.jets ? rand(1.2, 2.6) : rand(0.4, 1.4);
      }
      if (s.smoking && Math.random() < 0.6) smoke.push({ x: s.x - s.side * s.size * 0.4, y: s.y, r: rand(3, 7), vx: rand(-8, 8), vy: rand(-10, 10), life: rand(1, 2.2), max: 2.2 });
    }
    for (const r of rocks) {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.a += r.va * dt;
      if (r.x < -60) r.x = W + 50;
      if (r.x > W + 60) r.x = -50;
      if (r.x > W * 0.34 && r.x < W * 0.66) r.vx = r.x < W / 2 ? -Math.abs(r.vx) - 2 : Math.abs(r.vx) + 2;
    }

    // Fires smoke and spit embers.
    for (const f of fires) {
      if (Math.random() < dt * 9 * f.k) smoke.push({ x: f.x + rand(-6, 6) * u, y: g - 22 * u * f.k, r: rand(6, 12) * u, vx: rand(4, 16) * u, vy: rand(-46, -26) * u, life: rand(2.5, 4.5), max: 4.5 });
      if (Math.random() < dt * 6 * S.embers) embers.push({ x: f.x + rand(-8, 8), y: g - 20 * u, vy: rand(-70, -30), vx: rand(-10, 20), life: rand(1.5, 3), r: rand(0.6, 1.6), p: rand(0, 6) });
    }

    // Troopers fire at whatever the scene gives them.
    for (const tr of troops) {
      tr.flash = Math.max(0, tr.flash - dt);
      tr.cd -= dt;
      if (tr.cd > 0) continue;
      tr.cd = ACT === 'sq1' ? rand(0.25, 1.2) : rand(0.6, 2.2);
      tr.flash = 0.08;
      const mx = tr.x + tr.dir * 15 * u, my = g - (tr.kneel ? 14 : 22) * u;
      let ang;
      if (ACT === 'se1' && critters.length) {
        const c = critters.reduce((a, b) => (Math.abs(b.x - tr.x) < Math.abs(a.x - tr.x) ? b : a));
        ang = Math.atan2(g - 8 * u - my, c.x - mx) + rand(-0.04, 0.04);
      } else if (ACT === 'sq1' || ACT === 'bf1') {
        ang = (tr.dir > 0 ? 0 : Math.PI) + tr.dir * -rand(0.01, 0.12);
      } else {
        ang = -Math.PI / 2 + tr.dir * rand(0.25, 0.9);
      }
      tracer(mx, my, ang, tr.dir > 0 ? pick(GOLD) : pick(BLUE));
    }

    for (const tk of tanks) {
      tk.flash = Math.max(0, tk.flash - dt);
      tk.cd -= dt;
      if (tk.cd > 0) continue;
      tk.cd = rand(2.5, 5);
      tk.flash = 0.18;
      const mx = tk.x + tk.dir * 74 * u, my = g - 27 * u;
      boom(mx, my, false);
      if (ACT === 'bf1') {
        tracer(mx, my, (tk.dir > 0 ? 0 : Math.PI) - tk.dir * 0.04, '#FFE2A8', 'shell', 1100);
        timers['hit' + tk.x] = 0.5;
      }
      for (let i = 0; i < 5; i++) smoke.push({ x: mx, y: my, r: rand(5, 10) * u, vx: tk.dir * rand(5, 30), vy: rand(-12, 4), life: rand(1, 2), max: 2 });
    }

    for (const h of helis) {
      h.p += dt;
      h.x += h.vx * dt;
      if (Math.abs(h.x - h.home) > h.range) h.vx *= -1;
      h.cd -= dt;
      if (ACT === 'bf1' && h.cd <= 0) {
        h.cd = rand(2.5, 5);
        tracer(h.x + h.dir * 20 * u, h.y + 8 * u, (h.dir > 0 ? 0 : Math.PI) + h.dir * 0.35, '#FFD08A', 'shell', 700);
      }
    }

    // Shells landing on the far side (Battlefield) and a constant rumble of artillery on the horizon.
    if (ACT === 'bf1') {
      if (Math.random() < dt * 1.6) {
        const x = rand(0, W);
        flashes.push({ x, y: hz + rand(-6, 6), r: rand(30, 60), life: 0.4, max: 0.4 });
        smoke.push({ x, y: hz, r: rand(10, 20), vx: rand(-4, 4), vy: rand(-14, -6), life: 3, max: 3 });
      }
      for (const b of bolts) if (b.team === 'shell' && b.life > 0 && (b.y > g - 6 * u || b.life < 0.15)) { boom(b.x, Math.min(b.y, g - 8 * u), true); b.life = 0; }
    }

    // Helldivers: the swarm, drop pods and orbital strikes.
    if (ACT === 'se1') {
      for (const c of critters) {
        c.x += c.vx * dt;
        c.p += dt * 8;
        if (c.x < W * 0.46) { c.hp = 0; boom(c.x, g - 10 * u, false); }
      }
      for (const b of bolts) {
        if (b.team !== 'ground' || b.life <= 0) continue;
        for (const c of critters) {
          if (c.hp > 0 && Math.abs(c.x - b.x) < 16 * u * c.s && Math.abs(g - 8 * u - b.y) < 14 * u) {
            b.life = 0;
            c.hp -= 1;
            sparks.push(...Array.from({ length: 5 }, () => ({ x: b.x, y: b.y, vx: rand(-80, 80), vy: rand(-90, 10), life: rand(0.3, 0.6), col: '#C8F070' })));
            break;
          }
        }
      }
      critters = critters.map((c) => (c.hp > 0 ? c : critter(W + rand(20, 160))));
      if (every('pod', 1.6, 3.2, dt)) pods.push({ x: rand(W * 0.06, W * 0.5), y: -20, vx: rand(-60, 60), vy: rand(700, 900) });
      if (every('beam', 3.5, 6.5, dt)) beams.push({ x: rand(W * 0.6, W * 0.95), life: 0.55, max: 0.55, hit: false });
      for (const p of pods) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        for (let i = 0; i < 3; i++) sparks.push({ x: p.x + rand(-2, 2), y: p.y - rand(0, 10), vx: rand(-20, 20), vy: rand(-80, -20), life: rand(0.2, 0.5), col: pick(['#FFE7A8', '#FFB45A']) });
        if (p.y >= g - 4 * u) { boom(p.x, g - 6 * u, true); p.done = true; }
      }
      pods = pods.filter((p) => !p.done);
      for (const b of beams) {
        b.life -= dt;
        if (!b.hit && b.life < b.max * 0.45) {
          b.hit = true;
          boom(b.x, g - 10 * u, true);
          for (const c of critters) if (Math.abs(c.x - b.x) < 80 * u) c.hp = 0;
        }
      }
      beams = beams.filter((b) => b.life > 0);
    }

    // Squad: illumination flares drift down; mortars land between the lines.
    if (ACT === 'sq1') {
      if (every('flare', 2.2, 4, dt) && flares.length < 3) flares.push({ x: rand(W * 0.2, W * 0.8), y: rand(H * 0.12, H * 0.28), vy: rand(14, 22), life: 8, max: 8, p: rand(0, 6) });
      for (const f of flares) {
        f.y += f.vy * dt;
        f.x += Math.sin(t * 0.8 + f.p) * 6 * dt;
        f.life -= dt;
        if (Math.random() < dt * 8) smoke.push({ x: f.x, y: f.y - 4, r: rand(3, 5), vx: rand(-3, 3), vy: rand(-10, -4), life: 2, max: 2 });
      }
      flares = flares.filter((f) => f.life > 0);
      if (every('mortar', 1.5, 3.5, dt)) boom(rand(W * 0.38, W * 0.62), g - 4 * u, Math.random() < 0.5);
    }

    for (const b of bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.team === 'ground' || b.team === 'shell') continue;
      for (const s of ships) {
        if (s.team === b.team || b.life <= 0) continue;
        if (Math.abs(s.x - b.x) < s.size * 0.5 && Math.abs(s.y - b.y) < s.size * 0.28) {
          b.life = 0;
          s.hp -= 1;
          boom(b.x, b.y, false);
          s.smoking = true;
          if (s.hp <= 0) { boom(s.x, s.y, true); s.dead = true; }
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
    if (S.embers && embers.length < (W / 6) * S.embers) embers.push({ x: rand(0, W), y: H + 5, vy: rand(-60, -18), vx: rand(-12, 12), life: rand(3, 8), r: rand(0.6, 1.8), p: rand(0, 6) });
    for (const e of embers) {
      e.x += (e.vx + Math.sin(t * 1.5 + e.p) * 8) * dt;
      e.y += e.vy * dt;
      e.life -= dt;
    }
    ships = ships.filter((s) => !s.dead && s.x > -s.size * 3 && s.x < W + s.size * 3);
    bolts = bolts.filter((b) => b.life > 0).slice(-400);
    sparks = sparks.filter((p) => p.life > 0).slice(-900);
    smoke = smoke.filter((p) => p.life > 0).slice(-300);
    flashes = flashes.filter((f) => f.life > 0);
    embers = embers.filter((e) => e.life > 0 && e.y > -10);
  }

  // ------------------------------------------------------------------ drawing: actors

  function drawShip(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(s.side, 1);
    ctx.rotate(Math.sin(t * 0.9 + s.wob) * s.vy * 0.004);
    ctx.scale(s.size, s.size);
    ctx.globalCompositeOperation = 'lighter';
    for (const [ex, ey] of ENGINES[s.kind]) {
      const e = ctx.createRadialGradient(ex, ey, 0, ex, ey, 0.32);
      const hue = s.team === 'blue' ? '120, 170, 255' : '255, 200, 110';
      e.addColorStop(0, `rgba(${hue}, .95)`);
      e.addColorStop(1, `rgba(${hue}, 0)`);
      ctx.fillStyle = e;
      ctx.beginPath();
      ctx.ellipse(ex - 0.12, ey, 0.34, 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const body = ctx.createLinearGradient(0, -0.4, 0, 0.4);
    body.addColorStop(0, s.team === 'blue' ? '#3A4A6B' : '#5A4A2A');
    body.addColorStop(0.55, '#141A26');
    body.addColorStop(1, '#0A0D14');
    ctx.fillStyle = body;
    ctx.strokeStyle = s.team === 'blue' ? 'rgba(140, 180, 255, .55)' : 'rgba(240, 200, 120, .55)';
    ctx.lineWidth = 0.022;
    ctx.beginPath();
    SHAPES[s.kind].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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
    if (Math.sin(t * 6 + s.wob) > 0.4) {
      ctx.fillStyle = s.team === 'blue' ? '#9CC2FF' : '#FFD98A';
      ctx.beginPath();
      ctx.arc(0.15, 0, 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTrooper(tr) {
    const h = tr.kneel ? 17 : 25;
    ctx.save();
    ctx.translate(tr.x, g);
    ctx.scale(tr.dir * u, u);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(0, -h - 3, 3, 0, Math.PI * 2);
    ctx.moveTo(-3, -h); ctx.lineTo(3, -h); ctx.lineTo(4, -h + 11); ctx.lineTo(-4, -h + 11); ctx.closePath();
    if (tr.kneel) {
      ctx.moveTo(-4, -h + 11); ctx.lineTo(-7, 0); ctx.lineTo(-3, 0); ctx.lineTo(-1, -h + 12);
      ctx.moveTo(2, -h + 11); ctx.lineTo(8, -4); ctx.lineTo(8, 0); ctx.lineTo(4, 0); ctx.lineTo(4, -3); ctx.lineTo(0, -h + 12);
    } else {
      ctx.moveTo(-4, -h + 11); ctx.lineTo(-5, 0); ctx.lineTo(-2, 0); ctx.lineTo(0, -h + 13);
      ctx.moveTo(1, -h + 11); ctx.lineTo(4, 0); ctx.lineTo(7, 0); ctx.lineTo(4, -h + 11);
    }
    ctx.fill();
    ctx.fillRect(1, -h + 3, 14, 2.2);
    if (tr.flash > 0) {
      ctx.fillStyle = 'rgba(255, 220, 140, .95)';
      ctx.beginPath();
      ctx.arc(16, -h + 4, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTank(tk) {
    ctx.save();
    ctx.translate(tk.x, g);
    ctx.scale(tk.dir * u, u);
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(-46, 0); ctx.lineTo(-52, -10); ctx.lineTo(-40, -20); ctx.lineTo(44, -20); ctx.lineTo(52, -10); ctx.lineTo(46, 0);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-24, -20); ctx.lineTo(-16, -32); ctx.lineTo(16, -32); ctx.lineTo(22, -20);
    ctx.fill();
    ctx.fillRect(14, -29, 56, 4);
    ctx.strokeStyle = 'rgba(150, 175, 220, .35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-40, -20); ctx.lineTo(44, -20); ctx.moveTo(-16, -32); ctx.lineTo(16, -32);
    for (let x = -38; x <= 38; x += 12) { ctx.moveTo(x + 4, -3); ctx.arc(x, -4, 4, 0, Math.PI * 2); }
    ctx.stroke();
    if (tk.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const mf = ctx.createRadialGradient(74, -27, 0, 74, -27, 26);
      mf.addColorStop(0, 'rgba(255, 240, 200, 1)');
      mf.addColorStop(1, 'rgba(255, 150, 60, 0)');
      ctx.fillStyle = mf;
      ctx.beginPath();
      ctx.arc(74, -27, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  function drawHeli(h) {
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
    ctx.fillStyle = 'rgba(160, 180, 220, .28)';
    ctx.beginPath();
    ctx.ellipse(0, -12, 34 + Math.sin(h.p * 40) * 4, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = Math.sin(h.p * 5) > 0.6 ? '#FF6A5A' : '#2A1515';
    ctx.fillRect(-55, -15, 2.5, 2.5);
    ctx.restore();
  }

  // A generic many-legged swarm creature, scuttling left.
  function drawCritter(c) {
    ctx.save();
    ctx.translate(c.x, g);
    ctx.scale(-u * c.s, u * c.s);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(-4, -12, 14, 7, -0.1, 0, Math.PI * 2);
    ctx.ellipse(12, -14, 6, 5, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const x = -12 + i * 9, k = Math.sin(c.p + i * 2) * 3;
      ctx.moveTo(x, -10); ctx.lineTo(x - 4 + k, -16 + 12); ctx.lineTo(x - 6 + k, 0);
    }
    ctx.moveTo(16, -16); ctx.lineTo(24, -22); ctx.lineTo(26, -14);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 170, 80, .7)';
    ctx.fillRect(15, -16, 2, 2);
    ctx.restore();
  }

  function drawRock(r) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.a);
    const shade = ctx.createLinearGradient(-r.r, -r.r, r.r, r.r);
    shade.addColorStop(0, '#3A4458');
    shade.addColorStop(1, '#0A0D16');
    ctx.fillStyle = shade;
    ctx.beginPath();
    r.pts.forEach(([x, y, k], i) => (i ? ctx.lineTo(x * r.r * k, y * r.r * k) : ctx.moveTo(x * r.r * k, y * r.r * k)));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 175, 230, .25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawFire(f) {
    const k = f.k * u;
    for (let i = 0; i < 4; i++) {
      const fl = 1 + 0.18 * Math.sin(t * (11 + i * 3) + f.p + i);
      const fg = ctx.createRadialGradient(f.x, g - 8 * k, 0, f.x, g - 8 * k, 26 * k * fl);
      fg.addColorStop(0, 'rgba(255, 236, 170, .9)');
      fg.addColorStop(0.35, 'rgba(255, 150, 50, .6)');
      fg.addColorStop(1, 'rgba(200, 60, 20, 0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.ellipse(f.x + (i - 1.5) * 5 * k, g - 14 * k * fl, 9 * k, 22 * k * fl, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ drawing: the scene

  function drawStars(alpha) {
    for (const s of stars) {
      ctx.globalAlpha = alpha * (0.45 + 0.55 * Math.abs(Math.sin(t * s.s * 0.5 + s.p)));
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlanet() {
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
  }

  function drawSky() {
    const sky = ctx.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, S.sky[0]);
    sky.addColorStop(0.6, S.sky[1]);
    sky.addColorStop(1, S.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    drawStars(S.stars);
    // Haze along the horizon, then two layers of distant hills.
    const haze = ctx.createLinearGradient(0, hz - H * 0.2, 0, hz + H * 0.05);
    haze.addColorStop(0, `rgba(${S.haze}, 0)`);
    haze.addColorStop(1, `rgba(${S.haze}, .28)`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, hz - H * 0.2, W, H * 0.25);
    hills.forEach((pts, i) => {
      ctx.fillStyle = i ? '#0A0F1C' : '#141A2A';
      ctx.beginPath();
      ctx.moveTo(-40, H);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(W + 40, H);
      ctx.fill();
    });
  }

  function drawSearchlights() {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const bx = W / 2 + (i - 2) * W * 0.07;
      const a = -Math.PI / 2 + Math.sin(t * 0.35 + i * 1.7) * 0.42;
      const len = H * 0.9;
      const sl = ctx.createLinearGradient(bx, H * 0.86, bx + Math.cos(a) * len, H * 0.86 + Math.sin(a) * len);
      sl.addColorStop(0, 'rgba(200, 220, 255, .16)');
      sl.addColorStop(1, 'rgba(200, 220, 255, 0)');
      ctx.fillStyle = sl;
      ctx.beginPath();
      ctx.moveTo(bx, H * 0.86);
      ctx.lineTo(bx + Math.cos(a - 0.04) * len, H * 0.86 + Math.sin(a - 0.04) * len);
      ctx.lineTo(bx + Math.cos(a + 0.04) * len, H * 0.86 + Math.sin(a + 0.04) * len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawGlows() {
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of glows) {
      const a = gl.a + (gl.flicker ? 0.06 * Math.sin(t * 9 + gl.x) : 0);
      const r = gl.r * u;
      const gr = ctx.createRadialGradient(gl.x, gl.y, 0, gl.x, gl.y, r);
      gr.addColorStop(0, `rgba(${gl.rgb}, ${a})`);
      gr.addColorStop(0.5, `rgba(${gl.rgb}, ${a * 0.35})`);
      gr.addColorStop(1, `rgba(${gl.rgb}, 0)`);
      ctx.fillStyle = gr;
      ctx.fillRect(gl.x - r, gl.y - r, r * 2, r * 1.2);
    }
    // Squad's flares light up the whole field while they burn.
    for (const f of flares) {
      const k = Math.min(1, f.life / 1.5) * (0.9 + 0.1 * Math.sin(t * 20 + f.p));
      const r = 420 * u;
      const gr = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      gr.addColorStop(0, `rgba(255, 240, 210, ${0.5 * k})`);
      gr.addColorStop(0.2, `rgba(220, 200, 170, ${0.16 * k})`);
      gr.addColorStop(1, 'rgba(160, 150, 140, 0)');
      ctx.fillStyle = gr;
      ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      ctx.fillStyle = `rgba(255, 252, 240, ${k})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 3 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawSmoke() {
    for (const p of smoke) {
      const a = Math.max(0, p.life / p.max) * 0.28;
      const sg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      sg.addColorStop(0, `rgba(120, 128, 150, ${a})`);
      sg.addColorStop(1, 'rgba(120, 128, 150, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawLight() {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of bolts) {
      ctx.strokeStyle = b.col;
      ctx.lineWidth = b.team === 'shell' ? 3 : 2.2;
      ctx.shadowColor = b.col;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.035, b.y - b.vy * 0.035);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // Orbital strikes: a bright column from the sky, widening as it lands.
    for (const b of beams) {
      const k = b.life / b.max;
      const w = (b.hit ? 26 : 6) * u;
      const bg = ctx.createLinearGradient(b.x - w, 0, b.x + w, 0);
      bg.addColorStop(0, 'rgba(255, 220, 150, 0)');
      bg.addColorStop(0.5, `rgba(255, 245, 220, ${0.9 * k})`);
      bg.addColorStop(1, 'rgba(255, 220, 150, 0)');
      ctx.fillStyle = bg;
      ctx.fillRect(b.x - w, 0, w * 2, g);
    }
    for (const p of pods) {
      const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 18 * u);
      pg.addColorStop(0, 'rgba(255, 240, 200, .95)');
      pg.addColorStop(1, 'rgba(255, 140, 50, 0)');
      ctx.fillStyle = pg;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 190, 110, .55)';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.12, p.y - p.vy * 0.12);
      ctx.stroke();
    }
    for (const p of sparks) {
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    for (const f of flashes) {
      const k = f.life / f.max;
      const fg = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (1.4 - k * 0.4));
      fg.addColorStop(0, `rgba(255, 245, 220, ${0.9 * k})`);
      fg.addColorStop(0.35, `rgba(255, 170, 70, ${0.55 * k})`);
      fg.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = fg;
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
  }

  function drawRidge() {
    ctx.fillStyle = '#02040A';
    ctx.beginPath();
    ctx.moveTo(-20, H + 2);
    for (const [x, y] of ridge) ctx.lineTo(x, y);
    ctx.lineTo(W + 20, H + 2);
    ctx.closePath();
    ctx.fill();
    if (ACT === 'sq1') {
      // Sandbag lines on either side of no man's land.
      ctx.fillStyle = INK;
      for (const [a, b] of [[0, 0.4], [0.6, 1]]) for (let x = W * a; x < W * b; x += 14 * u) {
        ctx.beginPath();
        ctx.ellipse(x, g - 3 * u, 8 * u, 4 * u, 0, Math.PI, 0);
        ctx.fill();
      }
    }
  }

  function drawCitadel() {
    const sw = Math.max(16, W * 0.018), top = H * 0.6;
    ctx.fillStyle = '#02040A';
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
  }

  function drawCornerGround() {
    ctx.fillStyle = '#03050B';
    for (const cx of [W * 0.2, W * 0.8]) {
      ctx.beginPath();
      ctx.moveTo(cx - 230 * u, H);
      ctx.lineTo(cx - 200 * u, g + 4 * u);
      ctx.lineTo(cx - 60 * u, g - 2 * u);
      ctx.lineTo(cx + 70 * u, g + 1 * u);
      ctx.lineTo(cx + 210 * u, g + 5 * u);
      ctx.lineTo(cx + 240 * u, H);
      ctx.fill();
    }
  }

  function drawScene() {
    ctx.clearRect(0, 0, W, H);
    if (S.space) {
      drawStars(1);
      if (nebula) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(nebula, 0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (S.planet) drawPlanet();
      if (S.searchlights) drawSearchlights();
    } else {
      drawSky();
    }
    drawSmoke();
    rocks.forEach(drawRock);
    ships.sort((a, b) => a.size - b.size).forEach(drawShip);
    helis.forEach(drawHeli);
    drawGlows();
    drawLight();
    if (ACT === 'hq' || !S.space) drawRidge();
    if (S.citadel) drawCitadel();
    if (S.corners) drawCornerGround();
    ctx.globalCompositeOperation = 'lighter';
    fires.forEach(drawFire);
    ctx.globalCompositeOperation = 'source-over';
    troops.forEach(drawTrooper);
    tanks.forEach(drawTank);
    critters.forEach(drawCritter);
  }

  // ------------------------------------------------------------------ loop

  function frame(now, once = false) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!once) step(dt);
    drawScene();
    if (running) requestAnimationFrame(frame);
  }

  function prime() {
    if (S.space) for (let i = 0; i < 9 * (S.ships || 1); i++) spawnShip(true);
    else if (S.jets) for (let i = 0; i < 2; i++) spawnShip(true);
    for (let i = 0; i < 160; i++) step(1 / 30);
  }

  let visible = true;
  function play() {
    if (running || still.matches || document.hidden || !visible) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  const pause = () => { running = false; };

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : pause(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  still.addEventListener('change', () => (still.matches ? (pause(), frame(performance.now(), true)) : play()));
  window.addEventListener('resize', resize);
  resize();
  prime();
  frame(performance.now(), true);
  play();
}
