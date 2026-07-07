import { $, $$, escapeHtml, initials, avatarColor, avatarInner, toast, confetti } from './ui.js';
import { clientGames } from './games/index.js';
import { sound } from './sound.js';

// eslint-disable-next-line no-undef
const socket = io();

const EMOJIS = ['🤪', '😈', '💀', '🔥', '👽', '🤡', '🦄', '🐸', '🐙', '🦖', '🍑', '🍆', '🌮', '🍕', '🤖', '👹', '🦊', '🐼', '🐧', '🫠', '💩', '👻', '🎃', '🐝'];

const store = {
  playerId: ensureId(),
  secret: ensureSecret(),
  name: localStorage.getItem('pwf.name') || '',
  emoji: localStorage.getItem('pwf.emoji') || '',
  view: null,
  activeCode: sessionStorage.getItem('pwf.room') || null,
  mountedGameId: null,
  shareLink: null,
  shareIsPublic: false, // true once the copied link is the internet tunnel URL
  prevPlayers: 0,
  customUiType: null,
  draftQ: '',
  draftW: '',
  draftP: '',
  standingsOpen: false,
};

function ensureId() {
  let id = localStorage.getItem('pwf.id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('pwf.id', id);
  }
  return id;
}

// Per-device secret that authenticates this playerId on every (re)join, so a
// broadcast playerId can't be used to impersonate us (e.g. take over as host).
function ensureSecret() {
  let s = localStorage.getItem('pwf.secret');
  if (!s) {
    s = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 's_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    localStorage.setItem('pwf.secret', s);
  }
  return s;
}

// Track which room we're in, persisted so a refresh rejoins automatically.
function setActiveCode(code) {
  store.activeCode = code || null;
  if (code) sessionStorage.setItem('pwf.room', code);
  else sessionStorage.removeItem('pwf.room');
}

// ---- Avatar emoji picker ----
function renderEmojiPicker() {
  if (!store.emoji) store.emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  const box = $('#emoji-pick');
  if (!box) return;
  box.innerHTML = EMOJIS.map(
    (e) => `<button type="button" class="emoji-opt ${e === store.emoji ? 'sel' : ''}" data-emoji="${e}">${e}</button>`
  ).join('');
}
function setEmoji(e) {
  store.emoji = e;
  localStorage.setItem('pwf.emoji', e);
  renderEmojiPicker();
}

// ---- Sound mute toggle ----
function updateMute() {
  const b = $('#btn-mute');
  if (b) b.textContent = sound.muted ? '🔇' : '🔊';
}

// ---- TV / presenter mode ----
function updateTv() {
  const b = $('#btn-tv');
  if (b) b.classList.toggle('on', document.body.classList.contains('presenter'));
}
function toggleTv() {
  const on = document.body.classList.toggle('presenter');
  localStorage.setItem('pwf.tv', on ? '1' : '0');
  updateTv();
  if (store.view) { unmountGame(); render(); } // re-render into/out of TV layout
}

// ---- Background music ----
function updateMusic() {
  const b = $('#btn-music');
  if (b) b.classList.toggle('off', !sound.musicOn);
}
function syncMusic() {
  const playing = ['screen-home', 'screen-lobby', 'screen-results']
    .some((id) => $('#' + id).classList.contains('active'));
  if (playing) sound.startMusic();
  else sound.stopMusic();
}

// ---- Players & standings panel ----
function renderStandings() {
  const list = $('#standings-list');
  const v = store.view;
  if (!list) return;
  if (!v || !v.players) { list.innerHTML = '<p class="subtle center">Join a game to see standings.</p>'; $('#btn-reset-standings').classList.add('hidden'); return; }
  const isHost = v.you && v.you.isHost;
  const ranked = [...v.players].sort((a, b) => b.sessionPoints - a.sessionPoints || b.wins - a.wins);
  list.innerHTML = ranked
    .map((p, i) => `<div class="stand-row">
      <span class="stand-rank">${i + 1}</span>
      <div class="avatar" style="background:${avatarColor(p.id)}">${avatarInner(p)}</div>
      <span class="stand-name">${escapeHtml(p.name)}${p.id === v.you.id ? ' (you)' : ''}${p.isHost ? ' 👑' : ''}</span>
      <span class="stand-wins">${p.wins ? '🏆'.repeat(Math.min(p.wins, 5)) : ''}</span>
      <span class="stand-pts">${p.sessionPoints}</span>
      ${isHost && p.id !== v.you.id ? `<button class="kick" data-kick="${p.id}" title="Remove">✕</button>` : ''}
    </div>`)
    .join('');
  $('#btn-reset-standings').classList.toggle('hidden', !isHost);
}
function toggleStandings(open) {
  store.standingsOpen = open != null ? open : !store.standingsOpen;
  $('#standings-overlay').classList.toggle('hidden', !store.standingsOpen);
  if (store.standingsOpen) renderStandings();
}

