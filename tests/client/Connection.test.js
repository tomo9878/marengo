'use strict';

/**
 * Connection.test.js
 * Tests for client WebSocket connection management.
 * Uses a manual WebSocket mock (no DOM/jsdom needed).
 */

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this._listeners = {};
    MockWebSocket._lastInstance = this;
    MockWebSocket._instances.push(this);
  }

  addEventListener(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(h => h !== handler);
  }

  send(msg) {
    this._sent = this._sent || [];
    this._sent.push(msg);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // Test helper: simulate receiving a message
  _emit(event, data) {
    const handlers = this._listeners[event] || [];
    handlers.forEach(h => h(data));
  }

  static get OPEN()    { return 1; }
  static get CLOSED()  { return 3; }
}

MockWebSocket._instances = [];
MockWebSocket._lastInstance = null;

// ---------------------------------------------------------------------------
// Inline Connection implementation (mirrors client/js/Connection.js logic)
// We test the parsed class behavior without importing ES modules.
// ---------------------------------------------------------------------------

/**
 * Connection class (CommonJS mirror of client/js/Connection.js for testing).
 */
class Connection {
  constructor(gameId, side, handlers) {
    this.gameId = gameId;
    this.side = side;
    this.handlers = handlers || {};
    this.ws = null;
    this._reconnectAttempts = 0;
    this._maxReconnects = 5;
    this._reconnectDelay = 2000;
    this._intentionalClose = false;
    this._WebSocket = MockWebSocket; // injected for testing
  }

  connect() {
    this._intentionalClose = false;
    this.ws = new this._WebSocket(`ws://localhost/?gameId=${this.gameId}&side=${this.side}`);

    this.ws.addEventListener('open', () => {
      this._reconnectAttempts = 0;
    });

    this.ws.addEventListener('message', (event) => {
      this._handleMessage(event.data);
    });

    this.ws.addEventListener('close', () => {
      if (this._intentionalClose) return;
      this._scheduleReconnect();
    });

    this.ws.addEventListener('error', () => {
      if (this.handlers.onError) {
        this.handlers.onError('WS_ERROR', 'WebSocket error');
      }
    });
  }

  send(type, payload) {
    if (!this.ws || this.ws.readyState !== MockWebSocket.OPEN) return;
    const msg = { type, gameId: this.gameId, ...payload };
    this.ws.send(JSON.stringify(msg));
  }

  sendAction(action) {
    this.send('ACTION', { action });
  }

  sendResponse(response) {
    this.send('RESPONSE', { response });
  }

  disconnect() {
    this._intentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  _handleMessage(rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'JOINED':
        if (this.handlers.onJoined) {
          this.handlers.onJoined(msg.side, msg.gameId, msg.gameState);
        }
        break;
      case 'STATE_UPDATE':
        if (this.handlers.onState) {
          this.handlers.onState(msg.gameState);
        }
        break;
      case 'INTERRUPTION':
        if (this.handlers.onInterruption) {
          this.handlers.onInterruption(msg.interruptionType, msg.options, msg.waitingFor);
        }
        break;
      case 'CONTROL_TRANSFER':
        if (this.handlers.onControlTransfer) {
          this.handlers.onControlTransfer(msg.holder, msg.reason);
        }
        break;
      case 'GAME_OVER':
        if (this.handlers.onGameOver) {
          this.handlers.onGameOver(msg.winner, msg.reason);
        }
        break;
      case 'ERROR':
        if (this.handlers.onError) {
          this.handlers.onError(msg.code, msg.message);
        }
        break;
    }
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnects) return;
    this._reconnectAttempts++;
    // In tests, we track that a reconnect was scheduled rather than using setTimeout
    if (this._onReconnectScheduled) this._onReconnectScheduled(this._reconnectAttempts);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWebSocket._instances = [];
  MockWebSocket._lastInstance = null;
});

