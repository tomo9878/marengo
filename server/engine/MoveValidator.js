'use strict';

/**
 * MoveValidator.js
 * 合法アクションの生成・検証
 *
 * 各関数は「このアクションは合法か？」または
 * 「この駒が取れる合法な手は何か？」を答える。
 * 状態は変更しない（純粋関数）。
 */

const { SIDES, PIECE_TYPES } = require('./GameState');
const map = require('./MapGraph');

// ---------------------------------------------------------------------------
// マップ入場の定数
// ---------------------------------------------------------------------------

const BORMIDA_ENTRY_LOCALE_IDX = 1; // ボルミダ川渡河地点（エリアidx=1、ユーザー確認済み）
const ARTILLERY_ENTRY_MIN_ROUND = 2; // 7AM = round 2 (per scenarios.json artilleryAvailableFrom)
const MAX_ENTRIES_PER_TURN = 4;

// ---------------------------------------------------------------------------
// 司令コスト
// ---------------------------------------------------------------------------

const COMMAND_COST = Object.freeze({
  cross_country_march: 1,   // 悪路行軍
  road_march:          1,   // 道路行軍（側道含む）
  major_road_march:    0,   // 主要道路のみの道路行軍
  defensive_march:     0,   // 防御行軍（完全ブロックに必要な数まで）
  continuation_march:  0,   // 継続行軍（騎兵）
  raid:                3,   // 急襲
  assault:             3,   // 突撃
  bombardment:         0,   // 砲撃（宣言・完遂とも無料）
  reorganize:          0,   // 再編成（コストは別途計算）
});

// ---------------------------------------------------------------------------
// 共通ヘルパー
// ---------------------------------------------------------------------------

/**
 * 駒がアクションを実行できるか（基本チェック）。
 * @param {object} piece
 * @param {object} state
 * @returns {boolean}
 */
function canAct(piece, state) {
  // 除去済み
  if (piece.strength <= 0) return false;
  // 同ターンに既に司令を消費するアクションを実施した
  if (state.actedPieceIds.has(piece.id)) return false;
  return true;
}

/**
 * 駒がリザーブにいるか判定する。
 * @param {object} piece
 * @returns {boolean}
 */
function inReserve(piece) {
  return piece.position === 'reserve';
}

/**
 * 駒がアプローチにいるか判定する。
 * @param {object} piece
 * @returns {{ isApproach: boolean, edgeIdx: number | null }}
 */
function getApproachInfo(piece) {
  const m = piece.position?.match(/^approach_(\d+)$/);
  if (!m) return { isApproach: false, edgeIdx: null };
  return { isApproach: true, edgeIdx: parseInt(m[1], 10) };
}

/**
 * 敵側の side 文字列を返す。
 */
function enemySide(side) {
  return side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
}

// ---------------------------------------------------------------------------
// 悪路行軍（Section 7）
// ---------------------------------------------------------------------------

/**
 * 悪路行軍の合法な移動先を返す。
 *
 * リザーブから:
 *   - 同ロケールのアプローチをブロック（向かい側が敵占拠の場合、防御行軍として扱われる）
 *   - 隣接ロケールのリザーブへ（司令+1消費）
 * アプローチから:
 *   - 同ロケールのリザーブへ
 *   - 隣接ロケールのリザーブへ（向かい側アプローチ経由、敵占拠でない場合）
 *
 * 混乱状態の駒はアプローチをブロックできない（ただし移動は可）。
 *
 * @param {object} piece
 * @param {object} state
 * @returns {Array<MoveAction>}
 */
