import { $, escapeHtml } from '../ui.js';
import { sound } from '../sound.js';

const SYMBOLS = ['▲', '◆', '●', '■'];
let root = null;
let api = null;
let rafId = null;
let deadline = 0;
let total = 1;
let prevSub = null;
let lastTick = -1;
let prevScores = {}; // last-reveal scores, to flash rows that just gained (#58)
let lastRevealSig = null; // avoid re-rendering reveal (and killing the flash) on a redundant broadcast

function stopTimer() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

function tickTimer() {
  const bar = root && root.querySelector('.timer-bar > i');
  const wrap = root && root.querySelector('.timer-bar');
  if (!bar) { stopTimer(); return; }
  const remaining = Math.max(0, deadline - Date.now());
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  bar.style.width = pct + '%';
  if (wrap) wrap.classList.toggle('warn', remaining < 5000);
  if (remaining > 0 && remaining < 5200) {
    const sec = Math.ceil(remaining / 1000);
    if (sec !== lastTick) { lastTick = sec; sound.tick(); }
  }
  if (remaining > 0) rafId = requestAnimationFrame(tickTimer);
}

function miniBoard(lb, gained) {
  const top = lb.slice(0, 5);
  return `<div class="mini-board">${top
    .map((p) => `<div class="mrow${gained && gained.has(p.id) ? ' gained' : ''}"><span>${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)}</span><b>${p.score}</b></div>`)
    .join('')}</div>`;
}

function renderQuestion(g) {
  const answered = g.youAnswered;
  const opts = g.options
    .map((opt, i) => {
      const chosen = g.yourChoice === i ? 'chosen' : '';
      const dim = answered && g.yourChoice !== i ? 'dim' : '';
      return `<button class="q-opt ${chosen} ${dim}" data-c="${i}" ${answered ? 'disabled' : ''}>
        <span class="sym">${SYMBOLS[i]}</span><span>${escapeHtml(opt)}</span>
      </button>`;
    })
    .join('');
  return `
    <div class="game-top">
      <div class="gt-title">😈 ${escapeHtml(g.category)}</div>
      <div class="gt-meta">Q ${g.index + 1} / ${g.total}</div>
    </div>
    <div class="timer-bar"><i style="width:100%"></i></div>
    <div class="q-text">${escapeHtml(g.question)}</div>
    <div class="q-options">${opts}</div>
    <div class="q-waiting ${answered ? '' : 'hidden'}">
      Locked in! ${g.answeredCount}/${g.playerCount} answered…
    </div>
    <div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>
  `;
}

function renderReveal(g) {
  let banner;
  if (g.yourChoice == null) banner = "⏳ Time's up!";
  else if (g.youCorrect) banner = `✅ Correct! +${g.yourGain}`;
  else banner = '❌ Not quite!';

  const opts = g.options
    .map((opt, i) => {
      const isCorrect = i === g.correct;
      const chosen = g.yourChoice === i ? 'chosen' : '';
      const dim = !isCorrect ? 'dim' : '';
      // A non-color cue (✓ / ✗) so right vs wrong survives for colorblind players (#53).
      const mark = isCorrect ? ' <b class="q-mark">✓</b>' : (chosen ? ' <b class="q-mark">✗</b>' : '');
      return `<button class="q-opt ${isCorrect ? 'correct' : ''} ${chosen} ${dim}" disabled data-c="${i}">
        <span class="sym">${SYMBOLS[i]}</span><span>${escapeHtml(opt)}${mark}</span>
        <span class="count">${g.counts[i] || 0}</span>
      </button>`;
    })
    .join('');
  // Flash mini-board rows whose score just rose this reveal (#58).
  const gained = new Set();
  for (const p of g.leaderboard) if ((prevScores[p.id] || 0) < p.score) gained.add(p.id);
  for (const p of g.leaderboard) prevScores[p.id] = p.score;
  return `
    <div class="game-top">
      <div class="gt-title">😈 ${escapeHtml(g.category)}</div>
      <div class="gt-meta">Q ${g.index + 1} / ${g.total}</div>
    </div>
    <div class="q-result-banner">${banner}</div>
    <div class="q-options">${opts}</div>
    <div style="margin-top:16px">${miniBoard(g.leaderboard, gained)}</div>
  `;
}

export default {
  id: 'trivia',

  mount(r, a) {
    root = r;
    api = a;
    prevSub = null;
    lastTick = -1;
    prevScores = {};
    lastRevealSig = null;
    root.innerHTML = '<div id="trivia-body"></div>';
    root.addEventListener('click', onClick);
  },

  update(view) {
    const g = view.game;
    if (!g) return;
    const body = $('#trivia-body', root);
    if (g.sub === 'question') {
      if (prevSub !== 'question') lastTick = -1;
      lastRevealSig = null; // next reveal should render fresh
      body.innerHTML = renderQuestion(g);
      total = g.timeTotal || 20000;
      deadline = Date.now() + (g.timeLeft || 0);
      stopTimer();
      tickTimer();
    } else {
      if (prevSub === 'question') {
        if (g.youCorrect) sound.correct();
        else if (g.yourChoice != null) sound.wrong();
      }
      stopTimer();
      // Only rebuild the reveal when its content changes — an unrelated broadcast
      // (a join/leave) mid-reveal would otherwise tear down the score-flash mid-animation.
      const sig = g.index + '|' + g.correct + '|' + (g.counts || []).join(',') + '|' + g.leaderboard.map((p) => p.id + ':' + p.score).join(',');
      if (sig !== lastRevealSig) { lastRevealSig = sig; body.innerHTML = renderReveal(g); }
    }
    prevSub = g.sub;
  },

  unmount() {
    stopTimer();
    if (root) root.removeEventListener('click', onClick);
    root = null;
  },
};

function onClick(e) {
  const btn = e.target.closest('.q-opt');
  if (!btn || btn.disabled) return;
  const choice = Number(btn.dataset.c);
  api.send({ type: 'answer', choice });
  sound.lock();
  // Optimistic lock so it feels instant before the server echoes state.
  btn.parentElement.querySelectorAll('.q-opt').forEach((b) => {
    b.disabled = true;
    if (b !== btn) b.classList.add('dim');
  });
  btn.classList.add('chosen');
}
