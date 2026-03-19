'use strict';

/**
 * stateFactory.js
 * テスト用の最小ゲーム状態を生成するヘルパー群
 */

const { SIDES, PHASES, PIECE_TYPES, INTERRUPTION } = require('../../server/engine/GameState');

// ---------------------------------------------------------------------------
// 基本状態生成
// ---------------------------------------------------------------------------

/**
 * 最小ゲーム状態を生成する。
 * @returns {object} GameState
 */
function createMinimalState(overrides = {}) {
  return {
    round: 1,
    activePlayer: SIDES.AUSTRIA,
    phase: PHASES.ACTION,
    controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
    pendingInterruption: null,
    commandPoints: 3,
    morale: {
      france:  { uncommitted: 3, total: 12 },
      austria: { uncommitted: 0, total: 12 },
    },
    moraleTokens: [],
    pieces: {},
    pendingBombardment: null,
    crossingTraffic: {},
    actedPieceIds: new Set(),
    log: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 駒生成ヘルパー
// ---------------------------------------------------------------------------

/**
 * 駒の状態を生成する。
 * @param {string} id
 * @param {object} opts
 */
function makePiece(id, opts = {}) {
  const side = id.startsWith('FR') ? SIDES.FRANCE : SIDES.AUSTRIA;
  return {
    id,
    side,
    type: opts.type ?? PIECE_TYPES.INFANTRY,
    maxStrength: opts.maxStrength ?? 3,
    strength: opts.strength ?? (opts.maxStrength ?? 3),
    faceUp: opts.faceUp ?? false,
    disordered: opts.disordered ?? false,
    localeId: opts.localeId ?? 10,
    position: opts.position ?? 'reserve',
    actedThisTurn: opts.actedThisTurn ?? false,
  };
}

/**
 * 単純な2ロケール対峙シナリオを作成する。
 *
 * ロケール A (localeA) にフランス駒、ロケール B (localeB) にオーストリア駒。
 * A の edge 0 は B の edge 0 に向いている（架空の接続）。
 * MapGraph は実マップデータを使うため、localeA と localeB は実際に隣接している
 * ロケール idx を指定すること。
 *
 * デフォルト: フランスが locale 2 (エリア_3)、オーストリアが locale 1 (エリア_2)。
 * locale 2 の edge 1 が locale 1 に向いている（road_type: thick）。
 * locale 1 の edge 2 が locale 2 に向いている。
 */
function createTwoLocaleScenario({
  franceLocaleId = 2,
  austriaLocaleId = 1,
  franceEdgeIdx = 1,   // locale 2 の edge 1 → locale 1 方向
  austriaEdgeIdx = 2,  // locale 1 の edge 2 → locale 2 方向
  francePieces = [],
  austriaPieces = [],
} = {}) {
  const state = createMinimalState();

  // フランス駒を追加
  for (const p of francePieces) {
    state.pieces[p.id] = makePiece(p.id, { localeId: franceLocaleId, ...p });
  }

  // オーストリア駒を追加
  for (const p of austriaPieces) {
    state.pieces[p.id] = makePiece(p.id, { localeId: austriaLocaleId, ...p });
  }

  return {
    state,
    franceLocaleId,
    austriaLocaleId,
    franceEdgeIdx,
    austriaEdgeIdx,
  };
}

/**
 * 突撃シナリオを作成する。
 * フランスが locale 2 の approach_1 から locale 1 の approach_2 にいるオーストリアを攻撃。
 */
function createAssaultScenario({
  atkStrength = 3,
  defStrength = 3,
  extraAtkPieces = [],
  extraDefPieces = [],
} = {}) {
  const franceLocaleId = 2;
  const austriaLocaleId = 1;
  const franceEdgeIdx = 1;
  const austriaEdgeIdx = 2;

  const state = createMinimalState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
  });

  // 攻撃側: フランス歩兵がアプローチにいる
  state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
    localeId: franceLocaleId,
    position: `approach_${franceEdgeIdx}`,
    strength: atkStrength,
  });

  // 防御側: オーストリア歩兵がアプローチにいる
  state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
    localeId: austriaLocaleId,
    position: `approach_${austriaEdgeIdx}`,
    strength: defStrength,
  });

  // 追加の攻撃駒
  for (const p of extraAtkPieces) {
    state.pieces[p.id] = makePiece(p.id, { localeId: franceLocaleId, ...p });
  }

  // 追加の防御駒
  for (const p of extraDefPieces) {
    state.pieces[p.id] = makePiece(p.id, { localeId: austriaLocaleId, ...p });
  }

  return {
    state,
    franceLocaleId,
    austriaLocaleId,
    franceEdgeIdx,
    austriaEdgeIdx,
    atkAssaultIds: ['FR-INF-1', ...extraAtkPieces.map(p => p.id)],
    defAssaultIds: ['AU-INF-1', ...extraDefPieces.map(p => p.id)],
  };
}

/**
 * 急襲シナリオを作成する。
 */
function createRaidScenario({
  fromLocaleId = 2,
  targetLocaleId = 1,
  defenseEdgeIdx = 2,
  attackerStrength = 3,
  defenderStrength = 3,
  fullyBlocked = false,
} = {}) {
  const state = createMinimalState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
  });

  // 攻撃側
  state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
    localeId: fromLocaleId,
    position: 'reserve',
    strength: attackerStrength,
  });

  // 防御側
  state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
    localeId: targetLocaleId,
    position: fullyBlocked ? `approach_${defenseEdgeIdx}` : 'reserve',
    strength: defenderStrength,
  });

  if (fullyBlocked) {
    // narrow approach は 1 駒で完全ブロック
    // wide の場合は 2 駒必要だが、ここでは narrow を想定
  }

  return { state, fromLocaleId, targetLocaleId, defenseEdgeIdx };
}

/**
 * 砲撃シナリオを作成する。
 */
function createBombardmentScenario({
  artilleryLocaleId = 2,
  artilleryEdgeIdx = 1,
  targetLocaleId = 1,
  targetEdgeIdx = 2,
} = {}) {
  const state = createMinimalState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
  });

  // フランス砲兵がアプローチにいる
  state.pieces['FR-ART-1'] = makePiece('FR-ART-1', {
    type: PIECE_TYPES.ARTILLERY,
    maxStrength: 1,
    strength: 1,
    localeId: artilleryLocaleId,
    position: `approach_${artilleryEdgeIdx}`,
  });

  // オーストリア歩兵が対象ロケールにいる
  state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
    localeId: targetLocaleId,
    position: 'reserve',
    strength: 3,
  });

  return { state, artilleryLocaleId, artilleryEdgeIdx, targetLocaleId, targetEdgeIdx };
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

module.exports = {
  createMinimalState,
  makePiece,
  createTwoLocaleScenario,
  createAssaultScenario,
  createRaidScenario,
  createBombardmentScenario,
  SIDES,
  PHASES,
  PIECE_TYPES,
  INTERRUPTION,
};
