// Small shared helpers.

// Unambiguous alphabet for invite codes (no O/0, I/1, etc.).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeCode(length = 4) {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

let idCounter = 0;
export function makeId(prefix = 'id') {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function shuffle(array) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickSome(array, n) {
  return shuffle(array).slice(0, n);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Build a Draw & Guess hint string: revealed letter indices show the letter,
// spaces stay as a gap, everything else is an underscore.
export function buildHint(word, revealedSet) {
  return word
    .split('')
    .map((ch, i) => (ch === ' ' ? '  ' : revealedSet.has(i) ? ch : '_'))
    .join(' ');
}

// Profanity filter — only applied in Clean mode (the game is filthy by default).
const PROFANITY = [
  'fuck', 'fucking', 'fucker', 'shit', 'shitty', 'bitch', 'bitches', 'asshole', 'ass',
  'dick', 'cock', 'pussy', 'cunt', 'bastard', 'piss', 'tits', 'titties', 'boobs',
  'cum', 'slut', 'whore', 'dildo', 'wank', 'jizz', 'bollocks', 'twat', 'prick',
  'nipple', 'horny', 'orgasm', 'penis', 'vagina', 'boner', 'crap',
];
const PROFANITY_RE = new RegExp('\\b(' + PROFANITY.join('|') + ')\\b', 'gi');

export function censor(text) {
  return String(text || '').replace(PROFANITY_RE, (m) => m[0] + '*'.repeat(Math.max(1, m.length - 1)));
}

// Censor only when clean mode is on.
export function maybeCensor(text, clean) {
  return clean ? censor(text) : text;
}

// Normalize a free-text guess for comparison (lowercase, strip punctuation/spaces).
export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
