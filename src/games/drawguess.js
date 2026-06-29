import { shuffle, pickSome, normalize, clamp, buildHint, maybeCensor } from '../util.js';

const DRAW_MS = 80000;
const BETWEEN_MS = 6000;
const MAX_STROKES = 6000;
const MAX_MESSAGES = 80;
const REVEAL_FRACTION = 0.45; // reveal up to ~45% of letters over the round

export const WORDS = [
  'fart', 'boobs', 'twerk', 'stripper pole', 'beer bong', 'condom', 'middle finger',
  'butt cheeks', 'vibrator', 'poop emoji', 'drunk uncle', 'vomit', 'thong', 'nipple',
  'sex toy', 'mooning', 'spanking', 'hangover', 'banana', 'sausage', 'beer belly',
  'cleavage', 'wedgie', 'skid mark', 'one night stand', 'walk of shame', 'booty call',
  'strip club', 'pole dance', 'hairy armpit', 'plunger', 'diaper', 'nudist', 'speedo',
  'g-string', 'make out', 'french kiss', 'whoopee cushion', 'toilet', 'morning wood',
];

export const CLEAN_WORDS = [
  'apple', 'rocket', 'guitar', 'elephant', 'pizza', 'rainbow', 'castle', 'robot',
  'butterfly', 'lighthouse', 'snowman', 'dragon', 'umbrella', 'cactus', 'penguin',
  'volcano', 'mermaid', 'bicycle', 'hamburger', 'spider', 'tornado', 'pirate',
  'octopus', 'campfire', 'sandcastle', 'helicopter', 'dinosaur', 'cupcake',
  'treasure', 'jellyfish', 'windmill', 'scarecrow', 'telescope', 'igloo',
  'kangaroo', 'waterfall', 'fireworks', 'sunflower', 'astronaut', 'ladybug',
];

// Progressive hint: reveals more letters as the round timer runs down.
function revealedHint(g) {
  const order = g.revealOrder || [];
  const maxReveal = Math.floor(order.length * REVEAL_FRACTION);
  const frac = clamp((Date.now() - g.startedAt) / DRAW_MS, 0, 1);
  const k = Math.min(maxReveal, Math.floor(frac * (maxReveal + 1)));
  return buildHint(g.word, new Set(order.slice(0, k)));
}

