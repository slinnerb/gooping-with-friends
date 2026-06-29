import { $, escapeHtml, isPresenter } from '../ui.js';
import { sound } from '../sound.js';

let root = null;
let api = null;
let prevKey = null;
let prevSub = null;
let rafId = null;
let deadline = 0;
let total = 1;
let amHost = false;

function stopTimer() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }
function tickTimer() {
  const bar = root && root.querySelector('.timer-bar > i');
  if (!bar) { stopTimer(); return; }
  const remaining = Math.max(0, deadline - Date.now());
  bar.style.width = Math.min(100, (remaining / total) * 100) + '%';
  if (remaining > 0) rafId = requestAnimationFrame(tickTimer);
}

function miniBoard(lb) {
  return `<div class="mini-board">${lb.slice(0, 6)
    .map((p) => `<div class="mrow"><span>${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)}</span><b>${p.score}</b></div>`)
    .join('')}</div>`;
}

function spectrumBar(g, inner) {
  return `<div class="wl-spectrum">
      <span class="wl-end wl-left">${escapeHtml(g.spectrum[0])}</span>
      <div class="wl-bar" id="wl-bar">${inner || ''}</div>
      <span class="wl-end wl-right">${escapeHtml(g.spectrum[1])}</span>
    </div>`;
}

function topBar(g, title) {
  return `<div class="game-top"><div class="gt-title">🎚️ Wavelength</div><div class="gt-meta">Round ${g.round} / ${g.totalRounds}</div></div>
    <div class="timer-bar"><i style="width:100%"></i></div>
    <div class="wl-headline">${title}</div>`;
}

function renderClue(g) {
  if (g.isReader && !isPresenter()) {
    const marker = `<div class="wl-targetline" style="left:${g.target}%">🎯</div>`;
    return topBar(g, 'You are the Reader — give a clue for the 🎯 spot') +
      spectrumBar(g, marker) +
      `<textarea id="wl-clue" maxlength="60" placeholder="One clue (a word or short phrase)…"></textarea>
       <button class="btn" id="wl-clue-send">Send clue</button>` +
      `<div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
  }
  return topBar(g, `🔮 ${escapeHtml(g.readerName)} is thinking of a clue…`) +
    spectrumBar(g) +
    `<div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
}

function renderGuess(g) {
  const canGuess = !g.isReader && !g.youGuessed && !isPresenter();
  const head = topBar(g, `Clue: <b>${escapeHtml(g.clue)}</b>`);
  if (canGuess) {
    const start = g.yourGuess != null ? g.yourGuess : 50;
    return head + spectrumBar(g, `<div class="wl-marker live" id="wl-live" style="left:${start}%">🔘</div>`) +
      `<input type="range" id="wl-slider" min="0" max="100" value="${start}" class="wl-slider">
       <button class="btn" id="wl-lock">Lock in guess</button>` +
      `<div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
  }
  const waitMsg = g.isReader ? 'Guessers are sliding their dials…' : g.youGuessed ? '✅ Locked in! Waiting…' : 'Guessing…';
  return head + spectrumBar(g) +
    `<div class="quip-wait">${waitMsg} <b id="wl-count">${g.guessedCount || 0}/${Math.max(0, g.playerCount - 1)}</b></div>` +
    `<div style="margin-top:14px">${miniBoard(g.leaderboard)}</div>`;
}

function renderReveal(g) {
  const markers = (g.guesses || [])
    .map((gu) => `<div class="wl-marker" style="left:${gu.value}%" title="${escapeHtml(gu.name)}">${gu.emoji || '📍'}<span class="wl-pts">+${gu.points}</span></div>`)
    .join('');
  const target = `<div class="wl-targetline reveal" style="left:${g.target}%">🎯</div>`;
  return topBar(g, `Clue: <b>${escapeHtml(g.clue || '—')}</b>`) +
    spectrumBar(g, target + markers) +
    `<div class="wl-reveal-list">${(g.guesses || [])
      .slice()
      .sort((a, b) => b.points - a.points)
      .map((gu) => `<div class="mrow"><span>${gu.emoji ? gu.emoji + ' ' : ''}${escapeHtml(gu.name)}</span><b>+${gu.points}</b></div>`)
      .join('')}</div>` +
    `<div style="margin-top:12px">${miniBoard(g.leaderboard)}</div>`;
}

export default {
  id: 'wavelength',

  mount(r, a) {
    root = r;
    api = a;
    prevKey = null;
    prevSub = null;
    root.innerHTML = '<div id="wl-body"></div>';
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
  },

  update(view) {
    const g = view.game;
    if (!g) return;
    amHost = !!(view.you && view.you.isHost);
    const key = `${g.sub}|${g.round}|${g.isReader ? 1 : 0}|${g.youGuessed ? 1 : 0}|${g.hasClue ? 1 : 0}|${amHost ? 1 : 0}`;
    const body = $('#wl-body', root);
    if (key !== prevKey) {
      prevKey = key;
      if (g.sub === 'clue') body.innerHTML = renderClue(g);
      else if (g.sub === 'guess') body.innerHTML = renderGuess(g);
      else body.innerHTML = renderReveal(g);
      if (amHost && (g.sub === 'clue' || g.sub === 'guess')) {
        body.insertAdjacentHTML('beforeend', '<button class="btn secondary small mt" id="wl-skip">Skip round ▸ (host)</button>');
      }

      if (g.sub !== prevSub && g.sub === 'reveal') sound.win();
      prevSub = g.sub;

      if (g.sub === 'clue' || g.sub === 'guess') {
        total = g.timeTotal || 30000;
        deadline = Date.now() + (g.timeLeft || 0);
        stopTimer();
        tickTimer();
      } else {
        stopTimer();
      }
    } else {
      const c = $('#wl-count', root);
      if (c && g.sub === 'guess') c.textContent = `${g.guessedCount || 0}/${Math.max(0, g.playerCount - 1)}`;
    }
  },

  unmount() {
    stopTimer();
    if (root) {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
    }
    root = null;
  },
};

function onInput(e) {
  if (e.target.id === 'wl-slider') {
    const live = $('#wl-live', root);
    if (live) live.style.left = e.target.value + '%';
  }
}

function onClick(e) {
  if (e.target.closest('#wl-skip')) { api.send({ type: 'next' }); sound.select(); return; }
  if (e.target.closest('#wl-clue-send')) {
    const ta = $('#wl-clue', root);
    const text = ta && ta.value.trim();
    if (text) { api.send({ type: 'clue', text }); sound.lock(); }
    return;
  }
  if (e.target.closest('#wl-lock')) {
    const s = $('#wl-slider', root);
    if (s) { api.send({ type: 'guess', value: Number(s.value) }); sound.lock(); }
  }
}
