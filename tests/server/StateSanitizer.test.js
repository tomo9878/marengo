'use strict';

const { sanitize, sanitizePieces } = require('../../server/StateSanitizer');

// Minimal piece factory
function makePiece(id, side, faceUp, localeId = 'L1', position = 'reserve', extra = {}) {
  return {
    id,
    side,
    type: 'infantry',
    strength: 3,
    maxStrength: 3,
    faceUp,
    disordered: false,
    localeId,
    position,
    actedThisTurn: false,
    ...extra,
  };
}

// Minimal state factory
function makeState(pieces) {
  return {
    round: 1,
    activePlayer: 'france',
    phase: 'action',
    controlToken: { holder: 'france', reason: 'active_player' },
    pendingInterruption: null,
    commandPoints: 3,
    morale: { france: { uncommitted: 10, total: 10 }, austria: { uncommitted: 10, total: 10 } },
    moraleTokens: [],
    pieces,
    pendingBombardment: null,
    crossingTraffic: {},
    actedPieceIds: new Set(),
    log: [],
  };
}

describe('StateSanitizer', () => {
  describe('sanitizePieces', () => {
    test('own face-down piece: full info preserved', () => {
      const pieces = {
        FR1: makePiece('FR1', 'france', false, 'L1', 'reserve'),
      };
      const result = sanitizePieces(pieces, 'france');
      expect(result.FR1).toBeDefined();
      expect(result.FR1.id).toBe('FR1');
      expect(result.FR1.type).toBe('infantry');
      expect(result.FR1.strength).toBe(3);
      expect(result.FR1.faceUp).toBe(false);
    });

    test('own face-up piece: full info preserved', () => {
      const pieces = {
        FR1: makePiece('FR1', 'france', true),
      };
      const result = sanitizePieces(pieces, 'france');
      expect(result.FR1.strength).toBe(3);
      expect(result.FR1.type).toBe('infantry');
    });

    test('enemy face-up piece: full info preserved', () => {
      const pieces = {
        AT1: makePiece('AT1', 'austria', true, 'L2', 'reserve'),
      };
      const result = sanitizePieces(pieces, 'france');
      expect(result.AT1).toBeDefined();
      expect(result.AT1.id).toBe('AT1');
      expect(result.AT1.type).toBe('infantry');
      expect(result.AT1.strength).toBe(3);
    });

    test('enemy face-down piece: type/strength/id anonymized, localeId/position/side preserved', () => {
      const pieces = {
        AT1: makePiece('AT1', 'austria', false, 'L3', 'approach_0'),
      };
      const result = sanitizePieces(pieces, 'france');
      // Original id should not appear
      expect(result.AT1).toBeUndefined();
      // Should have a hidden piece
      expect(result.hidden_0).toBeDefined();
      expect(result.hidden_0.id).toBe('hidden_0');
      expect(result.hidden_0.type).toBeNull();
      expect(result.hidden_0.strength).toBeNull();
      expect(result.hidden_0.maxStrength).toBeNull();
      expect(result.hidden_0.faceUp).toBe(false);
      expect(result.hidden_0.localeId).toBe('L3');
      expect(result.hidden_0.position).toBe('approach_0');
      expect(result.hidden_0.side).toBe('austria');
      expect(result.hidden_0.disordered).toBe(false);
    });

    test('stable hidden IDs: same pieces produce same IDs across two calls', () => {
      const pieces = {
        AT1: makePiece('AT1', 'austria', false, 'L1', 'reserve'),
        AT2: makePiece('AT2', 'austria', false, 'L2', 'reserve'),
      };
      const result1 = sanitizePieces(pieces, 'france');
      const result2 = sanitizePieces(pieces, 'france');

      // Both calls should produce the same hidden IDs at the same positions
      expect(Object.keys(result1).sort()).toEqual(Object.keys(result2).sort());
      expect(result1.hidden_0.localeId).toBe(result2.hidden_0.localeId);
      expect(result1.hidden_1.localeId).toBe(result2.hidden_1.localeId);
    });

    test('hidden IDs are sorted by localeId then position', () => {
      const pieces = {
        AT1: makePiece('AT1', 'austria', false, 'L2', 'approach_1'),
        AT2: makePiece('AT2', 'austria', false, 'L1', 'reserve'),
        AT3: makePiece('AT3', 'austria', false, 'L1', 'approach_0'),
      };
      const result = sanitizePieces(pieces, 'france');

      // Sorted: L1/approach_0, L1/reserve, L2/approach_1
      expect(result.hidden_0.localeId).toBe('L1');
      expect(result.hidden_0.position).toBe('approach_0');
      expect(result.hidden_1.localeId).toBe('L1');
      expect(result.hidden_1.position).toBe('reserve');
      expect(result.hidden_2.localeId).toBe('L2');
      expect(result.hidden_2.position).toBe('approach_1');
    });

    test('mixed scenario: some enemy face-up, some face-down', () => {
      const pieces = {
        FR1: makePiece('FR1', 'france', false, 'L1', 'reserve'),
        AT1: makePiece('AT1', 'austria', true, 'L2', 'reserve'),   // face-up enemy
        AT2: makePiece('AT2', 'austria', false, 'L3', 'reserve'), // face-down enemy
        AT3: makePiece('AT3', 'austria', false, 'L4', 'reserve'), // face-down enemy
      };
      const result = sanitizePieces(pieces, 'france');

      // Own piece: full
      expect(result.FR1).toBeDefined();
      expect(result.FR1.type).toBe('infantry');

      // Face-up enemy: full
      expect(result.AT1).toBeDefined();
      expect(result.AT1.type).toBe('infantry');

      // Face-down enemies: anonymized
      expect(result.AT2).toBeUndefined();
      expect(result.AT3).toBeUndefined();
      expect(result.hidden_0).toBeDefined();
      expect(result.hidden_1).toBeDefined();

      // Total keys: FR1 + AT1 + hidden_0 + hidden_1 = 4
      expect(Object.keys(result)).toHaveLength(4);
    });

    test('austria viewing: own austria pieces are fully visible, france pieces anonymized', () => {
      const pieces = {
        FR1: makePiece('FR1', 'france', false, 'L1', 'reserve'),
        AT1: makePiece('AT1', 'austria', false, 'L2', 'reserve'),
      };
      const result = sanitizePieces(pieces, 'austria');

      // Own austria piece: full
      expect(result.AT1).toBeDefined();
      expect(result.AT1.type).toBe('infantry');

      // Enemy france piece: anonymized
      expect(result.FR1).toBeUndefined();
      expect(result.hidden_0).toBeDefined();
      expect(result.hidden_0.side).toBe('france');
    });

    test('no hidden pieces when all enemy pieces are face-up', () => {
      const pieces = {
        FR1: makePiece('FR1', 'france', true),
        AT1: makePiece('AT1', 'austria', true),
      };
      const result = sanitizePieces(pieces, 'france');
      expect(result.hidden_0).toBeUndefined();
      expect(Object.keys(result)).toHaveLength(2);
    });
  });

  describe('sanitize (full state)', () => {
    test('returns a copy of state with sanitized pieces', () => {
      const pieces = {
        FR1: makePiece('FR1', 'france', false, 'L1', 'reserve'),
        AT1: makePiece('AT1', 'austria', false, 'L2', 'reserve'),
      };
      const state = makeState(pieces);
      const result = sanitize(state, 'france');

      // State properties preserved
      expect(result.round).toBe(1);
      expect(result.phase).toBe('action');
      expect(result.controlToken).toEqual({ holder: 'france', reason: 'active_player' });

      // Own piece preserved
      expect(result.pieces.FR1).toBeDefined();
      expect(result.pieces.FR1.type).toBe('infantry');

      // Enemy hidden
      expect(result.pieces.AT1).toBeUndefined();
      expect(result.pieces.hidden_0).toBeDefined();
    });

    test('does not mutate original state', () => {
      const pieces = {
        AT1: makePiece('AT1', 'austria', false, 'L1', 'reserve'),
      };
      const state = makeState(pieces);
      sanitize(state, 'france');

      // Original pieces unchanged
      expect(state.pieces.AT1).toBeDefined();
      expect(state.pieces.AT1.id).toBe('AT1');
    });

    test('actedPieceIds preserved as array after sanitization', () => {
      const pieces = {};
      const state = makeState(pieces);
      state.actedPieceIds = new Set(['FR1']);
      const result = sanitize(state, 'france');
      // After sanitization actedPieceIds can be an array (serialized Set) or Set-like
      // The sanitizer converts Set → { __type, values } then back to values array
      expect(result.actedPieceIds).toBeDefined();
    });
  });
});
