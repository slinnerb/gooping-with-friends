import { $, escapeHtml, isPresenter } from '../ui.js';
import { sound } from '../sound.js';

let root = null;
let api = null;
let prevKey = null;
let prevSub = null;
let rafId = null;
let deadline = 0;
let total = 1;
let lastTick = -1;

function stopTimer() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }
function tickTimer() {
  const bar = root && root.querySelector('.timer-bar > i');
  const wrap = root && root.querySelector('.timer-bar');
  if (!bar) { stopTimer(); return; }
  const remaining = Math.max(0, deadline - Date.now());
  bar.style.width = Math.min(100, (remaining / total) * 100) + '%';
  if (wrap) wrap.classList.toggle('warn', remaining < 5000); // urgency cue (#36)
  const secs = Math.ceil(remaining / 1000);
  if (remaining > 0 && remaining < 5200 && secs !== lastTick) { lastTick = secs; sound.tick(); } // final-seconds ticks (#37)
  if (remaining > 0) rafId = requestAnimationFrame(tickTimer);
}

function miniBoard(lb) {
  return `<div class="mini-board">${lb.slice(0, 6)
    .map((p) => `<div class="mrow"><span>${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)}</span><b>${p.score}</b></div>`)
    .join('')}</div>`;
}

function topBar(g) {
  return `<div class="game-top"><div class="gt-title">🤔 Would You Rather</div><div class="gt-meta">Round ${g.round} / ${g.totalRounds}</div></div>
    <div class="timer-bar"><i style="width:100%"></i></div>
    <div class="wl-headline">Would you rather…</div>`;
}

function renderVote(g) {
  if (!g.youVoted && !isPresenter()) {
    return topBar(g) + `<div class="wyr-opts">
        <button class="wyr-opt a" data-c="0">${escapeHtml(g.options[0])}</button>
        <div class="wyr-or">OR</div>
        <button class="wyr-opt b" data-c="1">${escapeHtml(g.options[1])}</button>
      </div>`;
  }
  const msg = isPresenter() ? 'Everyone is deciding on their phones…' : '✅ Locked in! Waiting…';
  return topBar(g) + `<div class="wyr-static">
      <div class="wyr-opt a ${g.yourVote === 0 ? 'chosen' : ''}">${escapeHtml(g.options[0])}</div>
      <div class="wyr-or">OR</div>
      <div class="wyr-opt b ${g.yourVote === 1 ? 'chosen' : ''}">${escapeHtml(g.options[1])}</div>
    </div>
    <div class="quip-wait">${msg} <b id="wyr-count">${g.votedCount}/${g.playerCount}</b></div>`;
}

function renderReveal(g) {
  const total2 = Math.max(1, g.counts[0] + g.counts[1]);
  const row = (i) => {
    const pct = Math.round((g.counts[i] / total2) * 100);
    const win = g.winnerSide === i || g.winnerSide === -1;
    return `<div class="wyr-result ${win ? 'winner' : ''} ${i === 0 ? 'a' : 'b'}">
      <div class="wyr-rtext">${win ? '👑 ' : ''}${escapeHtml(g.options[i])}</div>
      <div class="wyr-rbar"><i style="width:${pct}%"></i></div>
      <div class="wyr-rcount">${g.counts[i]} · ${pct}%</div>
    </div>`;
  };
  return `<div class="game-top"><div class="gt-title">🤔 Would You Rather</div><div class="gt-meta">Round ${g.round} / ${g.totalRounds}</div></div>
    <div class="wl-headline">Would you rather…</div>
    <div class="wyr-results">${row(0)}${row(1)}</div>
    <div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
}

export default {
  id: 'wyr',

  mount(r, a) {
    root = r;
    api = a;
    prevKey = null;
    prevSub = null;
    root.innerHTML = '<div id="wyr-body"></div>';
    root.addEventListener('click', onClick);
  },

  update(view) {
    const g = view.game;
    if (!g) return;
    const key = `${g.sub}|${g.round}|${g.youVoted ? 1 : 0}`;
    const body = $('#wyr-body', root);
    if (key !== prevKey) {
      prevKey = key;
      body.innerHTML = g.sub === 'vote' ? renderVote(g) : renderReveal(g);
      if (g.sub !== prevSub && g.sub === 'reveal') sound.correct(); // lighter round sting; save win() for final results (#38)
      prevSub = g.sub;
      if (g.sub === 'vote') {
        total = 22000;
        deadline = Date.now() + (g.timeLeft || 22000);
        stopTimer();
        tickTimer();
      } else {
        stopTimer();
      }
    } else {
      const c = $('#wyr-count', root);
      if (c) c.textContent = `${g.votedCount}/${g.playerCount}`;
    }
  },

  unmount() {
    stopTimer();
    if (root) root.removeEventListener('click', onClick);
    root = null;
  },
};

function onClick(e) {
  const opt = e.target.closest('.wyr-opt[data-c]');
  if (opt) {
    api.send({ type: 'vote', choice: Number(opt.dataset.c) });
    sound.lock();
    root.querySelectorAll('.wyr-opt').forEach((b) => { b.disabled = true; });
    opt.classList.add('chosen');
  }
}
