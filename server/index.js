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
 */

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const GameRoom = require('./GameRoom');
const GameController = require('./GameController');
const SaveManager = require('./SaveManager');
const { createInitialState, initializePieces } = require('./engine/GameState');
const { sanitize } = require('./StateSanitizer');

const PORT = process.env.PORT || 3000;

// gameId → { room: GameRoom, controller: GameController, timeout: NodeJS.Timeout|null }
const rooms = new Map();

// Reconnection timeout: clean up empty rooms after 30 minutes
const RECONNECT_TIMEOUT_MS = 30 * 60 * 1000;

const wss = new WebSocketServer({ port: PORT });

// Handle plain HTTP requests (e.g. GET /saves)
wss.on('request', (req, res) => {
  if (req.method === 'GET' && req.url === '/saves') {
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

  res.writeHead(404);
  res.end('Not found');
});

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

wss.on('listening', () => {
  console.log(`Triomphe à Marengo WebSocket server listening on port ${PORT}`);
});

wss.on('error', (err) => {
  console.error('WebSocket server error:', err);
});

module.exports = { wss, rooms };