// ---- Career stats (per device) ----
function getCareer() {
  try { return JSON.parse(localStorage.getItem('pwf.stats')) || {}; } catch { return {}; }
}
function renderCareer() {
  const el = $('#career');
  if (!el) return;
  const s = getCareer();
  el.textContent = s.games ? `🏆 Your career: ${s.games} game${s.games === 1 ? '' : 's'} · ${s.wins || 0} win${s.wins === 1 ? '' : 's'} · ${s.points || 0} pts` : '';
}
function recordCareer(view, ranked, gamesPlayed = 1) {
  const s = getCareer();
  s.games = (s.games || 0) + gamesPlayed; // a playlist counts as all of its games
  s.points = (s.points || 0) + (view.you ? view.you.score : 0); // cumulative run total
  if (ranked[0] && view.you && ranked[0].id === view.you.id && ranked[0].score > 0) s.wins = (s.wins || 0) + 1;
  localStorage.setItem('pwf.stats', JSON.stringify(s));
}

// ---- Clean / filthy content toggle ----
function renderContentToggle(v, isHost) {
  const box = $('#content-toggle');
  if (!box) return;
  const clean = !!(v.config && v.config.clean);
  if (!isHost) {
    box.innerHTML = `<div class="content-state subtle">${clean ? '🧼 Clean mode' : '🔞 Filthy mode'}</div>`;
    return;
  }
  box.innerHTML = `<button class="btn small ${clean ? 'good' : 'accent'}" id="btn-content">${clean ? '🧼 Clean mode — tap for Filthy' : '🔞 Filthy mode — tap for Clean'}</button>`;
}

// ---- Custom content (host only) ----
function renderCustom(v, isHost, selected) {
  const area = $('#custom-area');
  if (!area) return;
  let type = null;
  if (isHost && selected) {
    if (selected.id === 'trivia' && v.config && (v.config.categories || []).includes('custom')) type = 'q';
    else if (selected.id === 'drawguess') type = 'w';
    else if (selected.id === 'quip') type = 'p';
  }
  if (type !== store.customUiType) {
    store.customUiType = type;
    if (type === 'q') {
      area.innerHTML = `<div class="custom-box">
        <div class="cats-label">Your questions <span class="subtle" id="custom-count"></span></div>
        <div class="subtle" style="margin-bottom:6px">Format (one per line): Question? | Correct | Wrong | Wrong | Wrong</div>
        <textarea id="custom-q" rows="5" placeholder="What is 2+2? | 4 | 3 | 5 | 22"></textarea>
        <button class="btn small" id="btn-save-q">Save questions</button>
      </div>`;
      const ta = $('#custom-q');
      if (ta) ta.value = store.draftQ || '';
    } else if (type === 'w') {
      area.innerHTML = `<div class="custom-box">
        <div class="cats-label">Custom words <span class="subtle">(optional)</span> <span class="subtle" id="custom-count"></span></div>
        <div class="subtle" style="margin-bottom:6px">Comma or line separated. Leave blank to use the built-in list.</div>
        <textarea id="custom-w" rows="3" placeholder="apple, rocket, your inside joke, ..."></textarea>
        <button class="btn small" id="btn-save-w">Save words</button>
      </div>`;
      const ta = $('#custom-w');
      if (ta) ta.value = store.draftW || '';
    } else if (type === 'p') {
      area.innerHTML = `<div class="custom-box">
        <div class="cats-label">Custom prompts <span class="subtle">(optional)</span> <span class="subtle" id="custom-count"></span></div>
        <div class="subtle" style="margin-bottom:6px">One prompt per line, e.g. "The worst gift to give your boss". Leave blank for built-in prompts.</div>
        <textarea id="custom-p" rows="4" placeholder="The worst thing to say at a wedding&#10;A terrible name for a boat"></textarea>
        <button class="btn small" id="btn-save-p">Save prompts</button>
      </div>`;
      const ta = $('#custom-p');
      if (ta) ta.value = store.draftP || '';
    } else {
      area.innerHTML = '';
    }
  }
  const countEl = $('#custom-count');
  if (countEl) {
    const n = type === 'q'
      ? (v.config && v.config.customQuestionCount) || 0
      : type === 'w'
        ? (v.config && v.config.customWordCount) || 0
        : (v.config && v.config.customPromptCount) || 0;
    countEl.textContent = `(${n} loaded)`;
  }
}

// Stable API object handed to game modules.
const gameApi = {
  socket,
  playerId: store.playerId,
  send: (action) => socket.emit('game:action', action),
  get view() { return store.view; },
  get game() { return store.view && store.view.game; },
  get you() { return store.view && store.view.you; },
  get players() { return (store.view && store.view.players) || []; },
};

