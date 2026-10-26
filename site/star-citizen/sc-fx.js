// The Star Citizen Sideshow — animated starfield with striped carnival comets.
// Decoration only. Pauses when the tab is hidden; draws a still sky for reduced motion.
(() => {
  const canvas = document.getElementById('starfield');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#F3E6C8', '#FFE9F3', '#D7F8FC', '#D9B26A'];
  let w = 0, h = 0, dpr = 1, stars = [], comets = [], raf = 0, last = 0, nextComet = 2500;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(320, Math.round((w * h) / 5200));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      z: 0.2 + Math.random() * 0.8, // depth: nearer stars are bigger and move more
      r: 0.4 + Math.random() * 1.3,
      tw: Math.random() * Math.PI * 2,
      sp: 0.6 + Math.random() * 1.6,
      c: COLORS[Math.random() < 0.82 ? 0 : 1 + Math.floor(Math.random() * 3)]
    }));
  }

  function spawnComet() {
    const fromLeft = Math.random() < 0.5;
    comets.push({
      x: fromLeft ? -80 : w + 80,
      y: Math.random() * h * 0.6,
      vx: (fromLeft ? 1 : -1) * (0.35 + Math.random() * 0.25),
      vy: 0.08 + Math.random() * 0.12,
      life: 0
    });
  }

  function drawComet(c) {
    // Head plus a tail of alternating crimson and bone segments — a carnival comet.
    const segs = 12, len = 9;
    for (let i = segs; i >= 1; i--) {
      const tx = c.x - c.vx * i * len * 2.2;
      const ty = c.y - c.vy * i * len * 2.2;
      ctx.globalAlpha = (1 - i / segs) * 0.7;
      ctx.fillStyle = i % 2 ? '#C42640' : '#EDE6D8';
      ctx.beginPath();
      ctx.arc(tx, ty, Math.max(0.6, 3.2 - i * 0.22), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowColor = '#FF4F9A';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#FFF4DE';
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function frame(t) {
    const dt = Math.min(64, t - (last || t));
    last = t;
    const scroll = window.scrollY || 0;
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.tw += (dt / 1000) * s.sp;
      const a = reduce ? 0.8 : 0.45 + 0.55 * Math.abs(Math.sin(s.tw));
      const y = (((s.y - scroll * 0.06 * s.z) % h) + h) % h; // gentle parallax as you scroll
      ctx.globalAlpha = a * (0.5 + s.z * 0.5);
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x, y, s.r * s.z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (reduce) return; // one still frame only

    nextComet -= dt;
    if (nextComet <= 0 && comets.length < 2) {
      spawnComet();
      nextComet = 7000 + Math.random() * 9000;
    }
    comets = comets.filter((c) => c.x > -200 && c.x < w + 200 && c.y < h + 200);
    for (const c of comets) {
      c.x += c.vx * dt * 0.6;
      c.y += c.vy * dt * 0.6;
      drawComet(c);
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  resize();
  start();
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); start(); }, 150);
  });
  if (reduce) window.addEventListener('scroll', () => requestAnimationFrame(frame), { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (!reduce) start();
  });
})();
