// Wavelength-style game: one player (the Reader) sees a hidden target on a
// spectrum (e.g. Innocent ←→ Filthy) and gives a one-word-ish clue. Everyone
// else slides a dial to guess where the target is. Closer = more points.
import { shuffle, pickSome, clamp, maybeCensor } from '../util.js';

const CLUE_MS = 45000;
const GUESS_MS = 30000;
const REVEAL_MS = 8000;

const SPECTRA_CLEAN = [
  ['Cold', 'Hot'], ['Underrated', 'Overrated'], ['Useless', 'Essential'], ['Villain', 'Hero'],
  ['Boring', 'Exciting'], ['Cheap', 'Expensive'], ['Weird', 'Normal'], ['Quiet', 'Loud'],
  ['Ugly', 'Beautiful'], ['Old-fashioned', 'Modern'], ['Scary', 'Cute'], ['Healthy', 'Junk food'],
  ['Introvert', 'Extrovert'], ['Low effort', 'High effort'], ['Forgettable', 'Iconic'],
  ['Casual', 'Fancy'], ['Common', 'Rare'], ['Calm', 'Chaotic'], ['Overhyped', 'Worth it'],
  ['Simple', 'Complicated'], ['Bad movie', 'Great movie'], ['Slow', 'Fast'], ['Cringe', 'Cool'],
];

const SPECTRA_FILTHY = [
  ['Innocent', 'Filthy'], ['Sober', 'Wasted'], ['Turn-off', 'Turn-on'], ['Vanilla', 'Kinky'],
  ['Bad idea', 'Terrible idea'], ['Mild hangover', 'Near death'], ['Tipsy', 'Blackout'],
  ['Cute flirt', 'Creepy'], ['First-date OK', 'Never say it'], ['Wholesome', 'Cursed'],
  ['Tame', 'Unhinged'], ['Sexy', 'Trying too hard'], ['Classy drunk', 'Messy drunk'],
  ['Safe for work', 'Get fired'], ['Romantic', 'Just horny'], ['Tasteful', 'Trashy'],
  ['Totally legal', 'Felony'], ['Fine in public', 'Arrested'], ['Light snack', 'Pure regret'],
];

function nameOf(room, id) {
  const p = room.players.get(id);
  return p ? p.name : 'Someone';
}