function getLegalCrossCountryMoves(piece, state) {
  if (!canAct(piece, state)) return [];
  if (piece.disordered) return []; // 混乱中は行軍不可
  const results = [];
  const { isApproach, edgeIdx } = getApproachInfo(piece);

  if (inReserve(piece)) {
    // 1. 同ロケール内のアプローチへ（混乱中は不可）
    if (!piece.disordered) {
      const locale = map.getLocale(piece.localeId);
      for (let i = 0; i < locale.edges.length; i++) {
        const edge = locale.edges[i];
        if (map.isImpassable(piece.localeId, i)) continue;
        if (edge.adj_area_idx === null || edge.adj_area_idx === undefined) continue;

        const opposite = map.getOppositeApproach(piece.localeId, i);
        const oppOccupant = opposite ? map.getLocaleOccupant(opposite.localeIdx, state) : null;
        const isDefensive = oppOccupant !== enemySide(piece.side);

        results.push({
          type: isDefensive ? 'defensive_march' : 'cross_country_march',
          pieceId: piece.id,
          from: { localeId: piece.localeId, position: 'reserve' },
          to:   { localeId: piece.localeId, position: `approach_${i}` },
          commandCost: isDefensive ? COMMAND_COST.defensive_march : COMMAND_COST.cross_country_march,
        });
      }
    }

    // 2. 隣接ロケールのリザーブへ（悪路行軍・司令1消費）
    for (const { adjIdx, myEdgeIdx } of map.getAdjacent(piece.localeId)) {
      if (map.isImpassable(piece.localeId, myEdgeIdx)) continue;
      if (map.isOverCapacity(adjIdx, piece.side, state)) continue;
      const occupant = map.getLocaleOccupant(adjIdx, state);
      if (occupant === enemySide(piece.side)) continue; // 敵占拠ロケールへは悪路行軍不可
      results.push({
        type: 'cross_country_march',
        pieceId: piece.id,
        from: { localeId: piece.localeId, position: 'reserve' },
        to:   { localeId: adjIdx, position: 'reserve' },
        commandCost: COMMAND_COST.cross_country_march,
      });
    }
  } else if (isApproach) {
    // 3. アプローチ → 同ロケールのリザーブ
    results.push({
      type: 'cross_country_march',
      pieceId: piece.id,
      from: { localeId: piece.localeId, position: piece.position },
      to:   { localeId: piece.localeId, position: 'reserve' },
      commandCost: COMMAND_COST.cross_country_march,
    });

    // 4. アプローチ → 隣接ロケールのリザーブ（向かい側経由）
    const opposite = map.getOppositeApproach(piece.localeId, edgeIdx);
    if (opposite) {
      const occupant = map.getLocaleOccupant(opposite.localeIdx, state);
      if (occupant !== enemySide(piece.side) && !map.isOverCapacity(opposite.localeIdx, piece.side, state)) {
        results.push({
          type: 'cross_country_march',
          pieceId: piece.id,
          from: { localeId: piece.localeId, position: piece.position },
          to:   { localeId: opposite.localeIdx, position: 'reserve' },
          commandCost: COMMAND_COST.cross_country_march,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 道路行軍（Section 8）
// ---------------------------------------------------------------------------

/**
 * 道路行軍の合法な移動先を返す（最大3ロケール先まで）。
 * リザーブからのみ開始できる。
 *
 * @param {object} piece
 * @param {object} state
 * @returns {Array<MoveAction>}
 */
function getLegalRoadMoves(piece, state) {
  if (!canAct(piece, state)) return [];
  if (piece.disordered) return []; // 混乱中は行軍不可
  if (!inReserve(piece)) return [];

  const MAX_STEPS = 3;

  // BFS でステップシミュレーション。
  // 各横断（road edge）を個別に追跡し、交通制限を適用する。
  //
  // BFS ノード: { locale, lastCrossStep, path, majorOnly, crossingPath }
  //   locale:        現在地ロケールidx
  //   lastCrossStep: 直前の横断で使用したステップ数（0 = まだ横断なし）
  //   path:          経由ロケールのリスト（起点含む）
  //   majorOnly:     ここまでの全エッジが thick road か
  //   crossingPath:  横断記録 [ { canonicalEdgeId, direction, step } ]
  //
  // 同じ (dest, isMajorRoadOnly) の組み合わせは最良のものだけを保持する。

  const bestByKey = new Map(); // key: `${destLocale}:${majorOnly}` → action

  const queue = [{
    locale:        piece.localeId,
    lastCrossStep: 0,
    path:          [piece.localeId],
    majorOnly:     true,
    crossingPath:  [],
  }];

  while (queue.length > 0) {
    const { locale, lastCrossStep, path, majorOnly, crossingPath } = queue.shift();

    const nextMinStep = lastCrossStep + 1;
    if (nextMinStep > MAX_STEPS) continue;

    // 隣接ロケールへの全道路エッジを取得し、(adjIdx, newMajorOnly) ごとに
    // 最良エッジ（最小 minStep）を選択する。
    const bestEdgeByDest = new Map(); // key: `${adjIdx}:${newMajorOnly}` → {adjIdx, canonicalId, rt, minStep, direction, newMajorOnly}

    for (const { adjIdx, myEdgeIdx } of map.getAdjacent(locale)) {
      // ループ防止: すでに経路中にあるロケールはスキップ
      if (path.includes(adjIdx)) continue;

      const rt = map.getRoadType(locale, myEdgeIdx);
      if (rt !== 'thick' && rt !== 'thin') continue;
      if (map.isImpassable(locale, myEdgeIdx)) continue;
      if (rt === 'thin' && !map.canSideUseThinRoad(locale, myEdgeIdx, piece.side)) continue;

      const direction   = `${locale}->${adjIdx}`;
      const canonicalId = map.getCanonicalCrossingId(locale, myEdgeIdx);
      if (!canonicalId) continue;

      const { canPass, minStep } = map.checkCrossingTraffic(canonicalId, direction, nextMinStep, state);
      if (!canPass) continue;

      const newMajorOnly = majorOnly && rt === 'thick';
      const edgeKey = `${adjIdx}:${newMajorOnly}`;
      const prev = bestEdgeByDest.get(edgeKey);
      if (!prev || minStep < prev.minStep) {
        bestEdgeByDest.set(edgeKey, { adjIdx, canonicalId, rt, minStep, direction, newMajorOnly, myEdgeIdx });
      }
    }

    for (const exp of bestEdgeByDest.values()) {
      const { adjIdx, canonicalId, rt, minStep, direction, newMajorOnly } = exp;
      const destLocale = adjIdx;

      // 目的地の到達可能性チェック
      if (map.isOverCapacity(destLocale, piece.side, state)) continue;
      if (map.getLocaleOccupant(destLocale, state) === enemySide(piece.side)) continue;

      const commandCost  = newMajorOnly ? COMMAND_COST.major_road_march : COMMAND_COST.road_march;
      const newPath      = [...path, destLocale];
      const newCrossPath = [...crossingPath, { canonicalEdgeId: canonicalId, direction, step: minStep }];

      const action = {
        type:           'road_march',
        pieceId:        piece.id,
        from:           { localeId: piece.localeId, position: 'reserve' },
        to:             { localeId: destLocale, position: 'reserve' },
        path:           newPath,
        steps:          minStep,
        commandCost,
        isMajorRoadOnly: newMajorOnly,
        crossingPath:   newCrossPath,
      };

      // 同じ (dest, majorOnly) なら commandCost→steps が最小のものだけ保持
      const resultKey = `${destLocale}:${newMajorOnly}`;
      const existing  = bestByKey.get(resultKey);
      if (!existing ||
          commandCost < existing.commandCost ||
          (commandCost === existing.commandCost && minStep < existing.steps)) {
        bestByKey.set(resultKey, action);
      }

      // BFS 継続
      queue.push({
        locale:        destLocale,
        lastCrossStep: minStep,
        path:          newPath,
        majorOnly:     newMajorOnly,
        crossingPath:  newCrossPath,
      });
    }
  }

  return [...bestByKey.values()];
}

// ---------------------------------------------------------------------------
// 騎兵の継続行軍（Section 12）
// ---------------------------------------------------------------------------

/**
 * 継続行軍の合法な移動先を返す（騎兵のみ）。
 * リザーブで行軍を終了した後にアプローチをブロックできる。
 *
 * @param {object} piece
 * @param {object} state
 * @param {number | null} lastRoadLocaleId - 道路行軍の最終ロケール（道路行軍後の場合）
 * @returns {Array<MoveAction>}
 */
function getLegalContinuationMoves(piece, state, lastRoadLocaleId = null) {
  if (piece.type !== PIECE_TYPES.CAVALRY) return [];
  if (!inReserve(piece)) return [];

  const results = [];
  const locale = map.getLocale(piece.localeId);

  for (let i = 0; i < locale.edges.length; i++) {
    if (map.isImpassable(piece.localeId, i)) continue;
    const edge = locale.edges[i];
    if (edge.adj_area_idx === null || edge.adj_area_idx === undefined) continue;

    // アプローチの向かい側が敵占拠でなければならない
    const opposite = map.getOppositeApproach(piece.localeId, i);
    if (!opposite) continue;
    const occupant = map.getLocaleOccupant(opposite.localeIdx, state);
    if (occupant !== enemySide(piece.side)) continue;

    // 道路行軍後の継続行軍はその道路に沿ったアプローチのみ
    if (lastRoadLocaleId !== null) {
      const roadType = map.getRoadTypeBetween(lastRoadLocaleId, piece.localeId);
      if (!roadType || roadType === 'none') continue;
      // TODO: より厳密な道路方向チェック
    }

    results.push({
      type: 'continuation_march',
      pieceId: piece.id,
      from: { localeId: piece.localeId, position: 'reserve' },
      to:   { localeId: piece.localeId, position: `approach_${i}` },
      commandCost: COMMAND_COST.continuation_march,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 急襲（Section 9）
// ---------------------------------------------------------------------------

/**
 * 急襲の合法な対象を返す。
 *
 * リザーブまたはアプローチから、隣接ロケールへ。
 * 対象アプローチが完全ブロックされていない場合のみ実施可能。
 * 混乱した駒は急襲不可。
 *
 * @param {object} piece
 * @param {object} state
 * @returns {Array<RaidAction>}
 */
function getLegalRaids(piece, state) {
  if (!canAct(piece, state)) return [];
  if (piece.disordered) return [];

  const results = [];
  const { isApproach, edgeIdx } = getApproachInfo(piece);

  const checkTarget = (targetLocaleIdx, defEdgeIdx) => {
    // 対象ロケールが敵占拠であること
    if (map.getLocaleOccupant(targetLocaleIdx, state) !== enemySide(piece.side)) return;
    // アプローチが通行不可でないこと
    if (map.isImpassable(piece.localeId, defEdgeIdx)) return;
    // 完全ブロックされていないこと（完全ブロックは急襲不可）
    if (map.isFullyBlocked(targetLocaleIdx, defEdgeIdx, state)) return;

    results.push({
      type: 'raid',
      pieceId: piece.id,
      fromLocaleId:    piece.localeId,
      fromPosition:    piece.position,
      targetLocaleId:  targetLocaleIdx,
      defenseEdgeIdx:  defEdgeIdx,
      commandCost:     COMMAND_COST.raid,
    });
  };

  if (inReserve(piece)) {
    // リザーブ → 隣接ロケール（全方向）
    for (const { adjIdx, myEdgeIdx } of map.getAdjacent(piece.localeId)) {
      const opposite = map.getOppositeApproach(piece.localeId, myEdgeIdx);
      if (opposite) checkTarget(adjIdx, opposite.edgeIdx);
    }
  } else if (isApproach) {
    // アプローチ → 向かい側ロケール
    const opposite = map.getOppositeApproach(piece.localeId, edgeIdx);
    if (opposite) checkTarget(opposite.localeIdx, opposite.edgeIdx);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 突撃（Section 11）
// ---------------------------------------------------------------------------

/**
 * 突撃の合法な対象アプローチを返す。
 *
 * アプローチにいる駒のみ突撃可能。
 * 向かい側アプローチが完全または部分ブロックされていること。
 * 混乱した駒は突撃不可。
 *
 * @param {object} piece
 * @param {object} state
 * @returns {Array<AssaultAction>}
 */
function getLegalAssaults(piece, state) {
  if (!canAct(piece, state)) return [];
  if (piece.disordered) return [];

  const { isApproach, edgeIdx } = getApproachInfo(piece);
  if (!isApproach) return [];

  const opposite = map.getOppositeApproach(piece.localeId, edgeIdx);
  if (!opposite) return [];

  // 向かい側アプローチが完全または部分ブロックされていること
  const fullyBlocked   = map.isFullyBlocked(opposite.localeIdx, opposite.edgeIdx, state);
  const partialBlocked = map.isPartiallyBlocked(opposite.localeIdx, opposite.edgeIdx, state);
  if (!fullyBlocked && !partialBlocked) return [];

  // 対象ロケールが敵占拠であること
  if (map.getLocaleOccupant(opposite.localeIdx, state) !== enemySide(piece.side)) return [];

  return [{
    type: 'assault',
    pieceId: piece.id,
    attackLocaleId:  piece.localeId,
    attackEdgeIdx:   edgeIdx,
    defenseLocaleId: opposite.localeIdx,
    defenseEdgeIdx:  opposite.edgeIdx,
    commandCost:     COMMAND_COST.assault,
  }];
}

// ---------------------------------------------------------------------------
// 砲撃（Section 10）
// ---------------------------------------------------------------------------

/**
 * 砲撃の合法な対象を返す。砲兵のみ。
 * アプローチにいる砲兵が、向かい側ロケールへ砲撃。
 *
 * @param {object} piece
 * @param {object} state
 * @returns {Array<BombardAction>}
 */
function getLegalBombardments(piece, state) {
  if (piece.type !== PIECE_TYPES.ARTILLERY) return [];
  if (!canAct(piece, state)) return [];
  if (piece.disordered) return [];

  const { isApproach, edgeIdx } = getApproachInfo(piece);
  if (!isApproach) return []; // リザーブからは砲撃不可

  // 砲兵ペナルティがある場合は砲撃不可
  if (map.hasArtilleryPenalty(piece.localeId, edgeIdx)) return [];

  const opposite = map.getOppositeApproach(piece.localeId, edgeIdx);
  if (!opposite) return [];

  // 向かい側アプローチにも砲兵ペナルティがあれば防御砲撃不可（攻撃側の砲撃は別）
  // 対象ロケールに敵がいること
  if (map.getLocaleOccupant(opposite.localeIdx, state) !== enemySide(piece.side)) return [];

  // 既に砲撃宣言済みでないこと
  if (state.pendingBombardment?.artilleryId === piece.id) return [];

  return [{
    type: 'bombardment_declare',
    pieceId: piece.id,
    fromLocaleId:   piece.localeId,
    fromEdgeIdx:    edgeIdx,
    targetLocaleId: opposite.localeIdx,
    commandCost:    COMMAND_COST.bombardment,
  }];
}

// ---------------------------------------------------------------------------
// 再編成（Section 14）
// ---------------------------------------------------------------------------

/**
 * 再編成アクションが可能かチェックする。フランス軍のみ。
 *
 * @param {number} localeId
 * @param {object} state
 * @returns {boolean}
 */
function canReorganize(localeId, state) {
  // フランス軍のみ
  if (state.activePlayer !== SIDES.FRANCE) return false;
  // ロケール内にフランスの混乱した駒があること
  const disorderedPieces = Object.values(state.pieces).filter(
    p => p.localeId === localeId && p.side === SIDES.FRANCE && p.disordered
  );
  return disorderedPieces.length > 0;
}

// ---------------------------------------------------------------------------
// マップ入場（オーストリア）
// ---------------------------------------------------------------------------

/**
 * オーストリアのマップ外駒をマップに入場させる合法アクションを返す。
 * ポンツーン橋: 最初の入場は0CP、以降は1CPずつ消費。最大4駒/ターン。
 * 砲兵はラウンド2（7AM）以降のみ入場可能。
 *
 * @param {object} state
 * @returns {Array<EnterMapAction>}
 */
function getLegalEntryActions(state) {
  // オーストリアのターンかつオーストリアが制御権を持つ場合のみ
  if (state.activePlayer !== SIDES.AUSTRIA) return [];
  if (state.controlToken.holder !== SIDES.AUSTRIA) return [];
  if (state.pendingInterruption) return [];

  // 最大入場数チェック
  const entriesThisTurn = state.entriesThisTurn ?? 0;
  if (entriesThisTurn >= MAX_ENTRIES_PER_TURN) return [];

  // このアクションのコストを計算
  const cost = entriesThisTurn === 0 ? 0 : 1;
  if (cost > state.commandPoints) return [];

  // マップ外のオーストリア駒を取得
  const offMapPieces = Object.values(state.pieces).filter(
    p => p.side === SIDES.AUSTRIA && p.localeId === null && p.strength > 0
  );
  if (offMapPieces.length === 0) return [];

  // タイプ別にグループ化（type + maxStrength でユニーク）
  const groups = new Map();
  for (const piece of offMapPieces) {
    const key = `${piece.type}_${piece.maxStrength}`;
    if (!groups.has(key)) {
      groups.set(key, piece);
    }
  }

  const results = [];
  for (const [, piece] of groups) {
    // 砲兵はラウンド2以降のみ
    if (piece.type === PIECE_TYPES.ARTILLERY && state.round < ARTILLERY_ENTRY_MIN_ROUND) {
      continue;
    }
    results.push({
      type: 'ENTER_MAP',
      pieceId: piece.id,
      cost,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 再編成アクション一覧（Section 14 拡張）
// ---------------------------------------------------------------------------

/**
 * 再編成アクションの一覧を返す（フランス軍のみ）。
 * @param {object} state
 * @returns {Array}
 */
function getLegalReorganizeActions(state) {
  if (state.activePlayer !== SIDES.FRANCE) return [];
  if (state.controlToken.holder !== SIDES.FRANCE) return [];
  if (state.pendingInterruption) return [];
  // 混乱したフランス駒があるロケールを収集
  const localesWithDisordered = new Set();
  for (const piece of Object.values(state.pieces)) {
    if (piece.side === SIDES.FRANCE && piece.disordered && piece.localeId !== null) {
      localesWithDisordered.add(piece.localeId);
    }
  }

  const results = [];
  for (const localeId of localesWithDisordered) {
    const disorderedPieceIds = Object.values(state.pieces)
      .filter(p => p.localeId === localeId && p.side === SIDES.FRANCE && p.disordered)
      .map(p => p.id);
    // CP = 再編成する駒の数。CP不足なら不可
    const commandCost = disorderedPieceIds.length;
    if (state.commandPoints < commandCost) continue;

    results.push({
      type: 'reorganize',
      localeId,
      disorderedPieceIds,
      commandCost,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 統合: 駒が取れる全合法アクション
// ---------------------------------------------------------------------------

/**
 * 指定された駒が取れる全合法アクションを返す。
 * @param {string} pieceId
 * @param {object} state
 * @returns {Array<Action>}
 */
function getLegalActions(pieceId, state) {
  const piece = state.pieces[pieceId];
  if (!piece) return [];
  if (piece.localeId === null) return []; // オフマップ駒は行動不可
  if (piece.side !== state.controlToken.holder) return []; // 制御権チェック
  if (state.pendingInterruption) return []; // インタラプション中は通常アクション不可

  return [
    ...getLegalCrossCountryMoves(piece, state),
    ...getLegalRoadMoves(piece, state),
    ...getLegalRaids(piece, state),
    ...getLegalAssaults(piece, state),
    ...getLegalBombardments(piece, state),
  ];
}

/**
 * 現在の状態で制御権を持つプレイヤーが取れる全アクション一覧。
 * @param {object} state
 * @returns {Array<Action>}
 */
function getAllLegalActions(state) {
  if (state.pendingInterruption) return [];
  const side = state.controlToken.holder;
  const pieceActions = Object.values(state.pieces)
    .filter(p => p.side === side)
    .flatMap(p => getLegalActions(p.id, state));
  const entryActions = getLegalEntryActions(state);
  const reorganizeActions = getLegalReorganizeActions(state);
  return [...pieceActions, ...entryActions, ...reorganizeActions];
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

module.exports = {
  COMMAND_COST,
  BORMIDA_ENTRY_LOCALE_IDX,
  ARTILLERY_ENTRY_MIN_ROUND,
  MAX_ENTRIES_PER_TURN,
  canAct,
  inReserve,
  getApproachInfo,
  enemySide,
  getLegalCrossCountryMoves,
  getLegalRoadMoves,
  getLegalContinuationMoves,
  getLegalRaids,
  getLegalAssaults,
  getLegalBombardments,
  canReorganize,
  getLegalReorganizeActions,
  getLegalEntryActions,
  getLegalActions,
  getAllLegalActions,
};
