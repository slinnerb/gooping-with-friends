import http from 'http';
import os from 'os';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './src/rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// App version, read once at boot so the UI can display it and the host can see
// at a glance which build their friends are joining.
let APP_VERSION = '0.0.0';
try {
  APP_VERSION = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || APP_VERSION;
} catch { /* keep default */ }

// Best-guess LAN URL so friends on the same Wi-Fi can scan/join.
// Skips link-local (169.254.x.x APIPA) addresses — those come from virtual or
// disconnected adapters and aren't routable by anyone, so a friend's browser
// just times out. Prefers real private LAN ranges (192.168 / 10 / 172.16-31).
function lanUrl(port) {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // link-local — never routable
      candidates.push(net.address);
    }
  }
  if (!candidates.length) return null;
  const isPrivate = (a) =>
    a.startsWith('192.168.') ||
    a.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  const best = candidates.find(isPrivate) || candidates[0];
  return `http://${best}:${port}`;
}

export function startServer(port = process.env.PORT || 3000) {
  return new Promise((resolve) => {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 });
    const manager = new RoomManager(io);

    // Security headers. CSP is the backstop for any user-text injection: scripts are
    // 'self' only (no inline), framing is blocked. Inline styles are allowed because
    // the UI uses many style="" attributes (avatar colors, bar widths); the Google
    // Fonts + data: QR/favicon sources are whitelisted.
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; '));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      next();
    });

    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/health', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));
    app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION }));
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

    io.on('connection', (socket) => {
      socket.on('room:create', (data, cb) => {
        const result = manager.createRoom(socket, data || {});
        if (typeof cb === 'function') {
          if (result.error) cb({ ok: false, error: result.error });
          else cb({ ok: true, code: result.room.code });
        }
      });

      socket.on('room:join', (data, cb) => {
        const result = manager.joinRoom(socket, data || {});
        if (typeof cb === 'function') {
          if (result.error) cb({ ok: false, error: result.error });
          else cb({ ok: true, code: result.room.code });
        }
      });

      socket.on('room:leave', () => manager.leaveRoom(socket));
      socket.on('room:setName', (name) => manager.setName(socket, name));
      socket.on('room:kick', (targetId) => manager.kick(socket, targetId));
      socket.on('room:resetStandings', () => manager.resetStandings(socket));

      socket.on('game:select', (gameId) => manager.selectGame(socket, gameId));
      socket.on('game:config', (config) => manager.setConfig(socket, config));
      socket.on('game:start', () => manager.startGame(socket));
      socket.on('game:next', () => manager.nextInPlaylist(socket));
      socket.on('game:lobby', () => manager.backToLobby(socket));
      socket.on('game:action', (action) => manager.gameAction(socket, action));

      socket.on('tunnel:start', () => {
        const ref = manager.sockets.get(socket.id);
        const room = manager.roomOfSocket(socket);
        if (room && ref && manager.isHost(room, ref.playerId)) manager.startPublic();
      });

      socket.on('disconnect', () => manager.handleDisconnect(socket));
    });

    server.once('listening', () => {
      const actual = server.address().port;
      manager.lanUrl = lanUrl(actual);
      manager.port = actual;
      console.log(`\n  🫠 Gooping with Friends running at http://localhost:${actual}`);
      if (manager.lanUrl) console.log(`  📡 On your network: ${manager.lanUrl}\n`);
      resolve({ port: actual, server, io, manager });
    });

    // If the requested port is taken, fall back to an OS-assigned free port
    // (port 0) so the app never crashes on a busy port like 3000.
    const attempt = (p) => {
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && p !== 0) {
          console.warn(`  ⚠ Port ${p} is busy — using a random free port instead.`);
          attempt(0);
        } else {
          console.error('Server failed to start:', err);
        }
      });
      server.listen(p);
    };
    attempt(port);
  });
}

// Start automatically only when run directly (node server.js), not when imported by Electron.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) startServer();