function leaderboard(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || '', score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

function connected(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function pointsFor(dist) {
  if (dist <= 4) return 100;
  if (dist <= 9) return 70;
  if (dist <= 17) return 40;
  if (dist <= 28) return 15;
  return 0;
}

function startRound(room, ctx) {
  const g = room.game;
  while (g.turnIndex < g.order.length) {
    const r = room.players.get(g.order[g.turnIndex]);
    if (r && r.connected) break;
    g.turnIndex += 1;
  }
  if (g.turnIndex >= g.order.length) { ctx.end(); return; }
  g.sub = 'clue';
  g.readerId = g.order[g.turnIndex];
  g.spectrum = pickSome(g.pool, 1)[0] || ['Cold', 'Hot'];
  g.target = 8 + Math.floor(Math.random() * 85); // 8..92
  g.clue = '';
  g.guesses = new Map();
  g.startedAt = Date.now();
  g.deadline = g.startedAt + CLUE_MS;
  ctx.clearTimers();
  ctx.after(CLUE_MS, () => { if (g.sub === 'clue') next(room, ctx); });
  ctx.broadcast();
}

function toGuess(room, ctx) {
  const g = room.game;
  g.sub = 'guess';
  g.guesses = new Map();
  g.startedAt = Date.now();
  g.deadline = g.startedAt + GUESS_MS;
  ctx.clearTimers();
  ctx.after(GUESS_MS, () => toReveal(room, ctx));
  ctx.broadcast();
}

function toReveal(room, ctx) {
  const g = room.game;
  if (g.sub === 'reveal') return;
  g.sub = 'reveal';
  ctx.clearTimers();
  let totalPts = 0;
  let n = 0;
  for (const [pid, value] of g.guesses) {
    const player = room.players.get(pid);
    if (!player) continue;
    const pts = pointsFor(Math.abs(value - g.target));
    player.score += pts;
    totalPts += pts;
    n += 1;
  }
  // Reader earns the average of how well the guessers did — rewards good clues.
  const reader = room.players.get(g.readerId);
  if (reader && n > 0) reader.score += Math.round(totalPts / n);
  ctx.after(REVEAL_MS, () => next(room, ctx));
  ctx.broadcast();
}

function next(room, ctx) {
  room.game.turnIndex += 1;
  startRound(room, ctx);
}

function everyoneGuessed(room) {
  const g = room.game;
  const guessers = connected(room).filter((p) => p.id !== g.readerId);
  return guessers.length > 0 && guessers.every((p) => g.guesses.has(p.id));
}

export default {
  id: 'wavelength',
  name: 'Wavelength',
  emoji: '🎚️',
  description: 'The Reader gives a clue for a hidden spot on a spectrum (e.g. Innocent ←→ Filthy). Everyone slides a dial to guess it. Closer = more points. 3+ players.',
  minPlayers: 3,
  maxPlayers: 16,

  init(room, ctx) {
    const clean = !!(room.config && room.config.clean);
    room.game = {
      order: shuffle(connected(room).map((p) => p.id)),
      turnIndex: 0,
      pool: shuffle(clean ? SPECTRA_CLEAN : SPECTRA_FILTHY),
      sub: 'clue',
      readerId: null,
      spectrum: ['Cold', 'Hot'],
      target: 50,
      clue: '',
      guesses: new Map(),
      startedAt: 0,
      deadline: 0,
    };
    startRound(room, ctx);
  },

  action(room, playerId, action, ctx) {
    const g = room.game;
    if (!g) return;
    const isReader = playerId === g.readerId;

    if (action.type === 'clue') {
      if (g.sub !== 'clue' || !isReader) return;
      const raw = String(action.text || '').trim().slice(0, 60);
      if (!raw) return;
      g.clue = maybeCensor(raw, room.config && room.config.clean);
      toGuess(room, ctx);
    } else if (action.type === 'guess') {
      if (g.sub !== 'guess' || isReader) return;
      const value = clamp(Math.round(Number(action.value)), 0, 100);
      if (Number.isNaN(value)) return;
      g.guesses.set(playerId, value);
      if (everyoneGuessed(room)) toReveal(room, ctx);
      else ctx.broadcast();
    } else if (action.type === 'next') {
      if (room.hostId !== playerId) return;
      if (g.sub === 'clue') { if (g.clue) toGuess(room, ctx); else next(room, ctx); }
      else if (g.sub === 'guess') toReveal(room, ctx);
      else next(room, ctx);
    }
  },

  view(room, playerId) {
    const g = room.game;
    if (!g) return null;
    const isReader = playerId === g.readerId;
    const base = {
      sub: g.sub,
      round: g.turnIndex + 1,
      totalRounds: g.order.length,
      spectrum: g.spectrum,
      readerId: g.readerId,
      readerName: nameOf(room, g.readerId),
      isReader,
      clue: g.clue,
      leaderboard: leaderboard(room),
      playerCount: connected(room).length,
    };

    if (g.sub === 'clue') {
      base.target = isReader ? g.target : null; // only the Reader sees the target
      base.hasClue = !!g.clue;
      base.timeLeft = Math.max(0, g.deadline - Date.now());
      base.timeTotal = CLUE_MS;
    } else if (g.sub === 'guess') {
      base.youGuessed = g.guesses.has(playerId);
      base.yourGuess = g.guesses.has(playerId) ? g.guesses.get(playerId) : null;
      base.guessedCount = g.guesses.size;
      base.timeLeft = Math.max(0, g.deadline - Date.now());
      base.timeTotal = GUESS_MS;
    } else {
      base.target = g.target;
      base.guesses = [...g.guesses.entries()].map(([pid, value]) => ({
        name: nameOf(room, pid),
        emoji: (room.players.get(pid) || {}).emoji || '',
        value,
        points: pointsFor(Math.abs(value - g.target)),
      }));
    }
    return base;
  },
};
