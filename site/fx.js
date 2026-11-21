// Belpire Carnival — interaction effects: scroll reveals and cards that tilt toward the cursor.
// Pure decoration. Skipped entirely for people who prefer reduced motion.
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  const REVEAL = '.section-head, .section-tents h2, .band h2, .tickets > *, .nights > *, .odd-grid > *, .ringleaders > *, .closing > *, .systems > *, .incidents > *, .tool-cat, .attraction, .box, .step, .patch';
  const TILT = '.card, .news, .attraction, .night, .ringleader, .placeholder, .ticket, .system, .tool, .box, .patch';
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---- Scroll reveals ----
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            io.unobserve(e.target);
          }
        }
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    : null;

  function prepareReveal(el, index = 0) {
    if (!io || el.dataset.fxReveal) return;
    el.dataset.fxReveal = '1';
    // Anything already on screen at load stays visible (no flash of hidden content).
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92) return;
    el.classList.add('reveal');
    el.style.setProperty('--delay', `${Math.min(index % 6, 5) * 70}ms`);
    io.observe(el);
  }

  // ---- Tilt + glint ----
  function prepareTilt(el) {
    if (!finePointer || el.dataset.fxTilt) return;
    el.dataset.fxTilt = '1';
    el.classList.add('tilt');
    let frame = 0;
    el.addEventListener('pointermove', (ev) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width;
        const y = (ev.clientY - r.top) / r.height;
        el.style.setProperty('--ry', `${(x - 0.5) * 7}deg`);
        el.style.setProperty('--rx', `${(0.5 - y) * 6}deg`);
        el.style.setProperty('--gx', `${x * 100}%`);
        el.style.setProperty('--gy', `${y * 100}%`);
      });
    });
    el.addEventListener('pointerleave', () => {
      cancelAnimationFrame(frame);
      el.style.setProperty('--ry', '0deg');
      el.style.setProperty('--rx', '0deg');
    });
  }

  function scan(root = document) {
    root.querySelectorAll(REVEAL).forEach((el, i) => prepareReveal(el, i));
    root.querySelectorAll(TILT).forEach(prepareTilt);
  }

  document.addEventListener('DOMContentLoaded', () => {
    scan();
    // Feeds, news and tools are rendered later by the page scripts; pick those up too.
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches(TILT)) prepareTilt(node);
          if (node.matches(REVEAL)) prepareReveal(node);
          scan(node);
        }
      }
    });
    mo.observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
  });
})();
