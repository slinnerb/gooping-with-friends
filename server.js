import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './src/rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Best-guess LAN URL so friends on the same Wi-Fi can scan/join.
function lanUrl(port) {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return `http://${net.address}:${port}`;
    }
  }
  return null;
}

export function startServer(port = process.env.PORT || 3000) {
  return new Promise((resolve) => {
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*' } });
    const manager = new RoomManager(io);

    app.use(express.static(path.join(__dirname, 'public')));
    app.get('/health', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));
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
