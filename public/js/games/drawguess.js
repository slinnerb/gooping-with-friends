import { $, escapeHtml } from '../ui.js';
import { sound } from '../sound.js';

const W = 800;
const H = 520;
const PALETTE = ['#222222', '#e63946', '#f4a009', '#ffd000', '#19b37a', '#2a7de1', '#8a4bff', '#a05a2c', '#ffffff'];
const BRUSHES = [4, 12, 26];

let root = null;
let api = null;
let canvas = null;
let ctx = null;
let color = '#222222';
let brush = 12;
let drawing = false;
let last = null;
let curTurnId = -1;
let amDrawer = false;
let prevGuessed = 0;
let rafId = null;
let deadline = 0;
let total = 1;
let lastMsgSig = '';   // avoid rebuilding the chat list when it hasn't changed
let lastBoardSig = ''; // avoid rebuilding the mini-board when it hasn't changed

// Bound handlers (kept for cleanup).
let onStroke, onClear, onMsg, onPointerDown, onPointerMove, onPointerUp, onResizeWin;

function stopTimer() { if (rafId) cancelAnimationFrame(rafId); rafId = null; }

function tickTimer() {
  const bar = root && root.querySelector('.timer-bar > i');
  const wrap = root && root.querySelector('.timer-bar');
  if (!bar) { stopTimer(); return; }
  const remaining = Math.max(0, deadline - Date.now());
  bar.style.width = Math.min(100, (remaining / total) * 100) + '%';
  if (wrap) wrap.classList.toggle('warn', remaining < 10000);
  if (remaining > 0) rafId = requestAnimationFrame(tickTimer);
}

function clearBoard() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
}

function drawSeg(seg) {
  ctx.strokeStyle = seg.c;
  ctx.lineWidth = seg.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(seg.x1 * W, seg.y1 * H);
  ctx.lineTo(seg.x2 * W, seg.y2 * H);
  ctx.stroke();
}

function redraw(strokes) {
  clearBoard();
  for (const s of strokes || []) drawSeg(s);
}

function posFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
  };
}

function shell() {
  return `
    <div class="game-top">
      <div class="gt-title">🎨 Draw & Guess</div>
      <div class="gt-meta" id="dg-turn"></div>
    </div>
    <div class="timer-bar"><i style="width:100%"></i></div>
    <div class="dg-word" id="dg-word"></div>
    <div class="dg-wrap">
      <div class="canvas-wrap"><canvas id="board" width="${W}" height="${H}"></canvas></div>
      <div class="dg-tools" id="dg-tools" hidden>
        ${PALETTE.map((c) => `<div class="swatch" data-color="${c}" style="background:${c}"></div>`).join('')}
        ${BRUSHES.map((b) => `<div class="brush" data-brush="${b}"><b style="width:${b}px;height:${b}px"></b></div>`).join('')}
        <button class="btn small secondary" id="dg-clear">Clear</button>
        <button class="btn small secondary" id="dg-skip">Skip</button>
      </div>
      <div class="chat" id="dg-chat">
        <div class="msgs" id="dg-msgs"></div>
        <form id="dg-form" autocomplete="off">
          <input type="text" id="dg-input" maxlength="60" placeholder="Type your guess…" />
          <button class="btn small" type="submit">Send</button>
        </form>
      </div>
      <div id="dg-board"></div>
    </div>
  `;
}

function msgRowHtml(m) {
  if (m.kind === 'system') return `<div class="msg system">${escapeHtml(m.text)}</div>`;
  if (m.kind === 'correct') return `<div class="msg correct">✅ ${escapeHtml(m.text)}</div>`;
  if (m.kind === 'reveal') return `<div class="msg reveal">🎯 ${escapeHtml(m.text)}</div>`;
  return `<div class="msg"><b>${escapeHtml(m.name)}:</b> ${escapeHtml(m.text)}</div>`;
}

function renderMessages(messages) {
  const box = $('#dg-msgs', root);
  if (!box) return;
  box.innerHTML = messages.map(msgRowHtml).join('');
  box.scrollTop = box.scrollHeight;
}

// Append a single chat line from the lightweight dg:msg delta (wrong guesses),
// avoiding a full-state broadcast + rebuild. The next full update reconciles.
function appendMessage(m) {
  const box = $('#dg-msgs', root);
  if (!box) return;
  box.insertAdjacentHTML('beforeend', msgRowHtml(m));
  box.scrollTop = box.scrollHeight;
}

function renderBoard(g) {
  const guessed = new Set(g.guessedIds);
  $('#dg-board', root).innerHTML = `<div class="mini-board" style="margin-top:4px">${g.leaderboard
    .map((p) => {
      const mark = p.id === g.drawerId ? '✏️' : guessed.has(p.id) ? '✅' : '';
      return `<div class="mrow"><span>${mark} ${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)}</span><b>${p.score}</b></div>`;
    })
    .join('')}</div>`;
}

