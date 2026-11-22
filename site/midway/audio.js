// MidwayAudio: small synthesized sounds for the booths (Web Audio, no files): wood knocks, glass clinks,
// a brass bell, spring launches, coin cascades and a quiet marquee hum. Browsers only allow sound after a
// tap, so nothing plays until unlock() runs inside the member's first pointer or key press. Muting is
// remembered per browser (localStorage, best effort).

const KEY = 'midway.muted';

export function createAudio() {
  let ctx = null;
  let master = null;
  let hum = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch { /* storage blocked: default to sound on */ }

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    master.connect(ctx.destination);
    startHum();
  }

  const now = () => ctx.currentTime;
  function env(gain, t0, attack, decay, peak) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }
  function noise(seconds) {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
  function tone(type, freq, t0, attack, decay, peak, dest = master) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    env(g, t0, attack, decay, peak);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
    return o;
  }

  function startHum() {
    // Two low partials with a slow tremolo: the marquee bulbs' transformer.
    const g = ctx.createGain();
    g.gain.value = 0.018;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.35;
    lfoGain.gain.value = 0.008;
    lfo.connect(lfoGain).connect(g.gain);
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.frequency.value = 60;
    b.frequency.value = 120;
    b.type = 'triangle';
    a.connect(g);
    b.connect(g);
    g.connect(master);
    a.start();
    b.start();
    lfo.start();
    hum = { stop: () => { for (const o of [a, b, lfo]) o.stop(); } };
  }

  const ready = () => ctx && !muted;

  const sounds = {
    knock(strength = 1) {
      if (!ready()) return;
      const t = now();
      const n = noise(0.12);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 420;
      f.Q.value = 4;
      const g = ctx.createGain();
      env(g, t, 0.002, 0.09, 0.9 * strength);
      n.connect(f).connect(g).connect(master);
      n.start(t);
      tone('sine', 140, t, 0.002, 0.12, 0.5 * strength);
    },
    slide() {
      if (!ready()) return;
      const t = now();
      const n = noise(0.3);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(900, t);
      f.frequency.linearRampToValueAtTime(500, t + 0.25);
      const g = ctx.createGain();
      env(g, t, 0.03, 0.22, 0.22);
      n.connect(f).connect(g).connect(master);
      n.start(t);
    },
    clink(pitch = 1) {
      if (!ready()) return;
      const t = now();
      for (const [f, p] of [[3100, 0.22], [4720, 0.14], [6890, 0.08]]) tone('sine', f * pitch, t, 0.001, 0.35, p);
    },
    bell() {
      if (!ready()) return;
      const t = now();
      for (const [ratio, p, d] of [[1, 0.5, 2.4], [2.76, 0.22, 1.6], [5.4, 0.12, 0.9], [8.93, 0.05, 0.5]]) tone('sine', 660 * ratio, t, 0.002, d, p);
    },
    spring() {
      if (!ready()) return;
      const t = now();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(980, t + 0.35);
      env(g, t, 0.01, 0.38, 0.25);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.45);
    },
    coins(count = 6) {
      if (!ready()) return;
      for (let i = 0; i < count; i++) {
        const t = now() + i * 0.06 + Math.random() * 0.03;
        tone('sine', 2400 + Math.random() * 1600, t, 0.001, 0.18, 0.12);
        tone('sine', 5200 + Math.random() * 1400, t, 0.001, 0.1, 0.05);
      }
    },
    win(big = false) {
      if (!ready()) return;
      const t = now();
      const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784];
      notes.forEach((f, i) => tone('triangle', f, t + i * 0.09, 0.01, 0.35, 0.16));
      sounds.coins(big ? 12 : 5);
    },
    lose() {
      if (!ready()) return;
      const t = now();
      tone('sine', 196, t, 0.01, 0.35, 0.2);
      tone('sine', 147, t + 0.16, 0.01, 0.45, 0.18);
    }
  };

  return {
    unlock,
    ...sounds,
    get muted() { return muted; },
    setMuted(m) {
      muted = Boolean(m);
      try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* best effort */ }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.6, now(), 0.05);
    },
    close() {
      try { hum?.stop(); } catch { /* already stopped */ }
      ctx?.close().catch(() => {});
      ctx = null;
    }
  };
}