// ---- Screens ----
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  syncMusic();
}

function render() {
  const v = store.view;
  if (!v || !v.you) { showScreen('home'); return; }
  if (v.phase === 'lobby') {
    unmountGame();
    renderLobby(v);
    showScreen('lobby');
  } else if (v.phase === 'playing') {
    renderGame(v);
    showScreen('game');
  } else if (v.phase === 'results') {
    unmountGame();
    renderResults(v);
    showScreen('results');
  }
}

// ---- Lobby ----
// A hostname that only resolves on the local machine or the local network —
// localhost, loopback, link-local, or a private LAN range. Anything else
// (a real domain or public IP) is reachable from the internet.
function isPrivateHost(h) {
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '' ||
    h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

function isLocalHost(h) {
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
}

function shareBaseFor(v) {
  if (v.public) return v.public; // internet tunnel — works for anyone, anywhere
  if (isLocalHost(location.hostname) && v.lan) return v.lan; // local: use the LAN address
  return location.origin;
}

// Will the copied link actually work for a friend anywhere on the internet?
// True when it's the tunnel URL, or when the page is already served from a
// public host (e.g. a hosted deploy) — false when it's a LAN/localhost address.
function shareLinkIsPublic(v) {
  if (v.public) return true;
  if (isLocalHost(location.hostname)) return false; // LAN fallback (or nothing)
  return !isPrivateHost(location.hostname);
}

function renderOnline(v) {
  const btn = $('#btn-online');
  const status = $('#online-status');
  const label = $('#qr-label');
  const isHost = v.you && v.you.isHost;
  if (v.public) {
    btn.classList.add('hidden');
    const isLoca = /loca\.lt/i.test(v.public);
    status.innerHTML = '🌍 Online — friends anywhere can join with the link or QR.' +
      (isLoca && v.publicIp ? `<br><span class="online-pw">If a reminder page appears, the password is <b>${v.publicIp}</b></span>` : '');
    status.className = 'online-status on';
    if (label) label.textContent = 'Scan to join (online)';
  } else if (v.publicStarting) {
    btn.classList.remove('hidden');
    btn.disabled = true;
    btn.textContent = 'Starting online link…';
    status.textContent = '';
    status.className = 'online-status';
    if (label) label.textContent = 'Scan to join';
  } else {
    btn.disabled = false;
    btn.textContent = '🌍 Play online';
    btn.classList.toggle('hidden', !isHost);
    status.textContent = v.publicError || (isHost ? 'On your Wi-Fi now. Tap to let friends join over the internet.' : '');
    status.className = v.publicError ? 'online-status err' : 'online-status';
    if (label) label.textContent = 'Scan to join';
  }
}

function renderQR(url) {
  const box = $('#qr-box');
  if (!box) return;
  if (typeof window.qrcode === 'undefined') { box.innerHTML = ''; return; }
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    box.innerHTML = qr.createImgTag(5, 8);
    const img = box.querySelector('img');
    if (img) { img.removeAttribute('width'); img.removeAttribute('height'); img.alt = 'Join QR'; }
  } catch {
    box.innerHTML = '';
  }
}