export default {
  id: 'drawguess',

  mount(r, a) {
    root = r;
    api = a;
    curTurnId = -1;
    prevGuessed = 0;
    root.innerHTML = shell();
    canvas = $('#board', root);
    ctx = canvas.getContext('2d');
    clearBoard();

    // Drawing input
    onPointerDown = (e) => {
      if (!amDrawer) return;
      drawing = true;
      last = posFromEvent(e);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* not all browsers/pointers support this */ }
      e.preventDefault();
    };
    onPointerMove = (e) => {
      if (!amDrawer || !drawing) return;
      const p = posFromEvent(e);
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.002) return;
      const seg = { x1: last.x, y1: last.y, x2: p.x, y2: p.y, c: color, w: brush };
      drawSeg(seg);
      api.send({ type: 'stroke', stroke: seg });
      last = p;
      e.preventDefault();
    };
    onPointerUp = () => { drawing = false; last = null; };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // Tools
    root.addEventListener('click', toolClick);
    $('#dg-form', root).addEventListener('submit', onGuess);

    // Live stroke events from the server
    onStroke = ({ turnId, seg }) => {
      if (turnId !== curTurnId) return;
      if (amDrawer) return; // drawer already rendered locally
      drawSeg(seg);
    };
    onClear = ({ turnId }) => {
      if (turnId === curTurnId) clearBoard();
    };
    // Lightweight chat delta for wrong guesses (no full-state broadcast).
    onMsg = ({ turnId, msg }) => {
      if (turnId === curTurnId && msg) appendMessage(msg);
    };
    api.socket.on('dg:stroke', onStroke);
    api.socket.on('dg:clear', onClear);
    api.socket.on('dg:msg', onMsg);

    highlightTools();
  },

  update(view) {
    const g = view.game;
    if (!g) return;
    amDrawer = g.isDrawer;

    // New turn → reset the canvas from authoritative history.
    if (g.turnId !== curTurnId) {
      curTurnId = g.turnId;
      prevGuessed = 0;
      lastMsgSig = ''; lastBoardSig = ''; // force a fresh render for the new turn
      redraw(g.strokes);
      sound.turn();
    }
    if (g.guessedIds.length > prevGuessed) {
      prevGuessed = g.guessedIds.length;
      sound.guess();
    }

    $('#dg-turn', root).textContent = `Turn ${g.turn} / ${g.totalTurns}`;

    // Word / hint line
    const wordEl = $('#dg-word', root);
    if (g.sub === 'between') {
      wordEl.textContent = `The word was “${g.word}”`;
    } else if (g.isDrawer) {
      wordEl.textContent = `Draw: ${g.word}`;
    } else if (g.youGuessed) {
      wordEl.textContent = `✅ ${g.word}`;
    } else {
      wordEl.textContent = g.hint;
    }

    // Tools only for the drawer while drawing
    $('#dg-tools', root).hidden = !(g.isDrawer && g.sub === 'drawing');

    // Chat state
    const chat = $('#dg-chat', root);
    const input = $('#dg-input', root);
    const canGuess = g.sub === 'drawing' && !g.isDrawer && !g.youGuessed;
    chat.classList.toggle('disabled', !canGuess);
    if (g.isDrawer) input.placeholder = "You're the artist — no guessing!";
    else if (g.youGuessed) input.placeholder = 'You guessed it! 🎉';
    else if (g.sub !== 'drawing') input.placeholder = 'Round over…';
    else input.placeholder = 'Type your guess…';

    // Timer
    if (g.sub === 'drawing') {
      total = g.timeTotal || 80000;
      deadline = Date.now() + (g.timeLeft || 0);
      stopTimer();
      tickTimer();
    } else {
      stopTimer();
    }

    // Only rebuild chat / board when their data actually changed — avoids DOM
    // thrash competing with the canvas draw path on every state event.
    const n = g.messages.length;
    const msgSig = n + '|' + (n ? JSON.stringify(g.messages[n - 1]) : '');
    if (msgSig !== lastMsgSig) { renderMessages(g.messages); lastMsgSig = msgSig; }
    const boardSig = g.drawerId + '|' + g.guessedIds.join(',') + '|' + g.leaderboard.map((p) => p.id + ':' + p.score).join(',');
    if (boardSig !== lastBoardSig) { renderBoard(g); lastBoardSig = boardSig; }
  },

  unmount() {
    stopTimer();
    if (canvas) {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
    }
    window.removeEventListener('pointerup', onPointerUp);
    if (root) root.removeEventListener('click', toolClick);
    if (api && api.socket) {
      api.socket.off('dg:stroke', onStroke);
      api.socket.off('dg:clear', onClear);
      api.socket.off('dg:msg', onMsg);
    }
    lastMsgSig = ''; lastBoardSig = '';
    root = null; canvas = null; ctx = null;
  },
};

function toolClick(e) {
  const sw = e.target.closest('[data-color]');
  if (sw) { color = sw.dataset.color; highlightTools(); return; }
  const br = e.target.closest('[data-brush]');
  if (br) { brush = Number(br.dataset.brush); highlightTools(); return; }
  if (e.target.closest('#dg-clear')) { api.send({ type: 'clear' }); return; }
  if (e.target.closest('#dg-skip')) { api.send({ type: 'skip' }); return; }
}

function highlightTools() {
  if (!root) return;
  root.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.dataset.color === color));
  root.querySelectorAll('.brush').forEach((b) => b.classList.toggle('active', Number(b.dataset.brush) === brush));
}

function onGuess(e) {
  e.preventDefault();
  const input = $('#dg-input', root);
  const text = input.value.trim();
  if (!text) return;
  api.send({ type: 'guess', text });
  input.value = '';
}
