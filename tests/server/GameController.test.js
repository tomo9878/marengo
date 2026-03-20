'use strict';

// Mock TurnManager before requiring GameController
jest.mock('../../server/engine/TurnManager', () => ({
  executeAction: jest.fn(),
  processInterruption: jest.fn(),
  checkVictory: jest.fn(() => null),
  startPlayerTurn: jest.fn(),
  endActionPhase: jest.fn(),
  advanceRound: jest.fn(),
  applyApproachCleanup: jest.fn(),
}));

// Mock SaveManager
jest.mock('../../server/SaveManager', () => ({
  saveGame: jest.fn(),
  loadGame: jest.fn(),
  listSaves: jest.fn(() => []),
  deleteGame: jest.fn(),
  SAVES_DIR: '/tmp/test_saves',
}));

const TurnManager = require('../../server/engine/TurnManager');
const SaveManager = require('../../server/SaveManager');
const GameRoom = require('../../server/GameRoom');
const GameController = require('../../server/GameController');

// Mock WebSocket
function makeMockWs() {
  return {
    send: jest.fn(),
    close: jest.fn(),
  };
}

// Minimal game state
function makeState(overrides = {}) {
  return {
    round: 1,
    activePlayer: 'france',
    phase: 'action',
    controlToken: { holder: 'france', reason: 'active_player' },
    pendingInterruption: null,
    commandPoints: 3,
    morale: { france: { uncommitted: 10, total: 10 }, austria: { uncommitted: 10, total: 10 } },
    moraleTokens: [],
    pieces: {
      FR1: { id: 'FR1', side: 'france', type: 'infantry', strength: 3, maxStrength: 3, faceUp: true, disordered: false, localeId: 'L1', position: 'reserve', actedThisTurn: false },
      AT1: { id: 'AT1', side: 'austria', type: 'cavalry', strength: 2, maxStrength: 2, faceUp: true, disordered: false, localeId: 'L2', position: 'reserve', actedThisTurn: false },
    },
    pendingBombardment: null,
    crossingTraffic: {},
    actedPieceIds: new Set(),
    log: [],
    ...overrides,
  };
}

function setupRoom(state = null) {
  const room = new GameRoom('test-game');
  const wsF = makeMockWs();
  const wsA = makeMockWs();
  room.join(wsF, 'france');
  room.join(wsA, 'austria');
  room.setState(state || makeState());
  const controller = new GameController(room);
  return { room, controller, wsF, wsA };
}

function getSentMessages(ws) {
  return ws.send.mock.calls.map(call => JSON.parse(call[0]));
}

beforeEach(() => {
  jest.clearAllMocks();
  TurnManager.checkVictory.mockReturnValue(null);
});