function renderLobby(v) {
  $('#lobby-code').textContent = v.code;
  store.shareLink = `${shareBaseFor(v)}/?code=${v.code}`;
  store.shareIsPublic = shareLinkIsPublic(v);
  renderQR(store.shareLink);
  renderOnline(v);

  // Most friends aren't on the same Wi-Fi, so the host's game should be reachable
  // over the internet by default. Auto-start the online tunnel once per room (if
  // it isn't already up / starting / errored) instead of waiting for a tap.
  // Skip it when the page is already served from a public host — a hosted deploy
  // needs no tunnel, and starting one would swap its clean URL for a worse one.
  const onPublicHost = !isPrivateHost(location.hostname);
  if (v.you && v.you.isHost && !onPublicHost && !v.public && !v.publicStarting && !v.publicError
      && store.autoOnlineRoom !== v.code) {
    store.autoOnlineRoom = v.code;
    socket.emit('tunnel:start');
  }
  if (store.prevPlayers && v.players.length > store.prevPlayers) sound.join();
  store.prevPlayers = v.players.length;
  $('#player-count').textContent = `(${v.players.length})`;

  const isHost = v.you.isHost;
  $('#player-list').innerHTML = v.players
    .map((p) => playerRow(p, v, isHost))
    .join('');

  renderContentToggle(v, isHost);

  // Tap games to queue them — one to play solo, several to play back-to-back as
  // a playlist with a combined score. The number badge shows the play order.
  const playlist = v.playlist || [];
  $('#catalog').innerHTML = v.catalog
    .map((g) => {
      const pos = playlist.indexOf(g.id);
      const inList = pos !== -1;
      const lockClass = isHost ? '' : 'locked';
      const badge = inList ? `<div class="order-badge">${pos + 1}</div>` : '';
      return `<button class="game-card ${inList ? 'selected' : ''} ${lockClass}" data-game="${g.id}" ${isHost ? '' : 'disabled'}>
        ${badge}
        <div class="emoji">${g.emoji}</div>
        <div class="gname">${escapeHtml(g.name)}</div>
        <div class="gdesc">${escapeHtml(g.description)}</div>
        <div class="players-needed">${g.minPlayers}–${g.maxPlayers} players</div>
      </button>`;
    })
    .join('');

  // The queued games (in order) — drives the tray, the pickers and start-gating.
  const queued = playlist.map((id) => v.catalog.find((g) => g.id === id)).filter(Boolean);
  const selected = queued[0] || null;

  // Playlist tray — only meaningful once 2+ games are queued.
  const tray = $('#playlist-tray');
  if (tray) {
    if (queued.length > 1) {
      tray.classList.remove('hidden');
      tray.innerHTML = `<div class="cats-label">Playlist <span class="subtle">(plays back-to-back · combined score)</span></div>
        <div class="pl-chips">${queued
          .map((g, i) => `<span class="pl-chip">${i + 1}. ${g.emoji} ${escapeHtml(g.name)}</span>`)
          .join('<span class="pl-arrow">→</span>')}</div>
        ${isHost ? '<button class="btn ghost small mt" id="btn-clear-playlist">Clear playlist</button>' : ''}`;
    } else {
      tray.classList.add('hidden');
      tray.innerHTML = '';
    }
  }

  // Category picker — shown if any queued game uses categories (Trivia).
  const catGame = queued.find((g) => g.categories);
  const picker = $('#cat-picker');
  if (catGame) {
    const clean = !!(v.config && v.config.clean);
    const cats = catGame.categories.filter((c) => !(clean && c.adult));
    const chosen = new Set((v.config && v.config.categories) || ['everything']);
    picker.innerHTML = `<div class="cats-label">Categories <span class="subtle">(pick one or more · Trivia)</span></div><div class="cats">${cats
      .map((c) => `<button class="cat-chip ${chosen.has(c.id) ? 'selected' : ''}" data-cat="${c.id}" ${isHost ? '' : 'disabled'}>${c.emoji} ${escapeHtml(c.name)}</button>`)
      .join('')}</div>`;
  } else {
    picker.innerHTML = '';
  }

  // Round-length picker — shown if any queued game uses round length.
  const lenGame = queued.find((g) => g.lengths);
  const lenPicker = $('#len-picker');
  if (lenGame) {
    const chosenLen = (v.config && v.config.length) || 15;
    lenPicker.innerHTML = `<div class="cats-label">Round length</div><div class="cats">${lenGame.lengths
      .map((l) => `<button class="cat-chip ${l.id === chosenLen ? 'selected' : ''}" data-len="${l.id}" ${isHost ? '' : 'disabled'}>${escapeHtml(l.name)} · ${l.id}</button>`)
      .join('')}</div>`;
  } else {
    lenPicker.innerHTML = '';
  }

  renderCustom(v, isHost, selected);

  const connected = v.players.filter((p) => p.connected).length;
  const cfgCats = (v.config && v.config.categories) || [];
  const triviaQueued = queued.some((g) => g.id === 'trivia');
  const needCustomQ = triviaQueued
    && cfgCats.length === 1 && cfgCats[0] === 'custom'
    && !(v.config.customQuestionCount > 0);
  const need = queued.length ? Math.max(...queued.map((g) => g.minPlayers || 1)) : 1;
  const shortGame = queued.find((g) => (g.minPlayers || 1) > connected);
  const startBtn = $('#btn-start');
  let hint = '';
  let canStart = false;
  if (!isHost) {
    hint = queued.length ? 'Waiting for the host to start…' : 'Waiting for the host to choose a game…';
  } else if (!queued.length) {
    hint = 'Tap a game above to begin (tap more than one to build a playlist).';
  } else if (connected < need && shortGame) {
    hint = `${shortGame.name} needs at least ${shortGame.minPlayers} players (you have ${connected}).`;
  } else if (needCustomQ) {
    hint = 'Add at least one custom question below, then tap Save.';
  } else if (queued.length > 1) {
    hint = `Ready! Tap start to play ${queued.length} games back-to-back.`;
    canStart = true;
  } else {
    hint = `Ready! Tap start to play ${selected.name}.`;
    canStart = true;
  }
  $('#lobby-hint').textContent = hint;
  startBtn.disabled = !canStart;
  startBtn.classList.toggle('hidden', !isHost);
  startBtn.textContent = queued.length > 1 ? `Start playlist (${queued.length} games) ▸` : 'Start game';
}

