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
  return `<div class="game-top"><div class="gt-title">😂 Quip Lash</div><div class="gt-meta">Round ${g.round} / ${g.totalRounds}</div></div>
    <div class="timer-bar"><i style="width:100%"></i></div>
    <div class="quip-prompt">${escapeHtml(g.prompt)}</div>`;
}

function renderAnswer(g) {
  let mid;
  if (isPresenter()) {
    mid = `<div class="quip-wait">✍️ Players are answering on their phones… <b id="quip-count">${g.answeredCount}/${g.playerCount}</b></div>`;
  } else if (g.youAnswered) {
    mid = `<div class="quip-wait">✅ Answer locked in!<div class="quip-your">${escapeHtml(g.yourAnswer)}</div>Waiting for everyone… <b id="quip-count">${g.answeredCount}/${g.playerCount}</b></div>`;
  } else {
    mid = `<textarea id="quip-input" maxlength="120" placeholder="Type something funny…"></textarea>
      <button class="btn" id="quip-send">Submit answer</button>
      <div class="subtle center mt"><span id="quip-count">${g.answeredCount}/${g.playerCount}</span> answered</div>`;
  }
  return topBar(g) + mid + `<div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
}

function renderVote(g) {
  const locked = isPresenter() || g.youVoted;
  const answers = `<div class="quip-answers">${g.answers
    .map((a) => `<button class="quip-ans ${a.mine ? 'mine' : ''} ${g.yourVote === a.i ? 'chosen' : ''}" data-i="${a.i}" ${locked || a.mine ? 'disabled' : ''}>${escapeHtml(a.text)}${a.mine ? ' <span class="subtle">(yours)</span>' : ''}</button>`)
    .join('')}</div>`;
  const head = isPresenter()
    ? `<div class="quip-wait">🗳️ Vote for the funniest on your phone… <b id="quip-count">${g.votedCount}/${g.playerCount}</b></div>`
    : g.youVoted
      ? `<div class="quip-wait">✅ Vote in! Waiting… <b id="quip-count">${g.votedCount}/${g.playerCount}</b></div>`
      : `<div class="subtle center" style="margin-bottom:8px">Tap the funniest answer (not your own)</div>`;
  return topBar(g) + head + answers;
}

function renderReveal(g) {
  const rows = g.results
    .map((r, i) => `<div class="quip-result ${i === 0 && r.votes > 0 ? 'winner' : ''}">
      <div class="qr-votes">${r.votes > 0 ? '⭐'.repeat(Math.min(r.votes, 6)) : '—'}</div>
      <div class="qr-main"><div class="qr-text">${escapeHtml(r.text)}</div>
      <div class="qr-author">${r.emoji ? r.emoji + ' ' : ''}${escapeHtml(r.name)} · ${r.votes} vote${r.votes === 1 ? '' : 's'}</div></div>
    </div>`)
    .join('');
  return `<div class="game-top"><div class="gt-title">😂 Quip Lash</div><div class="gt-meta">Round ${g.round} / ${g.totalRounds}</div></div>
    <div class="quip-prompt">${escapeHtml(g.prompt)}</div>
    <div class="quip-results">${rows}</div>
    <div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
}

export default {
  id: 'quip',

  mount(r, a) {
    root = r;
    api = a;
    prevKey = null;
    prevSub = null;
    root.innerHTML = '<div id="quip-body"></div>';
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
  },

  update(view) {
    const g = view.game;
    if (!g) return;
    const key = `${g.sub}|${g.round}|${g.youAnswered ? 1 : 0}|${g.youVoted ? 1 : 0}`;
    const body = $('#quip-body', root);

    if (key !== prevKey) {
      prevKey = key;
      if (g.sub === 'answer') body.innerHTML = renderAnswer(g);
      else if (g.sub === 'vote') body.innerHTML = renderVote(g);
      else body.innerHTML = renderReveal(g);

      if (g.sub !== prevSub && g.sub === 'reveal') sound.correct(); // lighter round sting; save win() for final results (#38)
      prevSub = g.sub;

      if (g.sub === 'answer' || g.sub === 'vote') {
        total = g.timeTotal || 30000;
        deadline = Date.now() + (g.timeLeft || 0);
        stopTimer();
        tickTimer();
      } else {
        stopTimer();
      }
    } else {
      // Same screen — just refresh the live counter without clobbering inputs.
      const c = $('#quip-count', root);
      if (c) c.textContent = g.sub === 'vote' ? `${g.votedCount}/${g.playerCount}` : `${g.answeredCount}/${g.playerCount}`;
    }
  },

  unmount() {
    stopTimer();
    if (root) {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
    }
    root = null;
  },
};

function submitAnswer() {
  const ta = $('#quip-input', root);
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) return;
  api.send({ type: 'answer', text });
  sound.lock();
}

function onClick(e) {
  if (e.target.closest('#quip-send')) { submitAnswer(); return; }
  const ans = e.target.closest('.quip-ans');
  if (ans && !ans.disabled) {
    api.send({ type: 'vote', index: Number(ans.dataset.i) });
    sound.lock();
    root.querySelectorAll('.quip-ans').forEach((b) => { b.disabled = true; });
    ans.classList.add('chosen');
  }
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'quip-input') {
    e.preventDefault();
    submitAnswer();
  }
}
