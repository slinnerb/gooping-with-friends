import { makeCode, makeSecret } from './util.js';
import { games, getGame } from './games/index.js';
import { startTunnel } from './tunnel.js';

const MAX_PLAYERS = 16;
const EMPTY_ROOM_TTL = 1000 * 60 * 10; // delete abandoned rooms after 10 min
const MAX_ROOMS = 5000; // backstop against room-creation abuse (the host can be internet-facing)
const KICK_COOLDOWN = 1000 * 60 * 2; // a kicked player can't rejoin for 2 minutes

// Avatars must be one of the picker emojis — never trust arbitrary client strings
// (an unescaped emoji is rendered into innerHTML on the client, so this is a guard).
const ALLOWED_EMOJI = new Set([
  '🤪', '😈', '💀', '🔥', '👽', '🤡', '🦄', '🐸', '🐙', '🦖', '🍑', '🍆', '🌮', '🍕',
  '🤖', '👹', '🦊', '🐼', '🐧', '🫠', '💩', '👻', '🎃', '🐝',
]);
function cleanEmojiOf(emoji) {
  return typeof emoji === 'string' && ALLOWED_EMOJI.has(emoji) ? emoji : '';
}

// Sanitize a host-chosen list of trivia category ids. Keeps it a small, deduped
// array of short strings; 'everything' is exclusive (the whole mix), so if it's
// present we collapse to just that. Never trust the client to send something sane.
function normalizeCategories(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const id = raw.slice(0, 40);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= 30) break;
  }
  if (!out.length || out.includes('everything')) return ['everything'];
  return out;
}

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
    if (!/[a-z0-9]/i.test(w)) continue; // must have a guessable alphanumeric core
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
      this.publicUrl = await startTunnel(this.port, () => this.onTunnelDown());
      this.tunnelRetries = 0; // a fresh URL resets the recovery budget
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

  // The tunnel died after being live (network blip, cloudflared crash, sleep).
  // Clear the now-dead URL so we stop advertising it, tell everyone, and try to
  // bring a new one up a bounded number of times before asking the host to retry.
  onTunnelDown() {
    if (!this.publicUrl && !this.publicStarting) return; // already handled
    this.publicUrl = null;
    this.publicIp = null;
    this.tunnelRetries = this.tunnelRetries || 0;
    if (this.tunnelRetries >= 3) {
      this.publicError = 'Online link dropped. Tap “🌍 Play online” to reconnect.';
      this.broadcastAll();
      return;
    }
    this.tunnelRetries += 1;
    this.publicError = 'Online link dropped — reconnecting…';
    this.broadcastAll();
    setTimeout(() => {
      if (!this.publicUrl && !this.publicStarting && this.port) this.startPublic();
    }, 1500 * this.tunnelRetries);
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

  // Detach this socket from whatever room it currently holds (if any), cleaning
  // up the old membership. Called before create/join a DIFFERENT room so one
  // socket can't accumulate memberships across many rooms (a MAX_ROOMS abuse
  // lever). Only removes the player if this socket is still their current one,
  // so a reconnect on a new socket isn't clobbered.
  detachFromCurrentRoom(socket) {
    const ref = this.sockets.get(socket.id);
    if (!ref) return;
    this.sockets.delete(socket.id);
    socket.leave(ref.code);
    const room = this.getRoom(ref.code);
    if (!room) return;
    const player = room.players.get(ref.playerId);
    if (!player || player.socketId !== socket.id) return;
    room.players.delete(ref.playerId);
    if (room.replayVotes) room.replayVotes.delete(ref.playerId);
    if (room.hostId === ref.playerId) {
      const next = [...room.players.values()].find((p) => p.connected);
      room.hostId = next ? next.id : null;
    }
    this.maybeOnLeave(room, ref.playerId);
    if (room.players.size === 0) {
      this.clearTimers(room);
      this.rooms.delete(room.code);
      return;
    }
    const anyConnected = [...room.players.values()].some((p) => p.connected);
    if (!anyConnected && !room.deleteTimer) {
      room.deleteTimer = setTimeout(() => {
        this.clearTimers(room);
        this.rooms.delete(room.code);
      }, EMPTY_ROOM_TTL);
    }
    this.broadcast(room);
  }

  createRoom(socket, data) {
    const playerId = String((data && data.playerId) || '');
    if (!playerId) return { error: 'Missing player id.' };
    if (this.rooms.size >= MAX_ROOMS) return { error: 'Server is busy — try again shortly.' };
    this.detachFromCurrentRoom(socket); // creating means leaving any current room
    let code;
    const desired = String((data && data.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (desired) {
      if (desired.length < 3 || desired.length > 6) {
        return { error: 'Custom code must be 3–6 letters or numbers.' };
      }
      if (this.rooms.has(desired)) {
        return { error: 'That code is already taken — try another.' };
      }
      code = desired;
    } else {
      let tries = 0;
      do {
        code = makeCode(tries < 12 ? 4 : 5);
        tries += 1;
      } while (this.rooms.has(code));
    }

    const room = {
      code,
      hostId: playerId,
      phase: 'lobby',
      gameId: null,
      playlist: [],   // ordered gameIds the host has queued up to play back-to-back
      session: null,  // active run: { games:[...], index } — set on start, cleared in lobby
      replayVotes: new Map(), // on the final results screen: playerId -> 'same' | 'different'
      config: { categories: ['everything'], length: 15, clean: false, customQuestions: [], customWords: [], customPrompts: [] },
      players: new Map(),
      game: null,
      timers: new Set(),
      deleteTimer: null,
      createdAt: Date.now(),
    };
    this.rooms.set(code, room);
    const res = this.addPlayer(room, socket, data);
    if (res.error) {
      this.rooms.delete(code);
      return res;
    }
    this.broadcast(room);
    return { room };
  }

  joinRoom(socket, data) {
    const room = this.getRoom(data && data.code);
    if (!room) return { error: 'No game found with that code.' };

    // If this socket is bound to a DIFFERENT room, leave it first (a reconnect
    // to the same room is handled by addPlayer's re-attach path, so skip then).
    const cur = this.sockets.get(socket.id);
    if (cur && cur.code !== room.code) this.detachFromCurrentRoom(socket);

    const playerId = String((data && data.playerId) || '');
    if (room.kicks) {
      const until = room.kicks.get(playerId);
      if (until && until > Date.now()) return { error: 'You were removed from this game.' };
    }
    const existing = room.players.get(playerId);
    if (!existing) {
      const connectedCount = [...room.players.values()].filter((p) => p.connected).length;
      if (connectedCount >= MAX_PLAYERS) return { error: 'This game is full.' };
    }

    const res = this.addPlayer(room, socket, data);
    if (res.error) return res;
    this.broadcast(room);
    return { room };
  }

  // Adds or re-attaches a player. Identity is authenticated by a per-player
  // secret: once a playerId has a bound secret, every later (re)join must present
  // it — so a known/broadcast playerId can't be used to impersonate (host takeover).
  addPlayer(room, socket, data) {
    const playerId = String((data && data.playerId) || '');
    if (!playerId) return { error: 'Missing player id.' };
    if (room.deleteTimer) {
      clearTimeout(room.deleteTimer);
      room.deleteTimer = null;
    }
    let player = room.players.get(playerId);
    const cleanName = String((data && data.name) || '').trim().slice(0, 20) || 'Player';
    const cleanEmoji = cleanEmojiOf(data && data.emoji);
    const secret = String((data && data.secret) || '').slice(0, 80);

    if (player) {
      if (player.secret && secret !== player.secret) {
        return { error: 'That player is already in this game — clear the page or pick a fresh start.' };
      }
      if (!player.secret && secret) player.secret = secret;
      player.socketId = socket.id;
      player.connected = true;
      if (cleanName) player.name = cleanName;
      if (cleanEmoji) player.emoji = cleanEmoji;
    } else {
      player = {
        id: playerId,
        name: cleanName,
        emoji: cleanEmoji,
        secret: secret || makeSecret(),
        socketId: socket.id,
        connected: true,
        score: 0,
        sessionPoints: 0, // accumulates across games this lobby session
        wins: 0,
        joinedAt: Date.now(),
      };
      room.players.set(playerId, player);
    }
    // First player in an empty room becomes host (only count connected holders).
    if (![...room.players.values()].some((p) => p.id === room.hostId && p.connected)) {
      room.hostId = playerId;
    }
    this.sockets.set(socket.id, { code: room.code, playerId });
    socket.join(room.code);
    return { player };
  }

  handleDisconnect(socket) {
    const ref = this.sockets.get(socket.id);
    if (!ref) return;
    this.sockets.delete(socket.id);
    const room = this.getRoom(ref.code);
    if (!room) return;
    const player = room.players.get(ref.playerId);
    // Only act if this is the player's *current* socket (ignore a replaced/stale one).
    const left = !!(player && player.socketId === socket.id);
    if (left) player.connected = false;

    // Migrate host if the host dropped and someone else is still connected.
    if (left && room.hostId === ref.playerId) {
      const next = [...room.players.values()].find((p) => p.connected);
      if (next) room.hostId = next.id;
    }
    // Let the active game advance if this departure satisfied its round.
    if (left) this.maybeOnLeave(room, ref.playerId);
    // On the results screen a departure shrinks the electorate — a pending
    // play-again vote may now have reached a majority.
    if (left && room.phase === 'results') this.resolveReplay(room);

    // If nobody is connected, schedule cleanup — but keep game timers running so a
    // quick reconnect resumes instead of freezing; clear them only at delete time.
    const anyConnected = [...room.players.values()].some((p) => p.connected);
    if (!anyConnected && !room.deleteTimer) {
      room.deleteTimer = setTimeout(() => {
        this.clearTimers(room);
        this.rooms.delete(room.code);
      }, EMPTY_ROOM_TTL);
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
    this.maybeOnLeave(room, ref.playerId);
    // If the only players left are already-disconnected ghosts, arm the same
    // cleanup handleDisconnect uses — otherwise an explicit Leave with a ghost
    // present would leak the room forever (its future disconnect early-returns).
    const anyConnected = [...room.players.values()].some((p) => p.connected);
    if (!anyConnected && !room.deleteTimer) {
      room.deleteTimer = setTimeout(() => {
        this.clearTimers(room);
        this.rooms.delete(room.code);
      }, EMPTY_ROOM_TTL);
    }
    this.broadcast(room);
  }

  // If a game is in progress, give it a chance to advance when a player departs
  // (so a missing answerer/voter/drawer/reader doesn't stall the round on a timer).
  maybeOnLeave(room, playerId) {
    if (!room || room.phase !== 'playing') return;
    const game = getGame(room.gameId);
    if (game && typeof game.onLeave === 'function') {
      try {
        game.onLeave(room, playerId, this.ctx(room));
      } catch (err) {
        console.error('onLeave error', err);
      }
    }
  }

  // ---- host / game controls ------------------------------------------

  isHost(room, playerId) {
    return room && room.hostId === playerId;
  }

  // Toggle a game in the host's playlist. One game = play just that (today's
  // behavior); several = play them back-to-back as one session with a combined
  // (cumulative) leaderboard. gameId stays = playlist[0] so the lobby's config
  // pickers and single-game start logic keep working.
  selectGame(socket, gameId) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    if (room.phase !== 'lobby') return;
    if (!getGame(gameId)) return;
    const i = room.playlist.indexOf(gameId);
    if (i === -1) {
      if (room.playlist.length >= 8) return; // cap the queue
      room.playlist.push(gameId);
    } else {
      room.playlist.splice(i, 1);
    }
    room.gameId = room.playlist[0] || null;
    this.broadcast(room);
  }

  setConfig(socket, config) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    if (room.phase !== 'lobby') return;
    if (config && Array.isArray(config.categories)) {
      room.config.categories = normalizeCategories(config.categories);
    } else if (config && typeof config.category === 'string') {
      room.config.categories = normalizeCategories([config.category]);
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
    if (!room || !ref || !this.isHost(room, ref.playerId)) return { ok: false, error: 'Only the host can start the game.' };
    // The playlist is the source of truth; fall back to the single gameId.
    const list = room.playlist.length ? room.playlist.slice() : (room.gameId ? [room.gameId] : []);
    return this.beginRun(room, list);
  }

  // Start a fresh run of `list` from scratch (scores reset). Shared by the host's
  // Start/Replay buttons and by a passing "play again — same games" vote. Returns
  // { ok:true } on success, or { ok:false, error } (a no-op) explaining why not,
  // so the caller can tell the host (e.g. "Need 3 players for Quip Lash").
  beginRun(room, list) {
    if (!list.length || list.some((id) => !getGame(id))) return { ok: false, error: 'Pick a game first.' };
    // Need enough players for every game queued (e.g. Quip needs 3+).
    const connected = [...room.players.values()].filter((p) => p.connected);
    const needGame = list.map((id) => getGame(id)).reduce((a, b) => ((b.minPlayers || 1) > (a.minPlayers || 1) ? b : a));
    const need = needGame.minPlayers || 1;
    if (connected.length < need) {
      return { ok: false, error: `Need at least ${need} players for ${needGame.name} — ${connected.length} here so far.` };
    }

    this.clearTimers(room);
    room.replayVotes = new Map();
    room.session = { games: list, index: 0 };
    room.gameId = list[0];
    room.phase = 'playing';
    for (const p of room.players.values()) p.score = 0; // reset once, at the start of the playlist
    // If init() throws, don't strand the room in a half-started, timer-less
    // 'playing' phase — fall back to the lobby so the host can try again.
    if (!this.safeInit(room)) { this.doBackToLobby(room); return { ok: false, error: 'Could not start that game. Try again.' }; }
    this.broadcast(room);
    return { ok: true };
  }

  // Run the current game's init() defensively. Returns false (leaving cleanup to
  // the caller) if it throws, so a bad game config can't wedge the room.
  safeInit(room) {
    const game = getGame(room.gameId);
    if (!game || typeof game.init !== 'function') return false;
    try {
      game.init(room, this.ctx(room));
      return true;
    } catch (err) {
      console.error('init error', err);
      return false;
    }
  }

  // Host advances to the next game in the playlist from the results screen.
  // Scores are NOT reset — they carry over into the combined leaderboard.
  nextInPlaylist(socket) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    if (room.phase !== 'results' || !room.session) return;
    const s = room.session;
    if (s.index >= s.games.length - 1) return; // already on the last game
    s.index += 1;
    const game = getGame(s.games[s.index]);
    if (!game) return;
    room.gameId = s.games[s.index];
    this.clearTimers(room);
    room.phase = 'playing';
    if (!this.safeInit(room)) { this.doBackToLobby(room); return; }
    this.broadcast(room);
  }

  backToLobby(socket) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || !this.isHost(room, ref.playerId)) return;
    this.doBackToLobby(room);
  }

  // Return to the lobby. Shared by the host's button and a passing "different
  // games" vote. Keeps room.playlist so they can replay/edit the same set.
  doBackToLobby(room) {
    this.clearTimers(room);
    room.replayVotes = new Map();
    room.phase = 'lobby';
    room.game = null;
    room.session = null;
    this.broadcast(room);
  }

  // ---- play-again voting (final results screen) ----------------------
  //
  // When a run finishes, every connected player can vote to either replay the
  // same games or go back to the lobby to pick different ones. A simple majority
  // of connected players decides; the host's own buttons still force it directly.

  // Whether the current results screen is the END of the run (not a between-games
  // pause mid-playlist, where the flow is the host's "Next game" instead).
  isRunComplete(room) {
    return !!(room.session && room.session.index >= room.session.games.length - 1);
  }

  // Count only *connected* voters, and how many make a majority. Recomputed on
  // demand so a disconnect naturally shrinks both the tally and the threshold.
  tallyReplay(room) {
    const connected = [...room.players.values()].filter((p) => p.connected);
    const votes = { same: 0, different: 0 };
    const cast = room.replayVotes || new Map();
    for (const p of connected) {
      const v = cast.get(p.id);
      if (v === 'same' || v === 'different') votes[v] += 1;
    }
    return { same: votes.same, different: votes.different, connected: connected.length, needed: Math.floor(connected.length / 2) + 1 };
  }

  // Execute the winning choice if either option has reached a majority. Returns
  // true (and has already broadcast) when it fired.
  resolveReplay(room) {
    if (!room || room.phase !== 'results' || !this.isRunComplete(room)) return false;
    const t = this.tallyReplay(room);
    if (t.connected === 0) return false;
    if (t.same >= t.needed) {
      const res = this.beginRun(room, room.session.games.slice());
      if (res.ok) return true;
      // The group voted to replay but has dropped below the games' player
      // requirement — don't strand everyone on results; send them to the lobby.
      this.doBackToLobby(room);
      return true;
    }
    if (t.different >= t.needed) { this.doBackToLobby(room); return true; }
    return false;
  }

  voteReplay(socket, choice) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref) return;
    if (room.phase !== 'results' || !this.isRunComplete(room)) return;
    const player = room.players.get(ref.playerId);
    if (!player || !player.connected) return;
    room.replayVotes = room.replayVotes || new Map();
    const prev = room.replayVotes.get(ref.playerId);
    if (choice === 'same' || choice === 'different') {
      if (prev === choice) room.replayVotes.delete(ref.playerId); // tap again to un-vote
      else room.replayVotes.set(ref.playerId, choice);
    } else {
      return; // ignore anything but the two valid choices
    }
    if (this.resolveReplay(room)) return; // fired — already broadcast the new phase
    this.broadcast(room);
  }

  gameAction(socket, action) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref || room.phase !== 'playing') return;
    const game = getGame(room.gameId);
    if (!game || typeof game.action !== 'function') return;
    // The hottest untrusted path (every answer/guess/vote/draw stroke). A throw
    // here must not escape the socket dispatch and crash the host.
    try {
      game.action(room, ref.playerId, action || {}, this.ctx(room));
    } catch (err) {
      console.error('action error', err);
    }
  }

  setName(socket, name) {
    const room = this.roomOfSocket(socket);
    const ref = this.sockets.get(socket.id);
    if (!room || !ref) return;
    const player = room.players.get(ref.playerId);
    if (!player) return;
    const next = String(name || '').trim().slice(0, 20) || player.name;
    if (next === player.name) return; // no-op: don't force a full-room broadcast
    player.name = next;
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
    if (room.replayVotes) room.replayVotes.delete(targetId); // drop their stale vote
    // Brief cooldown so a kicked player can't instantly rejoin.
    room.kicks = room.kicks || new Map();
    room.kicks.set(targetId, Date.now() + KICK_COOLDOWN);
    this.maybeOnLeave(room, targetId);
    // Removing a player shrinks the play-again electorate — a pending vote may
    // now have reached a majority (resolveReplay no-ops off the results screen).
    if (room.phase === 'results' && this.resolveReplay(room)) return;
    this.broadcast(room);
  }

  // Add a finished game's scores into the running session standings. A "win" is
  // credited only to an OUTRIGHT sole leader — on a tie nobody takes the win, so
  // the wins column always reads as "games won" and can't exceed games played.
  tallySession(room) {
    const players = [...room.players.values()];
    if (!players.length) return;
    let top = -Infinity;
    for (const p of players) {
      p.sessionPoints = (p.sessionPoints || 0) + (p.score || 0);
      if ((p.score || 0) > top) top = p.score || 0;
    }
    if (top > 0) {
      const leaders = players.filter((p) => (p.score || 0) === top);
      if (leaders.length === 1) leaders[0].wins = (leaders[0].wins || 0) + 1;
    }
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
        // In a playlist, scores accumulate across games (they are NOT reset
        // between them). Folding the running total into the session standings
        // at every game-end would double-count it, so we only tally once the
        // whole run is complete — the final score is the run's true total.
        const runComplete = !room.session || room.session.index >= room.session.games.length - 1;
        if (runComplete) this.tallySession(room);
        room.replayVotes = new Map(); // fresh play-again vote for this results screen
        room.phase = 'results';
        // Drop the finished game object — results renders purely from
        // players/scores/session, so no game module can ever observe stale
        // state (e.g. trivia's index run past the last question) during results.
        room.game = null;
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
        categories: room.config.categories,
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
    // Playlist the host is queuing in the lobby (ordered gameIds).
    view.playlist = room.playlist || [];
    // Active multi-game run, if any — drives the "Next game" flow on results.
    if (room.session) {
      const s = room.session;
      const nextId = s.index < s.games.length - 1 ? s.games[s.index + 1] : null;
      const nextGame = nextId ? getGame(nextId) : null;
      view.session = {
        index: s.index,
        total: s.games.length,
        games: s.games,
        nextGameId: nextId,
        nextGameName: nextGame ? nextGame.name : null,
        nextGameEmoji: nextGame ? nextGame.emoji : null,
      };
    }
    // Play-again vote — only on the final results screen (run complete).
    if (room.phase === 'results' && this.isRunComplete(room)) {
      const t = this.tallyReplay(room);
      view.replay = {
        same: t.same,
        different: t.different,
        connected: t.connected,
        needed: t.needed,
        yourVote: (room.replayVotes || new Map()).get(playerId) || null,
      };
    }

    // Only build the in-game view while actually playing. At 'results' the game
    // state can be past its end (e.g. trivia's index has run off the last
    // question); calling view() then would throw and abort the results
    // broadcast — leaving everyone stuck on the final screen. The results screen
    // renders from players/scores and never needs game.view.
    if (game && room.phase === 'playing' && typeof game.view === 'function') {
      view.game = game.view(room, playerId);
    }
    return view;
  }

  broadcast(room) {
    if (!room) return;
    for (const p of room.players.values()) {
      if (!p.connected) continue;
      // A view() edge case for one player must not starve everyone after them in
      // iteration order — skip the bad view rather than aborting the whole loop.
      let state;
      try {
        state = this.viewFor(room, p.id);
      } catch (err) {
        console.error('view error', err);
        continue;
      }
      this.io.to(p.socketId).emit('state', state);
    }
  }
}