function playerRow(p, v, isHost) {
  const me = p.id === v.you.id;
  const canKick = isHost && !me && !p.isHost;
  return `<div class="player ${me ? 'me' : ''} ${p.connected ? '' : 'off'}">
    <div class="avatar" style="background:${avatarColor(p.id)}">${avatarInner(p)}</div>
    <div class="pname">${escapeHtml(p.name)}${me ? ' (you)' : ''}</div>
    ${p.isHost ? '<span class="tag">Host</span>' : ''}
    ${p.connected ? '' : '<span class="subtle">offline</span>'}
    ${canKick ? `<button class="kick" data-kick="${p.id}" title="Remove">✕</button>` : ''}
  </div>`;
}

// ---- Game delegation ----
function renderGame(v) {
  const mod = clientGames[v.gameId];
  const root = $('#game-root');
  if (!mod) { root.innerHTML = '<div class="card">Unknown game.</div>'; return; }
  if (store.mountedGameId !== v.gameId) {
    unmountGame();
    root.innerHTML = '';
    store.mountedGameId = v.gameId;
    if (mod.mount) mod.mount(root, gameApi);
  }
  if (mod.update) mod.update(v, gameApi);
}

function unmountGame() {
  if (store.mountedGameId) {
    const mod = clientGames[store.mountedGameId];
    if (mod && mod.unmount) {
      try { mod.unmount(); } catch (e) { /* noop */ }
    }
    store.mountedGameId = null;
    const root = $('#game-root');
    if (root) root.innerHTML = '';
  }
}

// ---- Results ----
let lastResultsKey = null;
function renderResults(v) {
  const ranked = [...v.players].sort((a, b) => b.score - a.score);
  const podiumOrder = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
  const cls = { 0: 'p2', 1: 'p1', 2: 'p3' };
  const medals = ['🥈', '🥇', '🥉'];
  $('#podium').innerHTML = podiumOrder
    .map((p, i) => `<div class="col ${cls[i]}">
        <div class="pn">${p.emoji ? p.emoji + ' ' : ''}${escapeHtml(p.name)}</div>
        <div class="bar">${medals[i]}</div>
        <div class="ps">${p.score} pts</div>
      </div>`)
    .join('');

  $('#result-list').innerHTML = ranked
    .map((p, i) => `<div class="player">
        <div class="avatar" style="background:${avatarColor(p.id)}">${avatarInner(p)}</div>
        <div class="pname">${i + 1}. ${escapeHtml(p.name)}${p.id === v.you.id ? ' (you)' : ''}</div>
        <div class="pscore">${p.score} pts</div>
      </div>`)
    .join('');

  const isHost = v.you.isHost;
  const session = v.session;
  const isPlaylist = !!(session && session.total > 1);
  const moreGames = !!(session && session.index < session.total - 1); // a next game is queued
  const winnerName = ranked[0] ? ranked[0].name : 'Someone';

  // Next-game button (host, mid-playlist). Advances without resetting scores.
  const nextBtn = $('#btn-next-game');
  nextBtn.classList.toggle('hidden', !(isHost && moreGames));
  if (isHost && moreGames) {
    nextBtn.textContent = `▸ Next: ${session.nextGameEmoji || ''} ${session.nextGameName} (game ${session.index + 2} of ${session.total})`;
  }

  // Replay restarts the whole playlist from scratch; relabel accordingly.
  const replayBtn = $('#btn-replay');
  replayBtn.classList.toggle('hidden', !isHost);
  replayBtn.textContent = isPlaylist ? '🔁 Replay whole playlist' : '🔁 Play again (same game)';

  $('#btn-again').classList.toggle('hidden', !isHost);

  const status = $('#results-status');
  if (status) {
    if (moreGames) {
      const prog = `Game ${session.index + 1} of ${session.total} done`;
      status.textContent = isHost
        ? `🏆 ${winnerName} leads! ${prog} — tap ▸ Next for ${session.nextGameName}. Scores carry over.`
        : `🏆 ${winnerName} leads! ${prog} — waiting for the host to start ${session.nextGameName}…`;
    } else if (isPlaylist) {
      status.textContent = isHost
        ? `🏆 ${winnerName} wins the playlist (${session.total} games)! Replay it, or adjust the settings.`
        : `🏆 ${winnerName} wins the ${session.total}-game playlist! Waiting for the host…`;
    } else {
      status.textContent = isHost
        ? `🏆 ${winnerName} wins! Replay the same game, or adjust the settings & pick a new one.`
        : `🏆 ${winnerName} wins! Waiting for the host to replay or pick a new game…`;
    }
  }

  const key = v.code + ':' + ranked.map((p) => p.id + p.score).join(',');
  if (key !== lastResultsKey) {
    lastResultsKey = key;
    // Only bank career stats once the run is over (a playlist shows results
    // between games too — recording each would inflate games/points).
    if (!moreGames) recordCareer(v, ranked, isPlaylist ? session.total : 1);
    confetti();
    sound.win();
  }
}

