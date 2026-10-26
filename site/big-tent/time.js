// Game nights are planned in Eastern time. Turn a date + time typed in Eastern into an exact instant
// (ISO with offset), whichever side of daylight saving it falls on.
const ZONE = 'America/New_York';

function partsIn(zone, date) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// "2026-10-30", "20:00" → "2026-10-30T20:00:00-04:00" (null if invalid or a skipped DST hour)
export function easternToIso(day, time, zone = ZONE) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
  const wanted = `${day}T${time}`;
  for (const offset of ['-04:00', '-05:00']) {
    const iso = `${wanted}:00${offset}`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime()) && partsIn(zone, d) === wanted) return iso;
  }
  return null;
}

export function formatEastern(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
}

export function formatLocal(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
}
