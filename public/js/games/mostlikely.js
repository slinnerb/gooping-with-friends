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

function topBar(g, title) {
  return `<div class="game-top"><div class="gt-title">🫵 Most Likely To</div><div class="gt-meta">Round ${g.round} / ${g.totalRounds}</div></div>
    <div class="timer-bar"><i style="width:100%"></i></div>
    <div class="quip-prompt">${escapeHtml(title)}</div>`;
}

function renderVote(view) {
  const g = view.game;
  const meId = view.you && view.you.id;
  const players = view.players.filter((p) => p.connected && p.id !== meId);
  if (!g.youVoted && !isPresenter()) {
    const btns = players
      .map((p) => `<button class="ml-pick ${g.yourVote === p.id ? 'chosen' : ''}" data-id="${p.id}">
        <span class="ml-emoji">${p.emoji || '🙂'}</span><span>${escapeHtml(p.name)}</span></button>`)
      .join('');
    return topBar(g, g.prompt) + `<div class="ml-picks">${btns}</div>`;
  }
  const msg = isPresenter() ? 'Everyone is voting on their phones…' : '✅ Vote in! Waiting…';
  return topBar(g, g.prompt) + `<div class="quip-wait">${msg} <b id="ml-count">${g.votedCount}/${g.playerCount}</b></div>` +
    `<div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
}

function renderReveal(g) {
  const max = Math.max(1, ...g.tally.map((t) => t.votes));
  const rows = g.tally
    .map((t) => `<div class="ml-result ${t.id === g.winnerId ? 'winner' : ''}">
      <div class="ml-name">${t.id === g.winnerId ? '👑 ' : ''}${t.emoji ? t.emoji + ' ' : ''}${escapeHtml(t.name)}</div>
      <div class="ml-bar"><i style="width:${Math.round((t.votes / max) * 100)}%"></i></div>
      <div class="ml-votes">${t.votes}</div>
    </div>`)
    .join('');
  return `<div class="game-top"><div class="gt-title">🫵 Most Likely To</div><div class="gt-meta">Round ${g.round} / ${g.totalRounds}</div></div>
    <div class="quip-prompt">${escapeHtml(g.prompt)}</div>
    <div class="ml-results">${rows || '<div class="quip-wait">No votes 🤷</div>'}</div>
    <div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
}

export default {
  id: 'mostlikely',

  mount(r, a) {
    root = r;
    api = a;
    prevKey = null;
    prevSub = null;
    root.innerHTML = '<div id="ml-body"></div>';
    root.addEventListener('click', onClick);
  },

  update(view) {
    const g = view.game;
    if (!g) return;
    const key = `${g.sub}|${g.round}|${g.youVoted ? 1 : 0}`;
    const body = $('#ml-body', root);
    if (key !== prevKey) {
      prevKey = key;
      body.innerHTML = g.sub === 'vote' ? renderVote(view) : renderReveal(g);
      if (g.sub !== prevSub && g.sub === 'reveal') sound.correct(); // lighter round sting; save win() for final results (#38)
      prevSub = g.sub;
      if (g.sub === 'vote') {
        total = 25000;
        deadline = Date.now() + (g.timeLeft || 25000);
        stopTimer();
        tickTimer();
      } else {
        stopTimer();
      }
    } else {
      const c = $('#ml-count', root);
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
  const pick = e.target.closest('.ml-pick');
  if (pick) {
    api.send({ type: 'vote', target: pick.dataset.id });
    sound.lock();
    root.querySelectorAll('.ml-pick').forEach((b) => { b.disabled = true; });
    pick.classList.add('chosen');
  }
}