function roundRect(x, X, Y, w, h, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

function saveResultsImage() {
  const v = store.view;
  if (!v) return;
  const ranked = [...v.players].sort((a, b) => b.score - a.score);
  const W = 800;
  const H = 200 + ranked.length * 56;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#6a5cff');
  g.addColorStop(0.5, '#b14bff');
  g.addColorStop(1, '#ff5c8a');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  x.textAlign = 'center';
  x.fillStyle = '#fff';
  x.font = 'bold 46px Fredoka, system-ui, sans-serif';
  x.fillText('🫠 Gooping with Friends', W / 2, 76);
  x.font = '600 26px Fredoka, system-ui, sans-serif';
  x.fillText('Final Scores', W / 2, 116);
  const medals = ['🥇', '🥈', '🥉'];
  ranked.forEach((p, i) => {
    const y = 170 + i * 56;
    x.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(x, 60, y - 32, W - 120, 46, 14);
    x.fill();
    x.fillStyle = '#fff';
    x.font = '600 28px Fredoka, system-ui, sans-serif';
    x.textAlign = 'left';
    x.fillText(`${medals[i] || i + 1 + '.'}  ${p.emoji ? p.emoji + ' ' : ''}${p.name}`, 84, y);
    x.textAlign = 'right';
    x.fillText(`${p.score}`, W - 84, y);
  });
  c.toBlob((blob) => {
    if (!blob) return;
    const dl = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'gooping-results.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const file = new File([blob], 'gooping-results.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Gooping with Friends — results' }).catch(dl);
    } else {
      dl();
    }
  }, 'image/png');
  toast('Results image ready!');
}

// ---- Home actions ----
function getName() {
  return $('#name-input').value.trim().slice(0, 20);
}
function rememberName(name) {
  store.name = name;
  localStorage.setItem('pwf.name', name);
}
function homeError(msg) {
  $('#home-error').textContent = msg || '';
}

