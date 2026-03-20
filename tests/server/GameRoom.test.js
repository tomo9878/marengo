'use strict';

const GameRoom = require('../../server/GameRoom');

// Mock WebSocket
function makeMockWs() {
  return {
    send: jest.fn(),
    close: jest.fn(),
  };
}

// Minimal state
function makeState() {
  return {
    round: 1,
    controlToken: { holder: 'france', reason: 'active_player' },
    pieces: {
      FR1: { id: 'FR1', side: 'france', type: 'infantry', strength: 3, maxStrength: 3, faceUp: false, disordered: false, localeId: 'L1', position: 'reserve', actedThisTurn: false },
      AT1: { id: 'AT1', side: 'austria', type: 'cavalry', strength: 2, maxStrength: 2, faceUp: false, disordered: false, localeId: 'L2', position: 'reserve', actedThisTurn: false },
    },
    actedPieceIds: new Set(),
    morale: { france: { uncommitted: 10, total: 10 }, austria: { uncommitted: 10, total: 10 } },
    moraleTokens: [],
    pendingInterruption: null,
    pendingBombardment: null,
    crossingTraffic: {},
    log: [],
    phase: 'action',
    activePlayer: 'france',
    commandPoints: 3,
  };
}

describe('GameRoom', () => {
  describe('join', () => {
    test('first join for france succeeds', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      const err = room.join(ws, 'france');
      expect(err).toBeNull();
      expect(room._players.france).toBe(ws);
      expect(room._connected.france).toBe(true);
    });

    test('first join for austria succeeds', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      const err = room.join(ws, 'austria');
      expect(err).toBeNull();
      expect(room._players.austria).toBe(ws);
    });

    test('joining same side again with same ws succeeds (idempotent)', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      room.join(ws, 'france');
      const err = room.join(ws, 'france');
      expect(err).toBeNull();
    });

    test('joining same side with different ws fails', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      const err = room.join(ws2, 'france');
      expect(err).not.toBeNull();
      expect(typeof err).toBe('string');
    });

    test('joining opposite side succeeds', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      expect(room.join(ws1, 'france')).toBeNull();
      expect(room.join(ws2, 'austria')).toBeNull();
    });

    test('invalid side returns error', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      const err = room.join(ws, 'invalid');
      expect(err).not.toBeNull();
    });
  });

  describe('isReady', () => {
    test('false with no players', () => {
      const room = new GameRoom('game1');
      expect(room.isReady()).toBe(false);
    });

    test('false with only one player', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      room.join(ws, 'france');
      expect(room.isReady()).toBe(false);
    });

    test('true with both players connected', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');
      expect(room.isReady()).toBe(true);
    });
  });

  describe('disconnect/reconnect', () => {
    test('disconnect marks player as not connected', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      room.join(ws, 'france');
      expect(room._connected.france).toBe(true);

      room.disconnect('france');
      expect(room._connected.france).toBe(false);
    });

    test('isReady false after disconnect', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');
      expect(room.isReady()).toBe(true);

      room.disconnect('france');
      expect(room.isReady()).toBe(false);
    });

    test('reconnect reattaches ws and marks connected', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.disconnect('france');
      expect(room._connected.france).toBe(false);

      room.reconnect(ws2, 'france');
      expect(room._connected.france).toBe(true);
      expect(room._players.france).toBe(ws2);
    });

    test('isReady true again after reconnect', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      const ws3 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');
      room.disconnect('france');
      expect(room.isReady()).toBe(false);

      room.reconnect(ws3, 'france');
      expect(room.isReady()).toBe(true);
    });
  });

  describe('sendTo', () => {
    test('sends to correct ws only', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');

      room.sendTo('france', { type: 'TEST' });
      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'TEST' }));
      expect(ws2.send).not.toHaveBeenCalled();
    });

    test('does not send to disconnected player', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      room.join(ws, 'france');
      room.disconnect('france');

      room.sendTo('france', { type: 'TEST' });
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('broadcast', () => {
    test('sends same message to both connected players', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');

      room.broadcast({ type: 'HELLO' });
      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify({ type: 'HELLO' }));
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify({ type: 'HELLO' }));
    });
  });

  describe('broadcastSanitized', () => {
    test('sends different sanitized states to each player', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');

      const state = makeState();
      room.broadcastSanitized(state);

      expect(ws1.send).toHaveBeenCalledTimes(1);
      expect(ws2.send).toHaveBeenCalledTimes(1);

      const franceMsg = JSON.parse(ws1.send.mock.calls[0][0]);
      const austriaMsg = JSON.parse(ws2.send.mock.calls[0][0]);

      expect(franceMsg.type).toBe('STATE_UPDATE');
      expect(austriaMsg.type).toBe('STATE_UPDATE');

      // France sees own FR1 piece, AT1 is hidden
      expect(franceMsg.gameState.pieces.FR1).toBeDefined();
      expect(franceMsg.gameState.pieces.FR1.type).toBe('infantry');
      expect(franceMsg.gameState.pieces.AT1).toBeUndefined();

      // Austria sees own AT1 piece, FR1 is hidden
      expect(austriaMsg.gameState.pieces.AT1).toBeDefined();
      expect(austriaMsg.gameState.pieces.AT1.type).toBe('cavalry');
      expect(austriaMsg.gameState.pieces.FR1).toBeUndefined();
    });

    test('merges extra fields into each player message', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');

      const state = makeState();
      room.broadcastSanitized(state, { extra: 'forFrance' }, { extra: 'forAustria' });

      const franceMsg = JSON.parse(ws1.send.mock.calls[0][0]);
      const austriaMsg = JSON.parse(ws2.send.mock.calls[0][0]);

      expect(franceMsg.extra).toBe('forFrance');
      expect(austriaMsg.extra).toBe('forAustria');
    });
  });

  describe('getSide', () => {
    test('returns france for france ws', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      room.join(ws, 'france');
      expect(room.getSide(ws)).toBe('france');
    });

    test('returns austria for austria ws', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      room.join(ws, 'austria');
      expect(room.getSide(ws)).toBe('austria');
    });

    test('returns null for unknown ws', () => {
      const room = new GameRoom('game1');
      const ws = makeMockWs();
      const other = makeMockWs();
      room.join(ws, 'france');
      expect(room.getSide(other)).toBeNull();
    });

    test('returns correct side for each ws when both connected', () => {
      const room = new GameRoom('game1');
      const ws1 = makeMockWs();
      const ws2 = makeMockWs();
      room.join(ws1, 'france');
      room.join(ws2, 'austria');
      expect(room.getSide(ws1)).toBe('france');
      expect(room.getSide(ws2)).toBe('austria');
    });
  });

  describe('getState / setState', () => {
    test('setState stores and getState retrieves state', () => {
      const room = new GameRoom('game1');
      const state = makeState();
      room.setState(state);
      expect(room.getState()).toBe(state);
    });

    test('initial state is null', () => {
      const room = new GameRoom('game1');
      expect(room.getState()).toBeNull();
    });
  });
});
