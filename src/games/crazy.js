// Crazy Mode: one session that mixes EVERYTHING — trivia question rounds and
// draw & guess rounds, back to back, with scores carrying across all of them.
import { shuffle, clamp, normalize, buildHint } from '../util.js';
import { everythingPool, shuffleQuestion } from './trivia.js';
import { WORDS, CLEAN_WORDS } from './drawguess.js';

const Q_MS = 18000;
const Q_REVEAL_MS = 5000;
const DRAW_MS = 70000;
const DRAW_BETWEEN_MS = 5000;
const MAX_STROKES = 6000;
const MAX_MESSAGES = 80;
const DRAW_EVERY = 3; // roughly every 3rd round is a draw round (when 2+ players)

const LENGTHS = [
  { id: 5, name: 'Short' },
  { id: 15, name: 'Regular' },
  { id: 30, name: 'Marathon' },
];

function normalizeLength(n) {
  return LENGTHS.some((l) => l.id === Number(n)) ? Number(n) : 30;
}

function nameOf(room, id) {
  const p = room.players.get(id);
  return p ? p.name : 'Someone';
}

function leaderboard(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || '', score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

function connectedCount(room) {
  return [...room.players.values()].filter((p) => p.connected).length;
}

function revealedHint(g) {
  const order = g.revealOrder || [];
  const maxReveal = Math.floor(order.length * 0.45);
  const frac = clamp((Date.now() - g.dStart) / DRAW_MS, 0, 1);
  const k = Math.min(maxReveal, Math.floor(frac * (maxReveal + 1)));
  return buildHint(g.word, new Set(order.slice(0, k)));
}

function pushMessage(room, msg) {
  const g = room.game;
  g.messages.push(msg);
  if (g.messages.length > MAX_MESSAGES) g.messages.shift();
}

function everyoneGuessed(room) {
  const g = room.game;
  const guessers = [...room.players.values()].filter((p) => p.connected && p.id !== g.drawerId);
  if (guessers.length === 0) return false;
  return guessers.every((p) => g.guessed.has(p.id));
}

// ---- round flow ----------------------------------------------------------

function startRound(room, ctx) {
  const g = room.game;
  if (g.index >= g.plan.length) {
    ctx.end();
    return;
  }
  ctx.clearTimers();
  const r = g.plan[g.index];
  g.mode = r.type;
  if (r.type === 'trivia') startTrivia(room, ctx, r);
  else startDraw(room, ctx, r);
}

function startTrivia(room, ctx, r) {
  const g = room.game;
  g.tSub = 'question';
  g.answers = new Map();
  g.question = r.question;
  g.qStart = Date.now();
  g.qDeadline = g.qStart + Q_MS;
  ctx.after(Q_MS, () => triviaReveal(room, ctx));
  ctx.broadcast();
}

function triviaReveal(room, ctx) {
  const g = room.game;
  if (g.tSub === 'reveal') return;
  g.tSub = 'reveal';
  ctx.clearTimers();
  const q = g.question;
  for (const [pid, a] of g.answers) {
    const p = room.players.get(pid);
    if (!p) continue;
    if (a.choice === q.answer) {
      const rem = clamp(g.qDeadline - a.at, 0, Q_MS);
      a.gained = 400 + Math.round(400 * (rem / Q_MS));
      p.score += a.gained;
    } else {
      a.gained = 0;
    }
  }
  ctx.after(Q_REVEAL_MS, () => nextRound(room, ctx));
  ctx.broadcast();
}

function startDraw(room, ctx, r) {
  const g = room.game;
  let drawerId = r.drawerId;
  const drawer = room.players.get(drawerId);
  if (!drawer || !drawer.connected) {
    const alt = ctx.connectedPlayers()[0];
    drawerId = alt ? alt.id : null;
  }
  g.turnId = (g.turnId || 0) + 1;
  g.dSub = 'drawing';
  g.drawerId = drawerId;
  g.word = r.word;
  g.revealOrder = shuffle(
    r.word.split('').map((ch, i) => (ch === ' ' ? -1 : i)).filter((i) => i >= 0)
  );
  g.strokes = [];
  g.guessed = new Map();
  g.messages = [];
  g.dStart = Date.now();
  g.dDeadline = g.dStart + DRAW_MS;
  pushMessage(room, { kind: 'system', text: `${nameOf(room, drawerId)} is drawing!` });
  ctx.emitToRoom('dg:clear', { turnId: g.turnId });
  ctx.after(DRAW_MS, () => drawEnd(room, ctx));
  ctx.after(Math.floor(DRAW_MS / 3), () => { if (g.dSub === 'drawing') ctx.broadcast(); });
  ctx.after(Math.floor((DRAW_MS * 2) / 3), () => { if (g.dSub === 'drawing') ctx.broadcast(); });
  ctx.broadcast();
}

function drawEnd(room, ctx) {
  const g = room.game;
  if (g.dSub === 'between') return;
  g.dSub = 'between';
  ctx.clearTimers();
  pushMessage(room, { kind: 'reveal', text: `The word was "${g.word}".` });
  ctx.after(DRAW_BETWEEN_MS, () => nextRound(room, ctx));
  ctx.broadcast();
}

function nextRound(room, ctx) {
  room.game.index += 1;
  startRound(room, ctx);
}

// ---- module --------------------------------------------------------------

export default {
  id: 'crazy',
  name: 'Crazy Mode',
  emoji: '🤪',
  description: 'EVERYTHING at once — trivia questions and draw & guess rounds mixed together. 30 rounds of chaos (pick a shorter length to warm up).',
  minPlayers: 1,
  maxPlayers: 16,
  lengths: LENGTHS,

  init(room, ctx) {
    const count = normalizeLength(room.config && room.config.length);
    const clean = !!(room.config && room.config.clean);
    const canDraw = connectedCount(room) >= 2;
    const qPool = shuffle(everythingPool(clean));
    const wPool = shuffle(clean ? CLEAN_WORDS : WORDS);
    const drawerCycle = shuffle(ctx.connectedPlayers().map((p) => p.id));
    let qi = 0;
    let wi = 0;
    let di = 0;
    const plan = [];
    for (let i = 0; i < count; i++) {
      const isDraw = canDraw && i % DRAW_EVERY === DRAW_EVERY - 1;
      if (isDraw) {
        plan.push({
          type: 'draw',
          word: wPool[wi++ % wPool.length] || 'banana',
          drawerId: drawerCycle[di++ % drawerCycle.length],
        });
      } else {
        const q = qPool[qi++ % qPool.length];
        plan.push({ type: 'trivia', question: shuffleQuestion(q) });
      }
    }
    room.game = {
      plan,
      index: 0,
      mode: plan[0].type,
      turnId: 0,
      answers: new Map(),
      messages: [],
      guessed: new Map(),
      strokes: [],
    };
    startRound(room, ctx);
  },

  action(room, playerId, action, ctx) {
    const g = room.game;
    if (!g) return;

    if (g.mode === 'trivia') {
      if (action.type === 'answer') {
        if (g.tSub !== 'question' || g.answers.has(playerId)) return;
        const c = Number(action.choice);
        if (!Number.isInteger(c) || c < 0 || c > 3) return;
        g.answers.set(playerId, { choice: c, at: Date.now() });
        const conn = ctx.connectedPlayers();
        if (conn.every((p) => g.answers.has(p.id))) triviaReveal(room, ctx);
        else ctx.broadcast();
      } else if (action.type === 'next') {
        if (room.hostId !== playerId) return;
        if (g.tSub === 'question') triviaReveal(room, ctx);
        else nextRound(room, ctx);
      }
      return;
    }

    // draw mode
    const isDrawer = playerId === g.drawerId;
    if (action.type === 'stroke') {
      if (!isDrawer || g.dSub !== 'drawing') return;
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
    } else if (action.type === 'clear') {
      if (!isDrawer || g.dSub !== 'drawing') return;
      g.strokes = [];
      ctx.emitToRoom('dg:clear', { turnId: g.turnId });
    } else if (action.type === 'guess') {
      if (g.dSub !== 'drawing' || isDrawer) return;
      const text = String(action.text || '').trim().slice(0, 60);
      if (!text || g.guessed.has(playerId)) return;
      if (normalize(text) === normalize(g.word)) {
        const rem = clamp(g.dDeadline - Date.now(), 0, DRAW_MS);
        const gained = 100 + Math.round(300 * (rem / DRAW_MS));
        g.guessed.set(playerId, gained);
        const p = room.players.get(playerId);
        if (p) p.score += gained;
        const d = room.players.get(g.drawerId);
        if (d) d.score += 80;
        pushMessage(room, { kind: 'correct', text: `${nameOf(room, playerId)} guessed it! (+${gained})` });
        if (everyoneGuessed(room)) {
          drawEnd(room, ctx);
          return;
        }
        ctx.broadcast();
      } else {
        pushMessage(room, { kind: 'chat', name: nameOf(room, playerId), text });
        ctx.broadcast();
      }
    } else if (action.type === 'skip') {
      if (room.hostId !== playerId && !isDrawer) return;
      drawEnd(room, ctx);
    }
  },

  onLeave(room, playerId, ctx) {
    const g = room.game;
    if (!g) return;
    if (g.mode === 'trivia') {
      if (g.tSub !== 'question') return;
      const conn = ctx.connectedPlayers();
      if (conn.length && conn.every((p) => g.answers.has(p.id))) triviaReveal(room, ctx);
      else ctx.broadcast();
    } else {
      if (playerId === g.drawerId) { drawEnd(room, ctx); return; }
      if (g.dSub === 'drawing' && everyoneGuessed(room)) drawEnd(room, ctx);
      else ctx.broadcast();
    }
  },

  view(room, playerId) {
    const g = room.game;
    if (!g) return null;
    const players = connectedCount(room);
    const base = {
      crazy: true,
      mode: g.mode,
      round: g.index + 1,
      totalRounds: g.plan.length,
      leaderboard: leaderboard(room),
    };

    if (g.mode === 'trivia') {
      const q = g.question;
      const my = g.answers.get(playerId);
      base.sub = g.tSub;
      base.index = g.index;
      base.total = g.plan.length;
      base.category = 'Crazy Mode';
      base.question = q.q;
      base.options = q.options;
      base.answeredCount = g.answers.size;
      base.playerCount = players;
      if (g.tSub === 'question') {
        base.timeLeft = Math.max(0, g.qDeadline - Date.now());
        base.timeTotal = Q_MS;
        base.youAnswered = !!my;
        base.yourChoice = my ? my.choice : null;
      } else {
        base.correct = q.answer;
        base.yourChoice = my ? my.choice : null;
        base.yourGain = my ? my.gained || 0 : 0;
        base.youCorrect = !!my && my.choice === q.answer;
        const counts = [0, 0, 0, 0];
        for (const a of g.answers.values()) counts[a.choice] = (counts[a.choice] || 0) + 1;
        base.counts = counts;
      }
    } else {
      const isDrawer = playerId === g.drawerId;
      const youGuessed = g.guessed.has(playerId);
      const reveal = g.dSub === 'between' || isDrawer || youGuessed;
      base.sub = g.dSub;
      base.turnId = g.turnId;
      base.turn = g.index + 1;
      base.totalTurns = g.plan.length;
      base.drawerId = g.drawerId;
      base.drawerName = nameOf(room, g.drawerId);
      base.isDrawer = isDrawer;
      base.youGuessed = youGuessed;
      base.hint = revealedHint(g);
      base.word = reveal ? g.word : null;
      base.wordLength = g.word.length;
      base.strokes = g.strokes;
      base.messages = g.messages;
      base.guessedIds = [...g.guessed.keys()];
      base.timeLeft = g.dSub === 'drawing' ? Math.max(0, g.dDeadline - Date.now()) : 0;
      base.timeTotal = DRAW_MS;
    }
    return base;
  },
};
