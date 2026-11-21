// HQ historical record: reveals the era cards as they scroll in, and counts the days since the
// origin event (April 9, 2026, US Eastern) in the record's status line.
const record = document.getElementById('dossier');
if (record) {
  const day = document.getElementById('record-day');
  if (day) {
    const origin = Date.UTC(2026, 3, 9, 4); // midnight Eastern on 9 April 2026
    const n = Math.floor((Date.now() - origin) / 86400000) + 1;
    if (n > 0) day.textContent = `Active // Day ${n.toLocaleString()}`;
  }
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    record.classList.add('will-reveal');
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { record.classList.add('is-in'); io.disconnect(); }
    }, { threshold: 0.12 });
    io.observe(record);
  }
}
