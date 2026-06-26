// Lightweight synthesized sound effects via the Web Audio API — no asset files,
// works offline. Browsers require a user gesture before audio can start, so we
// resume the context on the first interaction (see sound.unlock()).
let ctx = null;
let muted = localStorage.getItem('pwf.muted') === '1';

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, opts = {}) {
  const a = ac();
  if (!a) return;
  const { type = 'sine', gain = 0.2 } = opts;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function seq(notes) {
  if (muted) return;
  for (const n of notes) tone(n[0], n[1], n[2], n[3]);
}

// ---- Background music: a soft looping chord progression (vi–IV–I–V) ----
let musicEnabled = localStorage.getItem('pwf.music') !== '0';
let musicTimer = null;
let musicStep = 0;
const PROG = [
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
  [261.63, 329.63, 392.0], // C
  [196.0, 246.94, 293.66], // G
];

function chord(freqs) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime;
  for (const f of freqs) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
    osc.connect(g);
    g.connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + 2);
  }
  const bass = a.createOscillator();
  const bg = a.createGain();
  bass.type = 'triangle';
  bass.frequency.value = freqs[0] / 2;
  bg.gain.setValueAtTime(0.0001, t0);
  bg.gain.exponentialRampToValueAtTime(0.05, t0 + 0.3);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
  bass.connect(bg);
  bg.connect(a.destination);
  bass.start(t0);
  bass.stop(t0 + 2);
}

export const sound = {
  get muted() { return muted; },
  get musicOn() { return musicEnabled; },
  toggle() {
    muted = !muted;
    localStorage.setItem('pwf.muted', muted ? '1' : '0');
    if (muted) this.stopMusic();
    else this.select();
    return muted;
  },
  toggleMusic() {
    musicEnabled = !musicEnabled;
    localStorage.setItem('pwf.music', musicEnabled ? '1' : '0');
    if (!musicEnabled) this.stopMusic();
    return musicEnabled;
  },
  startMusic() {
    if (!musicEnabled || muted || musicTimer) return;
    if (!ac()) return;
    chord(PROG[0]);
    musicStep = 1;
    musicTimer = setInterval(() => {
      if (muted) return;
      chord(PROG[musicStep % PROG.length]);
      musicStep += 1;
    }, 2000);
  },
  stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  },
  unlock() { ac(); },

  select() { seq([[660, 0, 0.06, { type: 'square', gain: 0.1 }]]); },
  lock() { seq([[520, 0, 0.08], [780, 0.07, 0.1]]); },
  tick() { seq([[880, 0, 0.04, { type: 'square', gain: 0.07 }]]); },
  correct() { seq([[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.2]]); },
  wrong() { seq([[200, 0, 0.3, { type: 'sawtooth', gain: 0.14 }]]); },
  guess() { seq([[988, 0, 0.1], [1319, 0.08, 0.18]]); },
  turn() { seq([[330, 0, 0.12, { type: 'triangle', gain: 0.18 }], [523, 0.1, 0.18, { type: 'triangle', gain: 0.18 }]]); },
  join() { seq([[440, 0, 0.07], [660, 0.06, 0.1]]); },
  win() { seq([[523, 0, 0.16], [659, 0.15, 0.16], [784, 0.3, 0.16], [1047, 0.45, 0.4]]); },
};
