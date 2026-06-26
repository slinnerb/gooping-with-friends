// Quiplash-style game: everyone answers the same prompt, then everyone votes
// for the funniest answer (you can't vote your own). Votes = points.
import { shuffle, pickSome, maybeCensor } from '../util.js';
import { FILTHY, CLEAN } from './quip-prompts.js';

const ANSWER_MS = 50000;
const VOTE_MS = 25000;
const REVEAL_MS = 9000;

const LENGTHS = [
  { id: 3, name: 'Quick' },
  { id: 5, name: 'Normal' },
  { id: 8, name: 'Long' },
];

function normalizeLength(n) {
  return LENGTHS.some((l) => l.id === Number(n)) ? Number(n) : 5;
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

function connected(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function startAnswer(room, ctx) {
  const g = room.game;
  g.sub = 'answer';
  g.prompt = g.prompts[g.index];
  g.answers = new Map();
  g.votes = new Map();
  g.shuffled = [];
  g.startedAt = Date.now();
  g.deadline = g.startedAt + ANSWER_MS;
  ctx.clearTimers();
  ctx.after(ANSWER_MS, () => toVote(room, ctx));
  ctx.broadcast();
}

function toVote(room, ctx) {
  const g = room.game;
  if (g.sub !== 'answer') return;
  ctx.clearTimers();
  // Build the anonymized answer list (only players who answered).
  g.shuffled = shuffle(
    [...g.answers.entries()].map(([authorId, text]) => ({ authorId, text }))
  );
  if (g.shuffled.length < 2) {
    // Not enough answers to vote on — reveal what we have and move on.
    toReveal(room, ctx);
    return;
  }
  g.sub = 'vote';
  g.votes = new Map();
  g.startedAt = Date.now();
  g.deadline = g.startedAt + VOTE_MS;
  ctx.after(VOTE_MS, () => toReveal(room, ctx));
  ctx.broadcast();
}

function toReveal(room, ctx) {
  const g = room.game;
  if (g.sub === 'reveal') return;
  g.sub = 'reveal';
  ctx.clearTimers();
  // Tally votes per answer index.
  const counts = g.shuffled.map(() => 0);
  for (const idx of g.votes.values()) {
    if (idx >= 0 && idx < counts.length) counts[idx] += 1;
  }
  g.counts = counts;
  let best = -1;
  let bestVotes = 0;
  counts.forEach((c, i) => {
    const player = room.players.get(g.shuffled[i].authorId);
    if (player) player.score += c * 100;
    if (c > bestVotes) { bestVotes = c; best = i; }
  });
  // Bonus for the round winner (if anyone got votes).
  if (best >= 0 && bestVotes > 0) {
    const winner = room.players.get(g.shuffled[best].authorId);
    if (winner) winner.score += 200;
  }
  ctx.after(REVEAL_MS, () => next(room, ctx));
  ctx.broadcast();
}

function next(room, ctx) {
  const g = room.game;
  g.index += 1;
  if (g.index >= g.prompts.length) {
    ctx.end();
    return;
  }
  startAnswer(room, ctx);
}

function allAnswered(room) {
  const g = room.game;
  return connected(room).every((p) => g.answers.has(p.id));
}

function allVoted(room) {
  const g = room.game;
  // Eligible voters: connected players who are NOT the sole author of an answer
  // can always vote (they just can't pick their own).
  return connected(room).every((p) => g.votes.has(p.id));
}

export default {
  id: 'quip',
  name: 'Quip Lash',
  emoji: '😂',
  description: 'Everyone answers the same ridiculous prompt, then votes for the funniest. Votes = points. Best with 3+ players.',
  minPlayers: 3,
  maxPlayers: 16,
  lengths: LENGTHS,

  init(room, ctx) {
    const count = normalizeLength(room.config && room.config.length);
    const cfg = room.config || {};
    const bank = cfg.customPrompts && cfg.customPrompts.length ? cfg.customPrompts : cfg.clean ? CLEAN : FILTHY;
    room.game = {
      prompts: pickSome(bank, Math.min(count, bank.length)),
      index: 0,
      sub: 'answer',
      prompt: '',
      answers: new Map(),
      votes: new Map(),
      shuffled: [],
      counts: [],
      startedAt: 0,
      deadline: 0,
    };
    startAnswer(room, ctx);
  },

  action(room, playerId, action, ctx) {
    const g = room.game;
    if (!g) return;

    if (action.type === 'answer') {
      if (g.sub !== 'answer') return;
      const raw = String(action.text || '').trim().slice(0, 120);
      if (!raw) return;
      const text = maybeCensor(raw, room.config && room.config.clean);
      g.answers.set(playerId, text);
      if (allAnswered(room)) toVote(room, ctx);
      else ctx.broadcast();
    } else if (action.type === 'vote') {
      if (g.sub !== 'vote') return;
      if (g.votes.has(playerId)) return;
      const idx = Number(action.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= g.shuffled.length) return;
      if (g.shuffled[idx].authorId === playerId) return; // no voting your own
      g.votes.set(playerId, idx);
      if (allVoted(room)) toReveal(room, ctx);
      else ctx.broadcast();
    } else if (action.type === 'next') {
      if (room.hostId !== playerId) return;
      if (g.sub === 'answer') toVote(room, ctx);
      else if (g.sub === 'vote') toReveal(room, ctx);
      else next(room, ctx);
    }
  },

  view(room, playerId) {
    const g = room.game;
    if (!g) return null;
    const base = {
      sub: g.sub,
      round: g.index + 1,
      totalRounds: g.prompts.length,
      prompt: g.prompt,
      leaderboard: leaderboard(room),
      playerCount: connected(room).length,
    };

    if (g.sub === 'answer') {
      base.youAnswered = g.answers.has(playerId);
      base.yourAnswer = g.answers.get(playerId) || '';
      base.answeredCount = g.answers.size;
      base.timeLeft = Math.max(0, g.deadline - Date.now());
      base.timeTotal = ANSWER_MS;
    } else if (g.sub === 'vote') {
      base.answers = g.shuffled.map((a, i) => ({ i, text: a.text, mine: a.authorId === playerId }));
      base.youVoted = g.votes.has(playerId);
      base.yourVote = g.votes.has(playerId) ? g.votes.get(playerId) : null;
      base.votedCount = g.votes.size;
      base.timeLeft = Math.max(0, g.deadline - Date.now());
      base.timeTotal = VOTE_MS;
    } else {
      base.results = g.shuffled
        .map((a, i) => ({
          text: a.text,
          name: nameOf(room, a.authorId),
          emoji: (room.players.get(a.authorId) || {}).emoji || '',
          votes: g.counts[i] || 0,
        }))
        .sort((x, y) => y.votes - x.votes);
    }
    return base;
  },
};
