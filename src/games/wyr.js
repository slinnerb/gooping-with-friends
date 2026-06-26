// Would You Rather: a two-option dilemma appears, everyone picks A or B, and the
// majority side wins the round. Voting with the majority earns points (read the room).
import { shuffle, pickSome } from '../util.js';

const VOTE_MS = 22000;
const REVEAL_MS = 7000;

const LENGTHS = [
  { id: 3, name: 'Quick' },
  { id: 5, name: 'Normal' },
  { id: 8, name: 'Long' },
];

const FILTHY = [
  ["have sex with the lights fully on", "have sex in total pitch darkness"],
  ["accidentally send a nude to your boss", "accidentally send a nude to your parent"],
  ["loudly fart during sex every single time", "burp the alphabet right before every kiss"],
  ["throw up in an Uber and pay the fee", "throw up on your date at dinner"],
  ["only have drunk sex forever", "only have stone cold sober sex forever"],
  ["walk in on your parents getting busy", "have them walk in on you"],
  ["get caught watching porn by your grandma", "get caught by your new partner's mom"],
  ["have a one night stand who never texts back", "match with your cousin on a dating app"],
  ["pee the bed once a month forever", "drool a puddle on every pillow you touch"],
  ["have sex with someone who never shuts up", "have sex with someone who stays dead silent"],
  ["sext the wrong group chat", "leave your browser history open at a party"],
  ["drink a warm beer that someone backwashed in", "take a shot of the bar's mop water"],
  ["moan your ex's name in bed", "call your partner by the dog's name"],
  ["have explosive diarrhea on a first date", "puke during your own wedding toast"],
  ["never finish again", "always finish in under ten seconds"],
  ["lose your swimsuit in front of your in-laws", "flash the entire office on a video call"],
  ["hook up with someone with chronic bad breath", "hook up with someone with permanently sweaty hands"],
  ["have a hangover that lasts three full days", "be blackout drunk every Friday with no memory"],
  ["get a hickey you cannot hide before a job interview", "get a stain right where it looks the worst"],
  ["sit on a public toilet seat someone left warm", "use a porta potty at the end of a festival"],
  ["have your search history read aloud at Thanksgiving", "have your texts projected at the office party"],
  ["sleep with someone who keeps their socks on", "sleep with someone who narrates everything"],
  ["have a condom break with a near stranger", "explain an STD test to your very nosy mom"],
  ["queef loudly in a silent yoga class", "sneeze and fart at the exact same moment on stage"],
  ["only ever do it in your childhood bedroom", "only ever do it in the back of a small car"],
  ["get drunk and text every ex you have", "get drunk and confess your crush to their face"],
  ["have a wedgie you cannot fix all day", "have toilet paper stuck to your shoe all day"],
  ["share a toothbrush with a coworker for a week", "share underwear with a roommate for a day"],
  ["accidentally like an ex's photo from three years ago", "drunk dial your boss at 3am crying"],
  ["be the loudest person in the building at night", "have the thinnest walls and nosiest neighbor"],
];

const CLEAN = [
  ["have fingers as long as your legs", "have legs as short as your fingers"],
  ["fight one horse sized duck", "fight a hundred duck sized horses"],
  ["sneeze glitter every time you are surprised", "hum elevator music whenever you walk"],
  ["always have to skip everywhere you go", "always have to talk in rhyme"],
  ["have a permanent unicorn horn", "have a tail that wags when you are happy"],
  ["only be able to whisper for a year", "only be able to shout for a year"],
  ["live in a house made entirely of cheese", "live in a house made entirely of jello"],
  ["have a pet dragon the size of a hamster", "have a pet hamster the size of a dragon"],
  ["be followed by a tiny marching band all day", "have a dramatic spotlight follow you everywhere"],
  ["only eat food that is bright blue", "only eat food shaped like cubes"],
  ["sweat maple syrup when you are nervous", "cry tears that taste like lemonade"],
  ["have hair that changes color with your mood", "have shoes that squeak with every step"],
  ["talk to squirrels but they are rude", "talk to plants but they only complain"],
  ["wear a clown costume to every job interview", "wear a wedding dress to every grocery trip"],
  ["have hiccups that sound like a foghorn", "have a laugh that sounds like a dial up modem"],
  ["always be early but smell like onions", "always be late but smell amazing"],
  ["have a GPS voice narrate your whole life", "have a laugh track follow your every joke"],
  ["be a genius who forgets everything by lunch", "be average but remember literally everything"],
  ["have feet that grow a size every birthday", "have a nose that glows when you lie"],
  ["ride a giant snail to work every day", "ride an excitable ostrich that will not stop"],
];

function leaderboard(room) {
  return [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji || '', score: p.score, connected: p.connected }))
    .sort((a, b) => b.score - a.score);
}

function connected(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function normalizeLength(n) {
  return LENGTHS.some((l) => l.id === Number(n)) ? Number(n) : 5;
}

function startVote(room, ctx) {
  const g = room.game;
  g.sub = 'vote';
  g.prompt = g.prompts[g.index];
  g.votes = new Map();
  g.counts = [0, 0];
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
  const counts = [0, 0];
  for (const c of g.votes.values()) counts[c] += 1;
  g.counts = counts;
  // Majority side wins; voters on it score. A tie rewards everyone who voted.
  const winner = counts[0] > counts[1] ? 0 : counts[1] > counts[0] ? 1 : -1;
  g.winnerSide = winner;
  for (const [pid, c] of g.votes) {
    const player = room.players.get(pid);
    if (player && (winner === -1 || c === winner)) player.score += 100;
  }
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
  id: 'wyr',
  name: 'Would You Rather',
  emoji: '🤔',
  description: 'A brutal two-option dilemma — pick A or B. Side with the majority to score. 3+ players.',
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
      prompt: ['', ''],
      votes: new Map(),
      counts: [0, 0],
      winnerSide: -1,
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
      const choice = Number(action.choice);
      if (choice !== 0 && choice !== 1) return;
      g.votes.set(playerId, choice);
      if (allVoted(room)) toReveal(room, ctx);
      else ctx.broadcast();
    } else if (action.type === 'next') {
      if (room.hostId !== playerId) return;
      if (g.sub === 'vote') toReveal(room, ctx);
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
      options: g.prompt,
      leaderboard: leaderboard(room),
      playerCount: connected(room).length,
    };
    if (g.sub === 'vote') {
      base.youVoted = g.votes.has(playerId);
      base.yourVote = g.votes.has(playerId) ? g.votes.get(playerId) : null;
      base.votedCount = g.votes.size;
      base.timeLeft = Math.max(0, g.deadline - Date.now());
    } else {
      base.counts = g.counts;
      base.winnerSide = g.winnerSide;
      base.yourVote = g.votes.has(playerId) ? g.votes.get(playerId) : null;
    }
    return base;
  },
};
