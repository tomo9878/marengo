'use strict';

/**
 * index.js
 * WebSocket server entry point for Triomphe à Marengo.
 *
 * URL format: ws://localhost:PORT/?gameId=abc123&side=france
 *
 * On connection:
 *   - Parse gameId and side from URL query params
 *   - If gameId exists in saves → load and resume
 *   - If gameId not in rooms → create new room
 *   - Join room, create controller if needed
 *   - Attach message/close handlers
 *
 * Also handles HTTP GET /saves to list save files.
 * Also serves static client files.
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const GameRoom = require('./GameRoom');
const GameController = require('./GameController');
const SaveManager = require('./SaveManager');
const { createInitialState, initializePieces } = require('./engine/GameState');
const { sanitize } = require('./StateSanitizer');

const PORT = process.env.PORT || 3000;

// Project root (one level above server/)
const PROJECT_ROOT = path.resolve(__dirname, '..');

// MIME type map
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

/**
 * Serve a static file safely, ensuring it's within the project root.
 */
function serveStatic(filePath, res) {
  // Resolve to absolute and ensure it stays within PROJECT_ROOT
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PROJECT_ROOT + path.sep) && resolved !== PROJECT_ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
      } else {
        res.writeHead(500);
        res.end('Internal server error');
      }
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

// gameId → { room: GameRoom, controller: GameController, timeout: NodeJS.Timeout|null }
const rooms = new Map();

// Reconnection timeout: clean up empty rooms after 30 minutes
const RECONNECT_TIMEOUT_MS = 30 * 60 * 1000;

// HTTP request handler (static files + REST endpoints)
const httpServer = http.createServer((req, res) => {
  const reqUrl = req.url.split('?')[0];  // strip query string

  // GET /saves
  if (req.method === 'GET' && reqUrl === '/saves') {
    try {
      const saves = SaveManager.listSaves();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(saves));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /saves/:gameId/save — manual save of current room state
  if (req.method === 'POST' && reqUrl.startsWith('/saves/') && reqUrl.endsWith('/save')) {
    const gameId = reqUrl.slice('/saves/'.length, -'/save'.length);
    if (!gameId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing gameId' }));
      return;
    }
    const roomEntry = rooms.get(gameId);
    if (!roomEntry) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Room not found' }));
      return;
    }
    try {
      const state = roomEntry.room.getState();
      SaveManager.saveGame(gameId, state);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, gameId }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /saves/:gameId — delete a save file
  if (req.method === 'DELETE' && reqUrl.startsWith('/saves/')) {
    const gameId = reqUrl.slice('/saves/'.length);
    if (!gameId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing gameId' }));
      return;
    }
    try {
      SaveManager.deleteGame(gameId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, gameId }));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static file serving
  if (req.method === 'GET') {
    // GET / → client/index.html
    if (reqUrl === '/' || reqUrl === '/index.html') {
      serveStatic(path.join(PROJECT_ROOT, 'client', 'index.html'), res);
      return;
    }

    // GET /js/* → client/js/*
    if (reqUrl.startsWith('/js/')) {
      const rel = reqUrl.slice('/js/'.length);
      if (rel && !rel.includes('..')) {
        serveStatic(path.join(PROJECT_ROOT, 'client', 'js', rel), res);
        return;
      }
    }

    // GET /assets/* → client/assets/*
    if (reqUrl.startsWith('/assets/')) {
      const rel = reqUrl.slice('/assets/'.length);
      if (rel && !rel.includes('..')) {
        serveStatic(path.join(PROJECT_ROOT, 'client', 'assets', rel), res);
        return;
      }
    }

    // GET /data/map.json → data/map.json
    if (reqUrl === '/data/map.json') {
      serveStatic(path.join(PROJECT_ROOT, 'data', 'map.json'), res);
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Parse query params from request URL
  let gameId, side;
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    gameId = url.searchParams.get('gameId');
    side = url.searchParams.get('side');
  } catch {
    ws.send(JSON.stringify({ type: 'ERROR', code: 'BAD_URL', message: 'Invalid connection URL' }));
    ws.close();
    return;
  }

  if (!gameId || !side) {
    ws.send(JSON.stringify({ type: 'ERROR', code: 'MISSING_PARAMS', message: 'gameId and side are required' }));
    ws.close();
    return;
  }

  if (side !== 'france' && side !== 'austria') {
    ws.send(JSON.stringify({ type: 'ERROR', code: 'INVALID_SIDE', message: 'side must be france or austria' }));
    ws.close();
    return;
  }

  let roomEntry = rooms.get(gameId);
  let isReconnect = false;

  if (!roomEntry) {
    // Try to load from saves
    let initialState = null;
    try {
      initialState = SaveManager.loadGame(gameId);
    } catch {
      // New game
    }

    const room = new GameRoom(gameId);
    const controller = new GameController(room);

    if (initialState) {
      room.setState(initialState);
    } else {
      // Create fresh game state
      let state = createInitialState();
      state = initializePieces(state);
      room.setState(state);
    }

    roomEntry = { room, controller, timeout: null };
    rooms.set(gameId, roomEntry);
  } else {
    // Check if this side was previously connected (reconnection)
    if (roomEntry.room._connected[side] === false && roomEntry.room._players[side]) {
      isReconnect = true;
    }

    // Cancel pending cleanup timeout
    if (roomEntry.timeout) {
      clearTimeout(roomEntry.timeout);
      roomEntry.timeout = null;
    }
  }

  const { room, controller } = roomEntry;

  // Join or reconnect
  if (isReconnect) {
    room.reconnect(ws, side);
    controller.handleReconnect(side);
  } else {
    const joinError = room.join(ws, side);
    if (joinError) {
      ws.send(JSON.stringify({ type: 'ERROR', code: 'JOIN_ERROR', message: joinError }));
      ws.close();
      return;
    }
  }

  // Send JOINED confirmation with sanitized state
  const currentState = room.getState();
  const sanitizedState = sanitize(currentState, side);
  ws.send(JSON.stringify({
    type: 'JOINED',
    side,
    gameId,
    gameState: sanitizedState,
  }));

  // If both players now connected, send CONTROL_TRANSFER to inform of current holder
  if (room.isReady()) {
    room.broadcast({
      type: 'CONTROL_TRANSFER',
      holder: currentState.controlToken.holder,
      reason: currentState.controlToken.reason,
    });
  }

  // Message handler
  ws.on('message', (rawMessage) => {
    controller.handleMessage(ws, rawMessage);
  });

  // Close handler
  ws.on('close', () => {
    room.disconnect(side);

    // Schedule room cleanup after 30 minutes if both players disconnected
    if (!room._connected.france && !room._connected.austria) {
      const timeout = setTimeout(() => {
        rooms.delete(gameId);
      }, RECONNECT_TIMEOUT_MS);

      // Allow process to exit even if timer is pending
      if (timeout.unref) timeout.unref();
      roomEntry.timeout = timeout;
    }
  });

  // Error handler
  ws.on('error', (err) => {
    // Log but don't crash
    console.error(`WebSocket error for ${side} in game ${gameId}:`, err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Triomphe à Marengo server listening on http://localhost:${PORT}`);
});

httpServer.on('error', (err) => {
  console.error('Server error:', err);
});

module.exports = { wss, rooms };
