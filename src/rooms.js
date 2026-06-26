import { makeCode } from './util.js';
import { games, getGame } from './games/index.js';
import { startTunnel } from './tunnel.js';

const MAX_PLAYERS = 16;
const EMPTY_ROOM_TTL = 1000 * 60 * 10; // delete abandoned rooms after 10 min

// Parse host-provided custom trivia. One per line:
//   Question? | Correct answer | Wrong | Wrong | Wrong
function parseCustomQuestions(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const parts = raw.split('|').map((s) => s.trim()).filter((s, i) => s.length > 0 || i > 0);
    if (parts.length < 5) continue; // need question + 4 options
    const q = parts[0].slice(0, 200);
    const options = parts.slice(1, 5).map((o) => o.slice(0, 60));
    if (!q || options.some((o) => !o)) continue;
    out.push({ q, options, answer: 0 }); // correct first; shuffled at game time
    if (out.length >= 200) break;
  }
  return out;
}

function parseCustomWords(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/[\n,]/)) {
    const w = raw.trim().slice(0, 40);
    if (!w || seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
    if (out.length >= 300) break;
  }
  return out;
}

// One Quip prompt per line.
function parseCustomPrompts(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const p = raw.trim().slice(0, 120);
    if (p) out.push(p);
    if (out.length >= 150) break;
  }
  return out;
}

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> room
    this.sockets = new Map(); // socketId -> { code, playerId }
    this.lanUrl = null; // set by the server once it knows its address
    this.port = null; // set by the server
    this.publicUrl = null; // internet tunnel URL once started
    this.publicIp = null; // host's public IP (localtunnel reminder password)
    this.publicStarting = false;
    this.publicError = null;
  }

  // Start a public internet tunnel (host-triggered). Server-wide: one tunnel
  // exposes every room, so the public URL works for all invite codes.
  async startPublic() {
    if (this.publicUrl || this.publicStarting || !this.port) return;
    this.publicStarting = true;
    this.publicError = null;
    this.broadcastAll();
    try {
      this.publicUrl = await startTunnel(this.port);
      // Fetch the host's public IP — localtunnel uses it as the visitor "password".
      try {
        const res = await fetch('https://api.ipify.org');
        this.publicIp = (await res.text()).trim();
      } catch { /* non-fatal */ }
    } catch (err) {
      console.error('tunnel failed', err);
      this.publicError = 'Could not start the online link. Try again.';
    } finally {
      this.publicStarting = false;
      this.broadcastAll();
    }
  }

  broadcastAll() {
    for (const room of this.rooms.values()) this.broadcast(room);
  }

  // ---- lookup helpers -------------------------------------------------

  getRoom(code) {
    return this.rooms.get(String(code || '').toUpperCase());
  }

  roomOfSocket(socket) {
    const ref = this.sockets.get(socket.id);
    if (!ref) return null;
    return this.getRoom(ref.code);
  }

  // ---- room lifecycle -------------------------------------------------

  createRoom(socket, { playerId, name, emoji, code: desiredRaw }) {
    let code;
    const desired = String(desiredRaw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (desired) {
      if (desired.length < 3 || desired.length > 6) {
        return { error: 'Custom code must be 3–6 letters or numbers.' };
      }
      if (this.rooms.has(desired)) {
        return { error: 'That code is already taken — try another.' };
      }
      code = desired;
    } else {
      do {
        code = makeCode(4);
      } while (this.rooms.has(code));
    }

    const room = {
      code,
      hostId: playerId,
      phase: 'lobby',
      gameId: null,
      config: { category: 'everything', length: 15, clean: false, customQuestions: [], customWords: [], customPrompts: [] },
      players: new Map(),
      game: null,
      timers: new Set(),
      deleteTimer: null,
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    this.addPlayer(room, socket, playerId, name, emoji);
    this.broadcast(room);
    return { room };
  }

  joinRoom(socket, { playerId, name, emoji, code }) {
    const room = this.getRoom(code);
    if (!room) return { error: 'No game found with that code.' };

    const existing = room.players.get(playerId);
    if (!existing) {
      const connectedCount = [...room.players.values()].filter((p) => p.connected).length;
      if (connectedCount >= MAX_PLAYERS) return { error: 'This game is full.' };
    }

    this.addPlayer(room, socket, playerId, name, emoji);
    this.broadcast(room);
    return { room };
  }

  addPlayer(room, socket, playerId, name, emoji) {
    if (room.deleteTimer) {
      clearTimeout(room.deleteTimer);
      room.deleteTimer = null;
    }
    let player = room.players.get(playerId);
    const cleanName = String(name || '').trim().slice(0, 20) || 'Player';
    const cleanEmoji = typeof emoji === 'string' ? emoji.trim().slice(0, 8) : '';
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      if (cleanName) player.name = cleanName;
      if (cleanEmoji) player.emoji = cleanEmoji;
    } else {
      player = {
        id: playerId,
        name: cleanName,
        emoji: cleanEmoji,
        socketId: socket.id,
        connected: true,
        score: 0,
        sessionPoints: 0, // accumulates across games this lobby session
        wins: 0,
        joinedAt: Date.now(),
      };
      room.players.set(playerId, player);
    }
    // First player in an empty room becomes host.
    if (![...room.players.values()].some((p) => p.id === room.hostId)) {
      room.hostId = playerId;
    }
    this.sockets.set(socket.id, { code: room.code, playerId });
    socket.join(room.code);
    return player;
  }

  handleDisconnect(socket) {
    const ref = this.sockets.get(socket.id);
    if (!ref) return;
    this.sockets.delete(socket.id);
    const room = this.getRoom(ref.code);
    if (!room) return;
    const player = room.players.get(ref.playerId);
    if (player && player.socketId === socket.id) {
      player.connected = false;
    }
    // Migrate host if the host dropped and someone else is still connected.
    if (room.hostId === ref.playerId) {
      const next = [...room.players.values()].find((p) => p.connected);
      if (next) room.hostId = next.id;
    }
    // If nobody is connected, schedule cleanup.
    const anyConnected = [...room.players.values()].some((p) => p.connected);
    if (!anyConnected) {
      this.clearTimers(room);
      room.deleteTimer = setTimeout(() => this.rooms.delete(room.code), EMPTY_ROOM_TTL);
    }
    this.broadcast(room);
  }

  leaveRoom(socket) {
    const ref = this.sockets.get(socket.id);
    if (!ref) return;
    const room = this.getRoom(ref.code);
    this.sockets.delete(socket.id);
    socket.leave(ref.code);
    if (!room) return;
    room.players.delete(ref.playerId);
    if (room.hostId === ref.playerId) {
      const next = [...room.players.values()].find((p) => p.connected);
      room.hostId = next ? next.id : null;
    }
    if (room.players.size === 0) {
      this.clearTimers(room);
      this.rooms.delete(room.code);
      return;
    }
    this.broadcast(room);
  }

  // ---- host / game controls ------------------------------------------

  isHost(room, playerId) {
    return room && room.hostId === playerId;
  }

  selectGame(socket, gameId) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    if (room.phase !== 'lobby') return;
    room.gameId = getGame(gameId) ? gameId : null;
    if (room.gameId === 'crazy') room.config.length = 30; // the "30 round mode"
    this.broadcast(room);
  }

  setConfig(socket, config) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    if (room.phase !== 'lobby') return;
    if (config && typeof config.category === 'string') {
      room.config.category = config.category.slice(0, 40);
    }
    if (config && config.length != null && [3, 5, 8, 15, 30].includes(Number(config.length))) {
      room.config.length = Number(config.length);
    }
    if (config && typeof config.clean === 'boolean') {
      room.config.clean = config.clean;
    }
    if (config && typeof config.customQuestionsText === 'string') {
      room.config.customQuestions = parseCustomQuestions(config.customQuestionsText);
    }
    if (config && typeof config.customWordsText === 'string') {
      room.config.customWords = parseCustomWords(config.customWordsText);
    }
    if (config && typeof config.customPromptsText === 'string') {
      room.config.customPrompts = parseCustomPrompts(config.customPromptsText);
    }
    this.broadcast(room);
  }

  startGame(socket) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    const game = getGame(room.gameId);
    if (!game) return;
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (connected.length < (game.minPlayers || 1)) return;

    this.clearTimers(room);
    room.phase = 'playing';
    for (const p of room.players.values()) p.score = 0;
    game.init(room, this.ctx(room));
    this.broadcast(room);
  }

  backToLobby(socket) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    this.clearTimers(room);
    room.phase = 'lobby';
    room.game = null;
    this.broadcast(room);
  }

  gameAction(socket, action) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || room.phase !== 'playing') return;
    const game = getGame(room.gameId);
    if (!game || typeof game.action !== 'function') return;
    game.action(room, ref.playerId, action || {}, this.ctx(room));
  }

  setName(socket, name) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref) return;
    const player = room.players.get(ref.playerId);
    if (!player) return;
    player.name = String(name || '').trim().slice(0, 20) || player.name;
    this.broadcast(room);
  }

  kick(socket, targetId) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    if (targetId === room.hostId) return;
    const target = room.players.get(targetId);
    if (!target) return;
    const targetSocket = this.io.sockets.sockets.get(target.socketId);
    room.players.delete(targetId);
    if (targetSocket) {
      targetSocket.emit('kicked');
      targetSocket.leave(room.code);
      this.sockets.delete(targetSocket.id);
    }
    this.broadcast(room);
  }

  // Add a finished game's scores into the running session standings.
  tallySession(room) {
    const players = [...room.players.values()];
    if (!players.length) return;
    let top = -Infinity;
    for (const p of players) {
      p.sessionPoints = (p.sessionPoints || 0) + (p.score || 0);
      if ((p.score || 0) > top) top = p.score || 0;
    }
    if (top > 0) for (const p of players) if ((p.score || 0) === top) p.wins = (p.wins || 0) + 1;
  }

  resetStandings(socket) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    for (const p of room.players.values()) { p.sessionPoints = 0; p.wins = 0; }
    this.broadcast(room);
  }

  // ---- timers ---------------------------------------------------------

  ctx(room) {
    return {
      io: this.io,
      room,
      broadcast: () => this.broadcast(room),
      after: (ms, fn) => this.after(room, ms, fn),
      clearTimers: () => this.clearTimers(room),
      end: () => {
        this.clearTimers(room);
        this.tallySession(room);
        room.phase = 'results';
        this.broadcast(room);
      },
      emitToPlayer: (pid, event, data) => {
        const p = room.players.get(pid);
        if (p && p.connected) this.io.to(p.socketId).emit(event, data);
      },
      emitToRoom: (event, data) => this.io.to(room.code).emit(event, data),
      connectedPlayers: () => [...room.players.values()].filter((p) => p.connected),
    };
  }

  after(room, ms, fn) {
    const handle = setTimeout(() => {
      room.timers.delete(handle);
      try {
        fn();
      } catch (err) {
        console.error('timer error', err);
      }
    }, ms);
    room.timers.add(handle);
    return handle;
  }

  clearTimers(room) {
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
  }

  // ---- state broadcast ------------------------------------------------

  publicPlayers(room) {
    return [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      emoji: p.emoji || '',
      score: p.score,
      sessionPoints: p.sessionPoints || 0,
      wins: p.wins || 0,
      connected: p.connected,
      isHost: p.id === room.hostId,
    }));
  }

  viewFor(room, playerId) {
    const me = room.players.get(playerId);
    const game = getGame(room.gameId);
    const view = {
      code: room.code,
      phase: room.phase,
      gameId: room.gameId,
      hostId: room.hostId,
      // Sanitized config — never ship the custom questions (they contain answers).
      config: {
        category: room.config.category,
        length: room.config.length,
        clean: room.config.clean,
        customQuestionCount: room.config.customQuestions.length,
        customWordCount: room.config.customWords.length,
        customPromptCount: room.config.customPrompts.length,
      },
      lan: this.lanUrl,
      public: this.publicUrl,
      publicIp: this.publicIp,
      publicStarting: this.publicStarting,
      publicError: this.publicError,
      you: me
        ? { id: me.id, name: me.name, emoji: me.emoji || '', score: me.score, isHost: me.id === room.hostId }
        : null,
      players: this.publicPlayers(room),
      catalog: games.map((g) => ({
        id: g.id,
        name: g.name,
        emoji: g.emoji,
        description: g.description,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
        categories: g.categories || null,
        lengths: g.lengths || null,
      })),
    };
    if (game && room.phase !== 'lobby' && typeof game.view === 'function') {
      view.game = game.view(room, playerId);
    }
    return view;
  }

  broadcast(room) {
    if (!room) return;
    for (const p of room.players.values()) {
      if (!p.connected) continue;
      this.io.to(p.socketId).emit('state', this.viewFor(room, p.id));
    }
  }
}