function createGame() {
  const name = getName();
  if (!name) { homeError('Enter your name first.'); $('#name-input').focus(); return; }
  const code = $('#create-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  rememberName(name);
  homeError('');
  socket.emit('room:create', { playerId: store.playerId, secret: store.secret, name, emoji: store.emoji, code }, (res) => {
    if (res && !res.ok) homeError(res.error || 'Could not create game.');
    else if (res && res.ok) setActiveCode(res.code);
  });
}

function joinGame() {
  const name = getName();
  const code = $('#join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name) { homeError('Enter your name first.'); $('#name-input').focus(); return; }
  if (code.length < 3 || code.length > 6) { homeError('Enter the invite code (3–6 characters).'); return; }
  rememberName(name);
  homeError('');
  socket.emit('room:join', { playerId: store.playerId, secret: store.secret, name, emoji: store.emoji, code }, (res) => {
    if (res && !res.ok) { homeError(res.error || 'Could not join.'); setActiveCode(null); }
    else if (res && res.ok) setActiveCode(res.code);
  });
}

function leaveGame() {
  socket.emit('room:leave');
  store.view = null;
  setActiveCode(null);
  unmountGame();
  showScreen('home');
}

// ---- Auto-update banner ----
// `window.updater` is injected by the desktop app's preload bridge (preload.cjs).
// In a plain browser there's nothing to update, so this no-ops gracefully.
function initUpdater() {
  const u = window.updater;
  if (!u) return;
  const banner = $('#update-banner');
  const text = $('#update-banner-text');
  const restartBtn = $('#update-restart');
  const dismissBtn = $('#update-dismiss');
  if (!banner || !text || !restartBtn || !dismissBtn) return;
  let pendingReady = false; // a downloaded update is waiting for an explicit restart
  const show = (msg, ready) => {
    text.textContent = msg;
    restartBtn.classList.toggle('hidden', !ready);
    restartBtn.disabled = !ready; // gate the action on state, not just CSS visibility
    banner.classList.toggle('ready', !!ready);
    banner.classList.remove('hidden');
  };
  u.onAvailable((info) => show(`Downloading update v${info.version}…`, false));
  u.onProgress((p) => {
    if (!pendingReady) show(`Downloading update… ${p.percent}%`, false);
  });
  u.onDownloaded((info) => { pendingReady = true; show(`Update v${info.version} is ready to install.`, true); });
  u.onError(() => {}); // never let an update hiccup interrupt the party
  restartBtn.addEventListener('click', () => u.restart());
  dismissBtn.addEventListener('click', () => banner.classList.add('hidden'));
  // If they dismiss a ready update, resurface it when they refocus the app so the
  // "Restart to update" affordance isn't lost for the rest of the session.
  window.addEventListener('focus', () => {
    if (pendingReady && banner.classList.contains('hidden')) show(text.textContent, true);
  });
}

// ---- Wire up DOM ----
function bind() {
  $('#name-input').value = store.name;
  renderEmojiPicker();
  updateMute();
  updateMusic();
  if (localStorage.getItem('pwf.tv') === '1') document.body.classList.add('presenter');
  updateTv();
  document.addEventListener('click', () => { sound.unlock(); syncMusic(); }, { once: true });

  $('#emoji-pick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-emoji]');
    if (b) { setEmoji(b.dataset.emoji); sound.select(); }
  });
  $('#btn-mute').addEventListener('click', () => { sound.toggle(); updateMute(); });
  $('#btn-music').addEventListener('click', () => { sound.toggleMusic(); updateMusic(); syncMusic(); });
  $('#btn-tv').addEventListener('click', toggleTv);
  $('#btn-players').addEventListener('click', () => toggleStandings());
  $('#btn-close-standings').addEventListener('click', () => toggleStandings(false));
  $('#standings-overlay').addEventListener('click', (e) => { if (e.target.id === 'standings-overlay') toggleStandings(false); });
  $('#standings-list').addEventListener('click', (e) => {
    const k = e.target.closest('[data-kick]');
    if (k) socket.emit('room:kick', k.dataset.kick);
  });
  $('#btn-reset-standings').addEventListener('click', () => socket.emit('room:resetStandings'));
  renderCareer();
  initUpdater();
  $('#content-toggle').addEventListener('click', (e) => {
    if (e.target.closest('#btn-content')) {
      const clean = !!(store.view && store.view.config && store.view.config.clean);
      socket.emit('game:config', { clean: !clean });
      sound.select();
    }
  });

  $('#custom-area').addEventListener('input', (e) => {
    if (e.target.id === 'custom-q') store.draftQ = e.target.value;
    if (e.target.id === 'custom-w') store.draftW = e.target.value;
    if (e.target.id === 'custom-p') store.draftP = e.target.value;
  });
  $('#custom-area').addEventListener('click', (e) => {
    if (e.target.id === 'btn-save-q') { socket.emit('game:config', { customQuestionsText: store.draftQ || '' }); sound.select(); toast('Questions saved'); }
    if (e.target.id === 'btn-save-w') { socket.emit('game:config', { customWordsText: store.draftW || '' }); sound.select(); toast('Words saved'); }
    if (e.target.id === 'btn-save-p') { socket.emit('game:config', { customPromptsText: store.draftP || '' }); sound.select(); toast('Prompts saved'); }
  });

  $('#btn-create').addEventListener('click', createGame);
  $('#btn-join').addEventListener('click', joinGame);
  $('#join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  $('#create-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
  $('#name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') createGame(); });

  $('#btn-copy-code').addEventListener('click', () => copy(store.activeCode || ''));
  $('#btn-copy-link').addEventListener('click', () => {
    const link = store.shareLink || `${location.origin}/?code=${store.activeCode || ''}`;
    // If the copied link isn't internet-reachable, it's a LAN-only link — a
    // friend who isn't on your Wi-Fi will get "site can't be reached". Say so
    // instead of silently handing out a dead link. The remedy differs by role
    // and by whether the online link is starting, has failed, or hasn't begun.
    const v = store.view;
    const isHost = !!(v && v.you && v.you.isHost);
    let msg;
    if (store.shareIsPublic) {
      msg = 'Invite link copied — works anywhere!';
    } else if (v && v.publicStarting) {
      msg = 'Copied a Wi-Fi-only link. Wait for “🌍 Online”, then copy again for a link friends can use over the internet.';
    } else if (v && v.publicError) {
      msg = isHost
        ? 'Copied a Wi-Fi-only link. The online link failed — tap “🌍 Play online” to try again.'
        : 'Copied a Wi-Fi-only link — only works for friends on this Wi-Fi.';
    } else {
      msg = isHost
        ? 'Copied a Wi-Fi-only link. Tap “🌍 Play online” first for a link friends can use anywhere.'
        : 'Copied a Wi-Fi-only link — only works for friends on this Wi-Fi.';
    }
    copy(link, msg);
  });

  $('#catalog').addEventListener('click', (e) => {
    const card = e.target.closest('[data-game]');
    if (card && !card.disabled) { socket.emit('game:select', card.dataset.game); sound.select(); }
  });
  // "Clear playlist" lives inside the (re-rendered) tray — toggle every queued game off.
  $('#playlist-tray').addEventListener('click', (e) => {
    if (!e.target.closest('#btn-clear-playlist')) return;
    const list = (store.view && store.view.playlist) || [];
    list.forEach((id) => socket.emit('game:select', id));
    sound.select();
  });
  $('#cat-picker').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip || chip.disabled) return;
    const id = chip.dataset.cat;
    const cur = (store.view && store.view.config && store.view.config.categories) || ['everything'];
    let next;
    if (id === 'everything') next = ['everything']; // "the whole mix" is exclusive
    else if (cur.includes('everything')) next = [id]; // first specific pick drops the mix
    else if (cur.includes(id)) next = cur.filter((c) => c !== id); // toggle off
    else next = cur.concat(id); // add to the mix
    if (!next.length) next = ['everything'];
    socket.emit('game:config', { categories: next });
    sound.select();
  });
  $('#len-picker').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-len]');
    if (chip && !chip.disabled) socket.emit('game:config', { length: Number(chip.dataset.len) });
  });
  $('#player-list').addEventListener('click', (e) => {
    const k = e.target.closest('[data-kick]');
    if (k) socket.emit('room:kick', k.dataset.kick);
  });

  $('#btn-openlink').addEventListener('click', () => {
    const url = $('#join-link').value.trim();
    if (/^https?:\/\//i.test(url)) location.href = url;
    else if (url) homeError('Paste the full https:// link your friend sent.');
    else homeError('Paste a game link first.');
  });
  $('#btn-online').addEventListener('click', () => socket.emit('tunnel:start'));
  $('#btn-start').addEventListener('click', () => socket.emit('game:start'));
  $('#btn-leave').addEventListener('click', leaveGame);
  $('#btn-again').addEventListener('click', () => socket.emit('game:lobby'));
  $('#btn-replay').addEventListener('click', () => socket.emit('game:start'));
  $('#btn-next-game').addEventListener('click', () => { socket.emit('game:next'); sound.select(); });
  $('#btn-save-img').addEventListener('click', saveResultsImage);
  $('#btn-results-leave').addEventListener('click', leaveGame);
}