function leaderboard(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || '', score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

function pushMessage(room, msg) {
  const g = room.game;
  g.messages.push(msg);
  if (g.messages.length > MAX_MESSAGES) g.messages.shift();
}

function startTurn(room, ctx) {
  const g = room.game;
  // Find the next connected drawer.
  while (g.turnIndex < g.order.length) {
    const drawerId = g.order[g.turnIndex];
    const drawer = room.players.get(drawerId);
    if (drawer && drawer.connected) break;
    g.turnIndex += 1;
  }
  if (g.turnIndex >= g.order.length) {
    ctx.end();
    return;
  }
  g.turnId += 1;
  g.sub = 'drawing';
  g.drawerId = g.order[g.turnIndex];
  g.word = pickSome(g.wordPool, 1)[0] || 'apple';
  g.wordPool = g.wordPool.filter((w) => w !== g.word);
  g.revealOrder = shuffle(
    g.word.split('').map((ch, i) => (ch === ' ' ? -1 : i)).filter((i) => i >= 0)
  );
  g.strokes = [];
  g.guessed = new Map(); // playerId -> gained
  g.startedAt = Date.now();
  g.deadline = g.startedAt + DRAW_MS;
  g.messages = [];
  pushMessage(room, { kind: 'system', text: `${nameOf(room, g.drawerId)} is drawing!` });
  ctx.emitToRoom('dg:clear', { turnId: g.turnId });
  ctx.clearTimers();
  ctx.after(DRAW_MS, () => endTurn(room, ctx));
  // Push fresh hints partway through so revealed letters actually appear.
  ctx.after(Math.floor(DRAW_MS / 3), () => { if (g.sub === 'drawing') ctx.broadcast(); });
  ctx.after(Math.floor((DRAW_MS * 2) / 3), () => { if (g.sub === 'drawing') ctx.broadcast(); });
  ctx.broadcast();
}

function nameOf(room, id) {
  const p = room.players.get(id);
  return p ? p.name : 'Someone';
}

function endTurn(room, ctx) {
  const g = room.game;
  if (g.sub === 'between') return;
  g.sub = 'between';
  ctx.clearTimers();
  pushMessage(room, { kind: 'reveal', text: `The word was "${g.word}".` });
  ctx.after(BETWEEN_MS, () => {
    g.turnIndex += 1;
    startTurn(room, ctx);
  });
  ctx.broadcast();
}

function everyoneGuessed(room) {
  const g = room.game;
  const guessers = [...room.players.values()].filter(
    (p) => p.connected && p.id !== g.drawerId
  );
  if (guessers.length === 0) return false;
  return guessers.every((p) => g.guessed.has(p.id));
}

export default {
  id: 'drawguess',
  name: 'Draw & Guess',
  emoji: '🎨',
  description: 'One player draws a secret word while everyone races to guess it in chat. Fastest guesses win.',
  minPlayers: 2,
  maxPlayers: 16,

  init(room, ctx) {
    const order = shuffle(ctx.connectedPlayers().map((p) => p.id));
    const cfg = room.config || {};
    const words =
      cfg.customWords && cfg.customWords.length
        ? cfg.customWords
        : cfg.clean
          ? CLEAN_WORDS
          : WORDS;
    room.game = {
      order,
      turnIndex: 0,
      turnId: 0,
      sub: 'drawing',
      drawerId: null,
      word: '',
      revealOrder: [],
      wordPool: shuffle(words),
      strokes: [],
      guessed: new Map(),
      messages: [],
      startedAt: 0,
      deadline: 0,
    };
    startTurn(room, ctx);
  },

  action(room, playerId, action, ctx) {
    const g = room.game;
    if (!g) return;
    const isDrawer = playerId === g.drawerId;

    if (action.type === 'stroke') {
      if (!isDrawer || g.sub !== 'drawing') return;
      const s = action.stroke;
      if (!s || typeof s.x1 !== 'number' || typeof s.y1 !== 'number') return;
      const seg = {
        x1: clamp(s.x1, 0, 1),
        y1: clamp(s.y1, 0, 1),
        x2: clamp(s.x2, 0, 1),
        y2: clamp(s.y2, 0, 1),
        c: String(s.c || '#222').slice(0, 9),
        w: clamp(Number(s.w) || 4, 1, 60),
      };
      if (g.strokes.length < MAX_STROKES) g.strokes.push(seg);
      ctx.emitToRoom('dg:stroke', { turnId: g.turnId, seg });
      return;
    }

    if (action.type === 'clear') {
      if (!isDrawer || g.sub !== 'drawing') return;
      g.strokes = [];
      ctx.emitToRoom('dg:clear', { turnId: g.turnId });
      return;
    }

    if (action.type === 'guess') {
      if (g.sub !== 'drawing') return;
      if (isDrawer) return;
      const text = String(action.text || '').trim().slice(0, 60);
      if (!text) return;
      if (g.guessed.has(playerId)) return; // already correct, stop guessing

      if (normalize(text) === normalize(g.word)) {
        const remaining = clamp(g.deadline - Date.now(), 0, DRAW_MS);
        const gained = 100 + Math.round(400 * (remaining / DRAW_MS));
        g.guessed.set(playerId, gained);
        const player = room.players.get(playerId);
        if (player) player.score += gained;
        const drawer = room.players.get(g.drawerId);
        if (drawer) drawer.score += 100;
        pushMessage(room, { kind: 'correct', text: `${nameOf(room, playerId)} guessed the word! (+${gained})` });
        if (everyoneGuessed(room)) {
          endTurn(room, ctx);
          return;
        }
        ctx.broadcast();
      } else {
        const shown = maybeCensor(text, room.config && room.config.clean);
        pushMessage(room, { kind: 'chat', name: nameOf(room, playerId), text: shown });
        ctx.broadcast();
      }
      return;
    }

    if (action.type === 'skip') {
      if (room.hostId !== playerId && !isDrawer) return;
      endTurn(room, ctx);
    }
  },

  onLeave(room, playerId, ctx) {
    const g = room.game;
    if (!g) return;
    if (playerId === g.drawerId) { endTurn(room, ctx); return; }
    if (g.sub === 'drawing' && everyoneGuessed(room)) endTurn(room, ctx);
    else ctx.broadcast();
  },

  view(room, playerId) {
    const g = room.game;
    if (!g) return null;
    const isDrawer = playerId === g.drawerId;
    const youGuessed = g.guessed.has(playerId);
    const revealWord = g.sub === 'between' || isDrawer || youGuessed;
    return {
      sub: g.sub,
      turnId: g.turnId,
      turn: g.turnIndex + 1,
      totalTurns: g.order.length,
      drawerId: g.drawerId,
      drawerName: nameOf(room, g.drawerId),
      isDrawer,
      youGuessed,
      hint: revealedHint(g),
      word: revealWord ? g.word : null,
      wordLength: g.word.length,
      strokes: g.strokes,
      messages: g.messages,
      guessedIds: [...g.guessed.keys()],
      leaderboard: leaderboard(room),
      timeLeft: g.sub === 'drawing' ? Math.max(0, g.deadline - Date.now()) : 0,
      timeTotal: DRAW_MS,
    };
  },
};
