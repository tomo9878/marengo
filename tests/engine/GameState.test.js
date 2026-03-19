'use strict';

const {
  SIDES,
  PHASES,
  PIECE_TYPES,
  INTERRUPTION,
  createInitialState,
  createPieceState,
  initializePieces,
  cloneState,
  updatePiece,
  addLog,
  serialize,
  deserialize,
  getRoundTime,
  getTotalMorale,
  resetCommandPoints,
} = require('../../server/engine/GameState');

// ---------------------------------------------------------------------------
// 定数のテスト
// ---------------------------------------------------------------------------

describe('Constants', () => {
  test('SIDES has FRANCE and AUSTRIA', () => {
    expect(SIDES.FRANCE).toBe('france');
    expect(SIDES.AUSTRIA).toBe('austria');
  });

  test('PHASES has all 4 phases', () => {
    expect(PHASES.MORALE_UPDATE).toBeDefined();
    expect(PHASES.APPROACH_CLEANUP).toBeDefined();
    expect(PHASES.ACTION).toBeDefined();
    expect(PHASES.MORALE_CLEANUP).toBeDefined();
  });

  test('PIECE_TYPES has infantry, cavalry, artillery', () => {
    expect(PIECE_TYPES.INFANTRY).toBe('infantry');
    expect(PIECE_TYPES.CAVALRY).toBe('cavalry');
    expect(PIECE_TYPES.ARTILLERY).toBe('artillery');
  });

  test('INTERRUPTION has all required types', () => {
    expect(INTERRUPTION.DEFENSE_RESPONSE).toBeDefined();
    expect(INTERRUPTION.ASSAULT_DEF_LEADERS).toBeDefined();
    expect(INTERRUPTION.ASSAULT_ATK_LEADERS).toBeDefined();
    expect(INTERRUPTION.ASSAULT_DEF_ARTILLERY).toBeDefined();
    expect(INTERRUPTION.ASSAULT_COUNTER).toBeDefined();
    expect(INTERRUPTION.ASSAULT_REDUCTIONS).toBeDefined();
    expect(INTERRUPTION.BOMBARDMENT_REDUCTION).toBeDefined();
    expect(INTERRUPTION.RETREAT_DESTINATION).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  test('returns valid initial state', () => {
    const state = createInitialState();
    expect(state.round).toBe(1);
    expect(state.activePlayer).toBe(SIDES.AUSTRIA);
    expect(state.phase).toBe(PHASES.MORALE_UPDATE);
    expect(state.commandPoints).toBe(3);
    expect(state.pendingInterruption).toBeNull();
    expect(state.moraleTokens).toEqual([]);
    expect(state.log).toEqual([]);
  });

  test('initializes morale correctly from scenarios.json', () => {
    const state = createInitialState();
    expect(state.morale.france.uncommitted).toBe(3);
    expect(state.morale.france.total).toBe(12);
    expect(state.morale.austria.uncommitted).toBe(0);
    expect(state.morale.austria.total).toBe(12);
  });

  test('actedPieceIds is a Set', () => {
    const state = createInitialState();
    expect(state.actedPieceIds).toBeInstanceOf(Set);
    expect(state.actedPieceIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cloneState
// ---------------------------------------------------------------------------

describe('cloneState', () => {
  test('returns a deep copy', () => {
    const state = createInitialState();
    state.pieces['FR-INF-1'] = { id: 'FR-INF-1', strength: 3 };
    const cloned = cloneState(state);

    // 独立したコピーであること
    cloned.pieces['FR-INF-1'].strength = 1;
    expect(state.pieces['FR-INF-1'].strength).toBe(3);
  });

  test('preserves Set for actedPieceIds', () => {
    const state = createInitialState();
    state.actedPieceIds.add('FR-INF-1');
    state.actedPieceIds.add('AU-INF-1');

    const cloned = cloneState(state);
    expect(cloned.actedPieceIds).toBeInstanceOf(Set);
    expect(cloned.actedPieceIds.has('FR-INF-1')).toBe(true);
    expect(cloned.actedPieceIds.has('AU-INF-1')).toBe(true);
    expect(cloned.actedPieceIds.size).toBe(2);
  });

  test('mutating clone does not affect original', () => {
    const state = createInitialState();
    state.moraleTokens.push({ side: 'france', localeId: 5 });

    const cloned = cloneState(state);
    cloned.moraleTokens.push({ side: 'austria', localeId: 10 });
    cloned.round = 5;

    expect(state.moraleTokens.length).toBe(1);
    expect(state.round).toBe(1);
  });

  test('deep copies nested objects', () => {
    const state = createInitialState();
    state.morale.france.uncommitted = 5;
    const cloned = cloneState(state);
    cloned.morale.france.uncommitted = 10;
    expect(state.morale.france.uncommitted).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// serialize / deserialize
// ---------------------------------------------------------------------------

describe('serialize / deserialize', () => {
  test('roundtrip produces equivalent state', () => {
    const state = createInitialState();
    state.actedPieceIds.add('FR-INF-1');
    state.pieces['FR-INF-1'] = { id: 'FR-INF-1', strength: 2 };
    state.moraleTokens.push({ side: 'france', localeId: 3 });

    const serialized = serialize(state);
    const restored = deserialize(serialized);

    expect(restored.round).toBe(state.round);
    expect(restored.activePlayer).toBe(state.activePlayer);
    expect(restored.pieces['FR-INF-1'].strength).toBe(2);
    expect(restored.moraleTokens).toEqual(state.moraleTokens);
    expect(restored.actedPieceIds).toBeInstanceOf(Set);
    expect(restored.actedPieceIds.has('FR-INF-1')).toBe(true);
  });

  test('serialize converts Set to array', () => {
    const state = createInitialState();
    state.actedPieceIds.add('AU-INF-1');
    const serialized = serialize(state);
    expect(Array.isArray(serialized.actedPieceIds)).toBe(true);
    expect(serialized.actedPieceIds).toContain('AU-INF-1');
  });

  test('deserialize restores actedPieceIds as Set', () => {
    const raw = {
      round: 2,
      activePlayer: 'france',
      actedPieceIds: ['FR-INF-1', 'FR-INF-2'],
      pieces: {},
      morale: { france: { uncommitted: 3, total: 12 }, austria: { uncommitted: 0, total: 12 } },
      moraleTokens: [],
    };
    const state = deserialize(raw);
    expect(state.actedPieceIds).toBeInstanceOf(Set);
    expect(state.actedPieceIds.has('FR-INF-1')).toBe(true);
    expect(state.actedPieceIds.has('FR-INF-2')).toBe(true);
  });

  test('deserialize handles missing actedPieceIds', () => {
    const raw = {
      round: 1,
      pieces: {},
      morale: { france: { uncommitted: 3, total: 12 }, austria: { uncommitted: 0, total: 12 } },
      moraleTokens: [],
    };
    const state = deserialize(raw);
    expect(state.actedPieceIds).toBeInstanceOf(Set);
    expect(state.actedPieceIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getTotalMorale
// ---------------------------------------------------------------------------

describe('getTotalMorale', () => {
  test('returns uncommitted + map tokens', () => {
    const state = createInitialState();
    state.morale.france.uncommitted = 3;
    state.moraleTokens = [
      { side: 'france', localeId: 1 },
      { side: 'france', localeId: 2 },
      { side: 'austria', localeId: 3 },
    ];
    expect(getTotalMorale('france', state)).toBe(5); // 3 + 2
    expect(getTotalMorale('austria', state)).toBe(1); // 0 + 1
  });

  test('returns uncommitted when no map tokens', () => {
    const state = createInitialState();
    expect(getTotalMorale('france', state)).toBe(3);
    expect(getTotalMorale('austria', state)).toBe(0);
  });

  test('handles zero morale', () => {
    const state = createInitialState();
    state.morale.france.uncommitted = 0;
    expect(getTotalMorale('france', state)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resetCommandPoints
// ---------------------------------------------------------------------------

describe('resetCommandPoints', () => {
  test('resets commandPoints to 3', () => {
    const state = createInitialState();
    state.commandPoints = 0;
    const next = resetCommandPoints(state);
    expect(next.commandPoints).toBe(3);
  });

  test('clears actedPieceIds', () => {
    const state = createInitialState();
    state.actedPieceIds.add('FR-INF-1');
    const next = resetCommandPoints(state);
    expect(next.actedPieceIds.size).toBe(0);
  });

  test('clears crossingTraffic', () => {
    const state = createInitialState();
    state.crossingTraffic = { 'c1': [{ pieceId: 'FR-INF-1', steps: 1 }] };
    const next = resetCommandPoints(state);
    expect(next.crossingTraffic).toEqual({});
  });

  test('does not mutate original state', () => {
    const state = createInitialState();
    state.commandPoints = 1;
    const next = resetCommandPoints(state);
    expect(state.commandPoints).toBe(1);
    expect(next.commandPoints).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// updatePiece
// ---------------------------------------------------------------------------

describe('updatePiece', () => {
  test('applies patch to piece', () => {
    const state = createInitialState();
    state.pieces['FR-INF-1'] = { id: 'FR-INF-1', strength: 3, disordered: false };
    const next = updatePiece(state, 'FR-INF-1', { strength: 1, disordered: true });
    expect(next.pieces['FR-INF-1'].strength).toBe(1);
    expect(next.pieces['FR-INF-1'].disordered).toBe(true);
  });

  test('does not mutate original', () => {
    const state = createInitialState();
    state.pieces['FR-INF-1'] = { id: 'FR-INF-1', strength: 3 };
    updatePiece(state, 'FR-INF-1', { strength: 1 });
    expect(state.pieces['FR-INF-1'].strength).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// addLog
// ---------------------------------------------------------------------------

describe('addLog', () => {
  test('appends log entry', () => {
    const state = createInitialState();
    const next = addLog(state, 'Test event');
    expect(next.log.length).toBe(1);
    expect(next.log[0].message).toBe('Test event');
    expect(next.log[0].round).toBe(1);
  });

  test('does not mutate original', () => {
    const state = createInitialState();
    addLog(state, 'Event');
    expect(state.log.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getRoundTime
// ---------------------------------------------------------------------------

describe('getRoundTime', () => {
  test('returns correct time for known rounds', () => {
    expect(getRoundTime(1)).toBe('6:00AM');
    expect(getRoundTime(7)).toBe('12:00PM');
    expect(getRoundTime(16)).toBe('9:00PM');
  });

  test('returns fallback for unknown round', () => {
    expect(getRoundTime(99)).toBe('Round 99');
  });
});

// ---------------------------------------------------------------------------
// createPieceState
// ---------------------------------------------------------------------------

describe('createPieceState', () => {
  test('creates infantry piece', () => {
    const piece = createPieceState('FR-INF-1', { type: 'infantry', maxStrength: 3 });
    expect(piece.id).toBe('FR-INF-1');
    expect(piece.side).toBe(SIDES.FRANCE);
    expect(piece.type).toBe('infantry');
    expect(piece.strength).toBe(3);
    expect(piece.faceUp).toBe(false);
    expect(piece.disordered).toBe(false);
    expect(piece.position).toBe('reserve');
  });

  test('creates Austrian piece from AU prefix', () => {
    const piece = createPieceState('AU-CAV-1', { type: 'cavalry', maxStrength: 2 });
    expect(piece.side).toBe(SIDES.AUSTRIA);
  });

  test('disordered flag is set when passed', () => {
    const piece = createPieceState('FR-INF-1', { type: 'infantry', maxStrength: 2 }, true);
    expect(piece.disordered).toBe(true);
  });
});