describe('GameController', () => {
  describe('handleMessage', () => {
    test('invalid JSON returns PARSE_ERROR', () => {
      const { controller, wsF } = setupRoom();
      controller.handleMessage(wsF, 'not valid json {{{');
      const msgs = getSentMessages(wsF);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('PARSE_ERROR');
    });

    test('unknown message type returns UNKNOWN_MESSAGE error', () => {
      const { controller, wsF } = setupRoom();
      controller.handleMessage(wsF, JSON.stringify({ type: 'BOGUS' }));
      const msgs = getSentMessages(wsF);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('UNKNOWN_MESSAGE');
    });
  });

  describe('_handleAction', () => {
    test('ACTION from wrong side (not control holder) → ERROR NOT_YOUR_TURN', () => {
      const state = makeState({ controlToken: { holder: 'france', reason: 'active_player' } });
      const { controller, wsA } = setupRoom(state);

      controller.handleMessage(wsA, JSON.stringify({ type: 'ACTION', action: { type: 'reorganize', localeId: 'L1' } }));
      const msgs = getSentMessages(wsA);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('NOT_YOUR_TURN');
    });

    test('ACTION during pending interruption → ERROR AWAITING_RESPONSE', () => {
      const state = makeState({
        controlToken: { holder: 'france', reason: 'active_player' },
        pendingInterruption: {
          type: 'defense_response',
          waitingFor: 'austria',
          context: {},
        },
      });
      const { controller, wsF } = setupRoom(state);

      controller.handleMessage(wsF, JSON.stringify({ type: 'ACTION', action: { type: 'reorganize', localeId: 'L1' } }));
      const msgs = getSentMessages(wsF);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('AWAITING_RESPONSE');
    });

    test('valid ACTION → state updated, STATE_UPDATE broadcast to both', () => {
      const state = makeState();
      const { room, controller, wsF, wsA } = setupRoom(state);

      const newState = makeState({ round: 2 });
      TurnManager.executeAction.mockReturnValue({ newState, interruption: null });

      controller.handleMessage(wsF, JSON.stringify({
        type: 'ACTION',
        action: { type: 'reorganize', localeId: 'L1' },
      }));

      // State should be updated
      expect(room.getState().round).toBe(2);

      // Both players should receive STATE_UPDATE
      const franceMsgs = getSentMessages(wsF);
      const austriaMsgs = getSentMessages(wsA);
      expect(franceMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
      expect(austriaMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
    });

    test('valid ACTION → CONTROL_TRANSFER broadcast to both', () => {
      const state = makeState();
      const { controller, wsF, wsA } = setupRoom(state);

      const newState = makeState({ controlToken: { holder: 'austria', reason: 'active_player' } });
      TurnManager.executeAction.mockReturnValue({ newState, interruption: null });

      controller.handleMessage(wsF, JSON.stringify({
        type: 'ACTION',
        action: { type: 'reorganize', localeId: 'L1' },
      }));

      const franceMsgs = getSentMessages(wsF);
      const austriaMsgs = getSentMessages(wsA);

      const ctF = franceMsgs.find(m => m.type === 'CONTROL_TRANSFER');
      const ctA = austriaMsgs.find(m => m.type === 'CONTROL_TRANSFER');
      expect(ctF).toBeDefined();
      expect(ctA).toBeDefined();
      expect(ctF.holder).toBe('austria');
    });

    test('valid ACTION with interruption → INTERRUPTION sent to waiting side', () => {
      const state = makeState();
      const { controller, wsF, wsA } = setupRoom(state);

      const interruptionCtx = { attackerPieceIds: ['FR1'], targetLocaleId: 'L2', defenseEdgeIdx: 0, availableDefenders: ['AT1'], maxResponse: 1 };
      const interruption = {
        type: 'defense_response',
        waitingFor: 'austria',
        context: interruptionCtx,
      };
      const newState = makeState({
        controlToken: { holder: 'austria', reason: 'defense_response' },
        pendingInterruption: interruption,
      });
      TurnManager.executeAction.mockReturnValue({ newState, interruption });

      controller.handleMessage(wsF, JSON.stringify({
        type: 'ACTION',
        action: { type: 'raid', pieceId: 'FR1', targetLocaleId: 'L2', defenseEdgeIdx: 0 },
      }));

      const austriaMsgs = getSentMessages(wsA);
      const intMsg = austriaMsgs.find(m => m.type === 'INTERRUPTION');
      expect(intMsg).toBeDefined();
      expect(intMsg.interruptionType).toBe('defense_response');
      expect(intMsg.waitingFor).toBe('austria');

      // Also check CONTROL_TRANSFER
      const ctA = austriaMsgs.find(m => m.type === 'CONTROL_TRANSFER');
      expect(ctA).toBeDefined();
      expect(ctA.holder).toBe('austria');
    });

    test('executeAction throwing → ERROR ACTION_ERROR', () => {
      const state = makeState();
      const { controller, wsF } = setupRoom(state);

      TurnManager.executeAction.mockImplementation(() => { throw new Error('Invalid action'); });

      controller.handleMessage(wsF, JSON.stringify({
        type: 'ACTION',
        action: { type: 'invalid_type' },
      }));

      const msgs = getSentMessages(wsF);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('ACTION_ERROR');
    });
  });

  describe('_handleResponse', () => {
    test('RESPONSE from wrong side → ERROR NOT_YOUR_RESPONSE', () => {
      const state = makeState({
        controlToken: { holder: 'austria', reason: 'defense_response' },
        pendingInterruption: {
          type: 'defense_response',
          waitingFor: 'austria',
          context: {},
        },
      });
      const { controller, wsF } = setupRoom(state);

      controller.handleMessage(wsF, JSON.stringify({
        type: 'RESPONSE',
        response: { pieceIds: [] },
      }));

      const msgs = getSentMessages(wsF);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('NOT_YOUR_RESPONSE');
    });

    test('RESPONSE when no pending interruption → ERROR NO_INTERRUPTION', () => {
      const state = makeState({ pendingInterruption: null });
      const { controller, wsA } = setupRoom(state);

      controller.handleMessage(wsA, JSON.stringify({
        type: 'RESPONSE',
        response: { pieceIds: [] },
      }));

      const msgs = getSentMessages(wsA);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('NO_INTERRUPTION');
    });

    test('valid RESPONSE → state updated and broadcast', () => {
      const state = makeState({
        controlToken: { holder: 'austria', reason: 'defense_response' },
        pendingInterruption: {
          type: 'defense_response',
          waitingFor: 'austria',
          context: {},
        },
      });
      const { room, controller, wsF, wsA } = setupRoom(state);

      const newState = makeState({ round: 3, pendingInterruption: null, controlToken: { holder: 'france', reason: 'active_player' } });
      TurnManager.processInterruption.mockReturnValue({ newState, interruption: null });

      controller.handleMessage(wsA, JSON.stringify({
        type: 'RESPONSE',
        response: { pieceIds: ['AT1'] },
      }));

      expect(room.getState().round).toBe(3);
      const franceMsgs = getSentMessages(wsF);
      const austriaMsgs = getSentMessages(wsA);
      expect(franceMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
      expect(austriaMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
    });

    test('processInterruption throwing → ERROR RESPONSE_ERROR', () => {
      const state = makeState({
        controlToken: { holder: 'austria', reason: 'defense_response' },
        pendingInterruption: {
          type: 'defense_response',
          waitingFor: 'austria',
          context: {},
        },
      });
      const { controller, wsA } = setupRoom(state);

      TurnManager.processInterruption.mockImplementation(() => { throw new Error('Response error'); });

      controller.handleMessage(wsA, JSON.stringify({
        type: 'RESPONSE',
        response: {},
      }));

      const msgs = getSentMessages(wsA);
      expect(msgs[0].type).toBe('ERROR');
      expect(msgs[0].code).toBe('RESPONSE_ERROR');
    });
  });

  describe('game over', () => {
    test('victory detected → GAME_OVER broadcast to both', () => {
      const state = makeState();
      const { controller, wsF, wsA } = setupRoom(state);

      const newState = makeState({ round: 17 });
      TurnManager.executeAction.mockReturnValue({ newState, interruption: null });
      TurnManager.checkVictory.mockReturnValue({ winner: 'france', type: 'marginal_objective' });

      controller.handleMessage(wsF, JSON.stringify({
        type: 'ACTION',
        action: { type: 'reorganize', localeId: 'L1' },
      }));

      const franceMsgs = getSentMessages(wsF);
      const austriaMsgs = getSentMessages(wsA);

      const goF = franceMsgs.find(m => m.type === 'GAME_OVER');
      const goA = austriaMsgs.find(m => m.type === 'GAME_OVER');
      expect(goF).toBeDefined();
      expect(goA).toBeDefined();
      expect(goF.winner).toBe('france');
      expect(goF.winType).toBe('marginal_objective');
    });

    test('game over: SaveManager.saveGame called', () => {
      const state = makeState();
      const { controller, wsF } = setupRoom(state);

      const newState = makeState({ round: 17 });
      TurnManager.executeAction.mockReturnValue({ newState, interruption: null });
      TurnManager.checkVictory.mockReturnValue({ winner: 'france', type: 'marginal_objective' });

      controller.handleMessage(wsF, JSON.stringify({
        type: 'ACTION',
        action: { type: 'reorganize', localeId: 'L1' },
      }));

      expect(SaveManager.saveGame).toHaveBeenCalledWith('test-game', newState);
    });

    test('game over: no CONTROL_TRANSFER sent after game over', () => {
      const state = makeState();
      const { controller, wsF } = setupRoom(state);

      const newState = makeState({ round: 17 });
      TurnManager.executeAction.mockReturnValue({ newState, interruption: null });
      TurnManager.checkVictory.mockReturnValue({ winner: 'austria', type: 'morale_collapse' });

      controller.handleMessage(wsF, JSON.stringify({
        type: 'ACTION',
        action: { type: 'reorganize', localeId: 'L1' },
      }));

      const msgs = getSentMessages(wsF);
      const ct = msgs.find(m => m.type === 'CONTROL_TRANSFER');
      // No CONTROL_TRANSFER after game over
      expect(ct).toBeUndefined();
    });
  });
});