async function copy(text, msg = 'Copied!') {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast(text);
  }
}

// ---- Socket lifecycle ----
socket.on('state', (view) => {
  store.view = view;
  setActiveCode(view.code);
  render();
  if (store.standingsOpen) renderStandings();
});

socket.on('kicked', () => {
  store.view = null;
  setActiveCode(null);
  unmountGame();
  showScreen('home');
  toast('You were removed from the game.');
});

socket.on('connect', () => {
  $('#connlost').classList.add('hidden');
  // Re-bind this fresh socket to our room after a reconnect or page refresh.
  if (store.activeCode && store.name) {
    socket.emit('room:join', { playerId: store.playerId, secret: store.secret, name: store.name, emoji: store.emoji, code: store.activeCode }, (res) => {
      if (res && !res.ok) setActiveCode(null); // room is gone — fall back to home
    });
  }
});

socket.on('disconnect', () => {
  $('#connlost').classList.remove('hidden');
});

// If this page was opened from a shared invite link in a plain browser, offer to
// reopen it in the installed desktop app (via the gooping:// protocol). We skip
// this inside the app itself and on phones, where there's no desktop app to open.
function maybeOfferApp(inviteUrl) {
  const ua = navigator.userAgent || '';
  if (/electron/i.test(ua)) return;                  // already running in the app
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) return;  // no desktop app on phones
  const banner = $('#app-banner');
  if (!banner) return;
  const appLink = 'gooping://join?u=' + encodeURIComponent(inviteUrl);
  banner.classList.remove('hidden');
  // One tap launches the app if it's registered the link, and harmlessly does
  // nothing if it isn't — meanwhile the game keeps working in the browser below.
  $('#ab-open').addEventListener('click', () => { location.href = appLink; });
  $('#ab-browser').addEventListener('click', () => banner.classList.add('hidden'));
}

// Show the app version on the home screen (and reflect updates if the desktop
// app's preload bridge is present). Falls back silently if the endpoint is down.
function initVersion() {
  const el = $('#app-version');
  if (!el) return;
  fetch('/api/version')
    .then((r) => r.json())
    .then((d) => { if (d && d.version) el.textContent = 'v' + d.version + (window.updater ? ' · auto-updates on launch' : ''); })
    .catch(() => {});
}

// ---- Init ----
bind();
initVersion();
(function autojoin() {
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (code) {
    const inviteUrl = location.href; // capture before we strip ?code from the bar
    $('#join-code').value = code;
    history.replaceState(null, '', location.pathname);
    maybeOfferApp(inviteUrl);
    if (store.name) { setTimeout(joinGame, 150); }
    else $('#name-input').focus();
  }
})();
