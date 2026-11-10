// Sound effects generated with WebAudio – no recordings, everything is synthesized.
// The module can be imported in Node too (tests): the AudioContext is created on first play.

// Which game event sounds how. viewer = player at the screen (their actions sound a bit more prominent).
export function soundFor(ev, viewer = 0) {
  switch (ev.type) {
    case 'move': return 'step';
    case 'attack': {
      if (ev.attackerPromoted || ev.promoted || ev.defenderPromoted) return 'promote';
      return ev.killed || ev.died ? 'kill' : 'hit';
    }
    case 'capture': return ev.owner === viewer ? 'capture' : 'lose';
    case 'build': return 'build';
    case 'fortify': return 'fortify';
    case 'upgrade': return 'promote';
    case 'spawn': return 'recruit';
    case 'happening': {
      const good = ev.kind === 'harvest' || ev.suppressed;
      return (ev.player === viewer) === good ? 'boon' : 'bane';
    }
    default: return null;
  }
}

// Limiter: the same sound at most once per `gap` ms (otherwise dozens would play at once when an animation is skipped).
export function createLimiter(gap = 90) {
  const last = new Map();
  return (name, now) => {
    if (now - (last.get(name) ?? -Infinity) < gap) return false;
    last.set(name, now);
    return true;
  };
}

// Sound definitions: sequence of tones / noise. f = frequency (Hz), d = duration (s), t = start (s), w = waveform.
const SOUNDS = {
  step:    [{ noise: true, d: 0.05, v: 0.12, f: 900 }],
  hit:     [{ noise: true, d: 0.09, v: 0.35, f: 1800 }, { f: 140, d: 0.12, v: 0.3, w: 'square', slide: 70 }],
  kill:    [{ noise: true, d: 0.14, v: 0.4, f: 1200 }, { f: 110, d: 0.3, v: 0.35, w: 'sawtooth', slide: 45 }],
  promote: [{ f: 660, d: 0.08, v: 0.2 }, { f: 880, d: 0.08, v: 0.2, t: 0.08 }, { f: 1320, d: 0.16, v: 0.2, t: 0.16 }],
  capture: [{ f: 392, d: 0.12, v: 0.25, w: 'triangle' }, { f: 523, d: 0.12, v: 0.25, w: 'triangle', t: 0.12 },
            { f: 659, d: 0.25, v: 0.25, w: 'triangle', t: 0.24 }],
  lose:    [{ f: 330, d: 0.18, v: 0.25, w: 'triangle' }, { f: 247, d: 0.3, v: 0.25, w: 'triangle', t: 0.18 }],
  build:   [{ noise: true, d: 0.04, v: 0.3, f: 2500 }, { noise: true, d: 0.04, v: 0.3, f: 2500, t: 0.12 }],
  // a low wooden thud, twice – stakes driven into the ground
  fortify: [{ f: 140, d: 0.08, v: 0.3, w: 'triangle', slide: 90 }, { f: 140, d: 0.08, v: 0.3, w: 'triangle', slide: 90, t: 0.1 }],
  recruit: [{ f: 220, d: 0.18, v: 0.2, w: 'sawtooth', slide: 330 }],
  boon:    [{ f: 784, d: 0.1, v: 0.18, w: 'triangle' }, { f: 1047, d: 0.2, v: 0.18, w: 'triangle', t: 0.1 }],
  bane:    [{ f: 196, d: 0.25, v: 0.22, w: 'sawtooth', slide: 150 }, { noise: true, d: 0.2, v: 0.12, f: 400, t: 0.05 }],
  click:   [{ f: 520, d: 0.03, v: 0.12, w: 'square' }],
  victory: [523, 659, 784, 1047].map((f, i) => ({ f, d: 0.22, v: 0.25, w: 'triangle', t: i * 0.16 })),
  defeat:  [392, 349, 311, 262].map((f, i) => ({ f, d: 0.28, v: 0.25, w: 'triangle', t: i * 0.2 })),
};

export const SOUND_NAMES = Object.keys(SOUNDS);

export function createSound() {
  let ctx = null;
  let master = null;
  const limit = createLimiter();
  const api = { enabled: true };

  function ensure() {
    if (ctx) return ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }

  function tone(n, start) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = n.w || 'sine';
    osc.frequency.setValueAtTime(n.f, start);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, start + n.d);
    g.gain.setValueAtTime(n.v, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + n.d);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + n.d + 0.02);
  }

  function noise(n, start) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * n.d));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = n.f || 1000;
    const g = ctx.createGain();
    g.gain.value = n.v;
    src.connect(filter).connect(g).connect(master);
    src.start(start);
  }

  api.play = (name) => {
    if (!api.enabled || !SOUNDS[name]) return;
    try {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!limit(name, performance.now())) return;
      const now = ctx.currentTime + 0.01;
      for (const n of SOUNDS[name]) (n.noise ? noise : tone)(n, now + (n.t || 0));
    } catch { /* sound isn't essential to the game */ }
  };

  // Browsers only allow audio after a user gesture – the context is unlocked on the first click/key.
  api.unlock = () => {
    if (!api.enabled) return;
    try { if (ensure() && ctx.state === 'suspended') ctx.resume(); } catch { /* nothing */ }
  };

  return api;
}