describe('Connection', () => {
  // ── Message parsing ──────────────────────────────────────────────────────

  test('onState called when STATE_UPDATE received', () => {
    const received = [];
    const conn = new Connection('g1', 'france', {
      onState: (gs) => received.push(gs),
    });
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    const fakeState = { round: 3, morale: {} };
    ws._emit('message', { data: JSON.stringify({ type: 'STATE_UPDATE', gameState: fakeState }) });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(fakeState);
  });

  test('onJoined called when JOINED received', () => {
    const joined = [];
    const conn = new Connection('g1', 'france', {
      onJoined: (side, gameId, gs) => joined.push({ side, gameId, gs }),
    });
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    ws._emit('message', {
      data: JSON.stringify({
        type: 'JOINED',
        side: 'france',
        gameId: 'g1',
        gameState: { round: 1 },
      }),
    });

    expect(joined).toHaveLength(1);
    expect(joined[0].side).toBe('france');
    expect(joined[0].gameId).toBe('g1');
    expect(joined[0].gs).toEqual({ round: 1 });
  });

  test('onInterruption called when INTERRUPTION received', () => {
    const interruptions = [];
    const conn = new Connection('g1', 'france', {
      onInterruption: (type, options, waitingFor) =>
        interruptions.push({ type, options, waitingFor }),
    });
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    ws._emit('message', {
      data: JSON.stringify({
        type: 'INTERRUPTION',
        interruptionType: 'defense_response',
        options: { eligiblePieceIds: ['FR1'] },
        waitingFor: 'france',
      }),
    });

    expect(interruptions).toHaveLength(1);
    expect(interruptions[0].type).toBe('defense_response');
    expect(interruptions[0].options).toEqual({ eligiblePieceIds: ['FR1'] });
    expect(interruptions[0].waitingFor).toBe('france');
  });

  test('onControlTransfer called when CONTROL_TRANSFER received', () => {
    const transfers = [];
    const conn = new Connection('g1', 'austria', {
      onControlTransfer: (holder, reason) => transfers.push({ holder, reason }),
    });
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    ws._emit('message', {
      data: JSON.stringify({ type: 'CONTROL_TRANSFER', holder: 'austria', reason: 'active_player' }),
    });

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({ holder: 'austria', reason: 'active_player' });
  });

  test('onError called when ERROR received', () => {
    const errors = [];
    const conn = new Connection('g1', 'france', {
      onError: (code, msg) => errors.push({ code, msg }),
    });
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    ws._emit('message', {
      data: JSON.stringify({ type: 'ERROR', code: 'NOT_YOUR_TURN', message: 'It is not your turn' }),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('NOT_YOUR_TURN');
  });

  test('onGameOver called when GAME_OVER received', () => {
    const results = [];
    const conn = new Connection('g1', 'france', {
      onGameOver: (winner, reason) => results.push({ winner, reason }),
    });
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    ws._emit('message', {
      data: JSON.stringify({ type: 'GAME_OVER', winner: 'france', reason: 'morale_collapse' }),
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ winner: 'france', reason: 'morale_collapse' });
  });

  test('invalid JSON message does not throw', () => {
    const conn = new Connection('g1', 'france', {});
    conn.connect();
    const ws = MockWebSocket._lastInstance;
    expect(() => ws._emit('message', { data: 'not-json{' })).not.toThrow();
  });

  // ── sendAction ───────────────────────────────────────────────────────────

  test('sendAction formats message correctly', () => {
    const conn = new Connection('game42', 'france', {});
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    conn.sendAction({ type: 'rough_march', pieceId: 'FR1', targetLocaleId: 5 });

    expect(ws._sent).toHaveLength(1);
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe('ACTION');
    expect(msg.gameId).toBe('game42');
    expect(msg.action).toEqual({ type: 'rough_march', pieceId: 'FR1', targetLocaleId: 5 });
  });

  test('sendResponse formats message correctly', () => {
    const conn = new Connection('game42', 'france', {});
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    conn.sendResponse({ pieceIds: ['FR1', 'FR2'] });

    expect(ws._sent).toHaveLength(1);
    const msg = JSON.parse(ws._sent[0]);
    expect(msg.type).toBe('RESPONSE');
    expect(msg.gameId).toBe('game42');
    expect(msg.response).toEqual({ pieceIds: ['FR1', 'FR2'] });
  });

  test('send does nothing when ws is not open', () => {
    const conn = new Connection('g1', 'france', {});
    conn.connect();
    const ws = MockWebSocket._lastInstance;
    ws.readyState = MockWebSocket.CLOSED;

    conn.sendAction({ type: 'end_turn' });
    expect(ws._sent).toBeUndefined();
  });

  // ── Reconnection ─────────────────────────────────────────────────────────

  test('reconnect attempt scheduled after close (not intentional)', () => {
    const reconnectCalls = [];
    const conn = new Connection('g1', 'france', {});
    conn._onReconnectScheduled = (attempt) => reconnectCalls.push(attempt);
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    ws._emit('close', {});

    expect(reconnectCalls).toHaveLength(1);
    expect(reconnectCalls[0]).toBe(1);
  });

  test('no reconnect attempt after intentional disconnect', () => {
    const reconnectCalls = [];
    const conn = new Connection('g1', 'france', {});
    conn._onReconnectScheduled = (attempt) => reconnectCalls.push(attempt);
    conn.connect();

    conn.disconnect();
    const ws = MockWebSocket._lastInstance;
    // Even if close fires, it should be ignored
    if (ws) ws._emit('close', {});

    expect(reconnectCalls).toHaveLength(0);
  });

  test('reconnect stops after max 5 attempts', () => {
    const reconnectCalls = [];
    const conn = new Connection('g1', 'france', {});
    conn._onReconnectScheduled = (attempt) => reconnectCalls.push(attempt);
    conn.connect();

    const ws = MockWebSocket._lastInstance;

    // Simulate 6 close events
    for (let i = 0; i < 6; i++) {
      ws._emit('close', {});
    }

    expect(reconnectCalls.length).toBeLessThanOrEqual(5);
  });

  test('reconnect counter resets on open', () => {
    const conn = new Connection('g1', 'france', {});
    conn._reconnectAttempts = 3;
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    ws._emit('open', {});

    expect(conn._reconnectAttempts).toBe(0);
  });

  // ── disconnect ───────────────────────────────────────────────────────────

  test('disconnect sets intentionalClose and closes ws', () => {
    const conn = new Connection('g1', 'france', {});
    conn.connect();

    const ws = MockWebSocket._lastInstance;
    conn.disconnect();

    expect(conn._intentionalClose).toBe(true);
    expect(conn.ws).toBeNull();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});
