// "Most Likely To": a prompt appears, everyone votes for the player it fits
// best (anonymous). Each vote received = points. The most-voted player wins the
// round. The end "leaderboard" is basically a ranking of degenerates.
import { shuffle, pickSome } from '../util.js';
import { FILTHY, CLEAN } from './mostlikely-prompts.js';

const VOTE_MS = 25000;
const REVEAL_MS = 7000;

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

function startVote(room, ctx) {
  const g = room.game;
  g.sub = 'vote';
  g.prompt = g.prompts[g.index];
  g.votes = new Map();
  g.startedAt = Date.now();
  g.deadline = g.startedAt + VOTE_MS;
  ctx.clearTimers();
  ctx.after(VOTE_MS, () => toReveal(room, ctx));
  ctx.broadcast();
}

function toReveal(room, ctx) {
  const g = room.game;
  if (g.sub === 'reveal') return;
  g.sub = 'reveal';
  ctx.clearTimers();
  const counts = new Map();
  for (const target of g.votes.values()) counts.set(target, (counts.get(target) || 0) + 1);
  let winnerId = null;
  let best = 0;
  for (const [id, c] of counts) {
    const player = room.players.get(id);
    if (player) player.score += c * 100;
    if (c > best) { best = c; winnerId = id; }
  }
  g.tally = [...counts.entries()].map(([id, votes]) => ({ id, votes }));
  g.winnerId = best > 0 ? winnerId : null;
  ctx.after(REVEAL_MS, () => next(room, ctx));
  ctx.broadcast();
}

function next(room, ctx) {
  const g = room.game;
  g.index += 1;
  if (g.index >= g.prompts.length) { ctx.end(); return; }
  startVote(room, ctx);
}

function allVoted(room) {
  const g = room.game;
  return connected(room).every((p) => g.votes.has(p.id));
}

export default {
  id: 'mostlikely',
  name: 'Most Likely To',
  emoji: '🫵',
  description: 'A prompt drops, everyone votes for the friend it fits best. Most votes wins the round. 3+ players.',
  minPlayers: 3,
  maxPlayers: 16,
  lengths: LENGTHS,

  init(room, ctx) {
    const count = normalizeLength(room.config && room.config.length);
    const bank = room.config && room.config.clean ? CLEAN : FILTHY;
    room.game = {
      prompts: pickSome(bank, Math.min(count, bank.length)),
      index: 0,
      sub: 'vote',
      prompt: '',
      votes: new Map(),
      tally: [],
      winnerId: null,
      startedAt: 0,
      deadline: 0,
    };
    startVote(room, ctx);
  },

  action(room, playerId, action, ctx) {
    const g = room.game;
    if (!g) return;
    if (action.type === 'vote') {
      if (g.sub !== 'vote') return;
      const target = String(action.target || '');
      if (target === playerId) return; // no voting for yourself
      const tp = room.players.get(target);
      if (!tp || !tp.connected) return;
      g.votes.set(playerId, target);
      if (allVoted(room)) toReveal(room, ctx);
      else ctx.broadcast();
    } else if (action.type === 'next') {
      if (room.hostId !== playerId) return;
      if (g.sub === 'vote') toReveal(room, ctx);
      else next(room, ctx);
    }
  },

  onLeave(room, _playerId, ctx) {
    const g = room.game;
    if (!g || g.sub !== 'vote') return;
    if (allVoted(room)) toReveal(room, ctx);
    else ctx.broadcast();
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
    if (g.sub === 'vote') {
      base.youVoted = g.votes.has(playerId);
      base.yourVote = g.votes.has(playerId) ? g.votes.get(playerId) : null;
      base.votedCount = g.votes.size;
      base.timeLeft = Math.max(0, g.deadline - Date.now());
    } else {
      base.winnerId = g.winnerId;
      base.tally = g.tally
        .map((t) => ({ id: t.id, name: nameOf(room, t.id), emoji: (room.players.get(t.id) || {}).emoji || '', votes: t.votes }))
        .sort((a, b) => b.votes - a.votes);
    }
    return base;
  },
};
