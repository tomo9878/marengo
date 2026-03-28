'use strict';

/**
 * TurnManager.js
 * ターンフローのオーケストレーション
 *
 * 各関数は { newState, interruption } ペアを返す。
 * interruption が null でなければクライアントの応答待ち。
 */

const { SIDES, PHASES, INTERRUPTION, cloneState, addLog, resetCommandPoints } = require('./GameState');
const map = require('./MapGraph');
const morale = require('./MoraleManager');
const combat = require('./CombatResolver');
const validator = require('./MoveValidator');
const scenarios = require('../../data/scenarios.json');

// ---------------------------------------------------------------------------
// ターン開始
// ---------------------------------------------------------------------------

/**
 * プレイヤーターンの開始処理。
 * 士気定期更新 → アプローチクリーンアップ → 司令ポイントリセット。
 * @param {object} state
 * @returns {GameState}
 */
function startPlayerTurn(state) {
  let next = cloneState(state);

  // 1. 士気定期更新
  next = morale.periodicMoraleUpdate(next.round, next);

  // 2. アプローチクリーンアップ
  next = applyApproachCleanup(next);

  // 3. フェーズをアクションフェーズへ
  next.phase = PHASES.ACTION;
  next = resetCommandPoints(next);

  return next;
}

// ---------------------------------------------------------------------------
// アプローチクリーンアップ
// ---------------------------------------------------------------------------

/**
 * アプローチクリーンアップ: アプローチにいる駒の向かい側ロケールが
 * 敵占拠でない場合、リザーブへ返す。
 * @param {object} state
 * @returns {GameState}
 */
function applyApproachCleanup(state) {
  let next = cloneState(state);

  for (const piece of Object.values(next.pieces)) {
    if (!piece.position.startsWith('approach_')) continue;
    if (piece.strength <= 0) continue;

    const edgeIdx = parseInt(piece.position.replace('approach_', ''), 10);
    const opposite = map.getOppositeApproach(piece.localeId, edgeIdx);
    if (!opposite) continue;

    const occupant = map.getLocaleOccupant(opposite.localeIdx, next);
    const enemy = piece.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;

    // 向かい側が敵占拠でなければリザーブへ
    if (occupant !== enemy) {
      next.pieces[piece.id] = { ...next.pieces[piece.id], position: 'reserve' };
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// アクション実行
// ---------------------------------------------------------------------------

/**
 * アクションを実行する。
 * @param {object} action
 * @param {object} state
 * @returns {{ newState: GameState, interruption: object | null }}
 */
/**
 * 前のアクションで一時的に表向きになった駒を裏に戻す。
 * 砲撃宣言中の砲兵（pendingBombardment.artilleryId）は対象外。
 * @param {GameState} state
 * @returns {GameState} 変更があれば新しい state、なければそのまま
 */
function _clearTransientFaceUp(state) {
  const bombArtId = state.pendingBombardment?.artilleryId;
  const needsClear = Object.values(state.pieces).some(p => p.faceUp && p.id !== bombArtId);
  if (!needsClear) return state;
  const next = cloneState(state);
  for (const [pid, piece] of Object.entries(next.pieces)) {
    if (piece.faceUp && pid !== bombArtId) {
      next.pieces[pid] = { ...piece, faceUp: false };
    }
  }
  return next;
}

function executeAction(action, state) {
  // 前のアクションで一時的に表向きになった駒を裏に戻す
  state = _clearTransientFaceUp(state);

  // #12: シャッフルは制御権に関係なくいつでも実行可能
  if (action.type === 'shuffle') {
    return executeShuffle(action, state);
  }

  // バリデーション: アクティブプレイヤーのみ
  if (state.controlToken.holder !== state.activePlayer) {
    throw new Error('Not active player turn');
  }
  if (state.pendingInterruption) {
    throw new Error('Pending interruption must be resolved first');
  }

  switch (action.type) {
    case 'cross_country_march':
    case 'defensive_march':
      return executeMarch(action, state);

    case 'road_march':
      return executeMarch(action, state);

    case 'continuation_march':
      return executeMarch(action, state);

    case 'raid':
      return initiateRaid(action, state);

    case 'assault':
      return initiateAssault(action, state);

    case 'bombardment_declare':
      return executeBombardmentDeclare(action, state);

    case 'bombardment_cancel':
      return executeBombardmentCancel(action, state);

    case 'bombardment_complete':
      return executeBombardmentComplete(action, state);

    case 'reorganize':
      return executeReorganize(action, state);

    case 'ENTER_MAP':
      return executeEnterMap(action, state);

    case 'end_turn': {
      const afterPhase = endActionPhase(state);

      // フランス特権: ラウンド11未満なら1トークン回収を選択できる
      if (state.activePlayer === SIDES.FRANCE && state.round < 11) {
        const recoverableTokens = morale.getRecoverableTokens(afterPhase);
        if (recoverableTokens.length > 0) {
          const interruption = {
            type: INTERRUPTION.FRANCE_MORALE_RECOVERY,
            waitingFor: SIDES.FRANCE,
            context: { recoverableTokens },
          };
          afterPhase.pendingInterruption = interruption;
          afterPhase.controlToken = { holder: SIDES.FRANCE, reason: INTERRUPTION.FRANCE_MORALE_RECOVERY };
          return { newState: afterPhase, interruption };
        }
      }

      const newState = startPlayerTurn(afterPhase);
      return { newState, interruption: null };
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/**
 * 道路行軍急襲の実行。
 * 騎兵が道路行軍中に敵占拠ロケールへ急襲するケース。
 * CPは道路行軍分のみ消費、急襲CP3は消費しない。
 * 勝利時はactedPieceIdsに追加しない（継続行軍可能）。
 */
function executeMarchRaid(action, state) {
  let next = cloneState(state);
  const piece = next.pieces[action.pieceId];
  if (!piece) throw new Error(`Piece not found: ${action.pieceId}`);

  // 道路行軍のCP消費（急襲CP3は消費しない）
  next.commandPoints -= action.commandCost ?? 0;

  // 横断交通制限を記録（急襲横断含む全横断）
  for (const { canonicalEdgeId, direction, step } of action.crossingPath ?? []) {
    if (!next.crossingTraffic[canonicalEdgeId]) next.crossingTraffic[canonicalEdgeId] = [];
    next.crossingTraffic[canonicalEdgeId].push({ pieceId: action.pieceId, steps: step, direction });
  }

  // 急襲横断を使用済みとして記録（同一横断2回使用禁止）
  if (action.raidCrossingId) {
    next.roadMarchRaidCrossings = [...(next.roadMarchRaidCrossings ?? []), action.raidCrossingId];
  }

  // actedPieceIdsには追加しない（急襲勝利時は継続行軍可能のため）
  // 急襲敗北時はprocessDefenseResponseで追加する

  const defSide = piece.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
  const defLocale = action.raidTargetLocaleId;

  const franceCanBlockThisRound = !(next.round === 1 && defSide === SIDES.FRANCE);
  const defenderReserve = franceCanBlockThisRound
    ? Object.values(next.pieces).filter(
        p => p.localeId === defLocale && p.side === defSide && p.position === 'reserve' && p.strength > 0
      )
    : [];

  const raidHistory = next.raidHistoryThisTurn ?? [];
  const isFirstRaidThroughApproach = !raidHistory.some(
    r => r.localeId === defLocale && r.edgeIdx === action.raidDefenseEdgeIdx
  );
  next.raidHistoryThisTurn = [...raidHistory, { localeId: defLocale, edgeIdx: action.raidDefenseEdgeIdx }];

  const interruption = {
    type: INTERRUPTION.DEFENSE_RESPONSE,
    waitingFor: defSide,
    context: {
      attackerPieceIds:        [action.pieceId],
      targetLocaleId:          defLocale,
      defenseEdgeIdx:          action.raidDefenseEdgeIdx,
      availableDefenders:      defenderReserve.map(p => p.id),
      maxResponse:             1,
      isFirstRaidThroughApproach,
      isRoadMarchRaid:         true,
      pieceStartLocaleId:      piece.localeId,
    },
  };

  next.pendingInterruption = interruption;
  next.controlToken = { holder: defSide, reason: INTERRUPTION.DEFENSE_RESPONSE };

  return { newState: next, interruption };
}

/**
 * 行軍アクションの実行。
 * pieceId（単体）と pieceIds（グループ、最大3駒）の両方に対応。
 */
function executeMarch(action, state) {
  // 道路行軍急襲は専用関数へ委譲
  if (action.type === 'road_march' && action.raidTargetLocaleId) {
    return executeMarchRaid(action, state);
  }

  // pieceId / pieceIds を正規化
  const pieceIds = (action.pieceIds && action.pieceIds.length > 0)
    ? [...action.pieceIds]
    : [action.pieceId];
  if (!pieceIds[0]) throw new Error('No pieces specified in march action');

  // グループ移動バリデーション
  if (pieceIds.length > 3) throw new Error('Group march limited to 3 pieces');
  if (pieceIds.length > 1) {
    const first = state.pieces[pieceIds[0]];
    if (!first) throw new Error(`Piece not found: ${pieceIds[0]}`);
    for (const pid of pieceIds.slice(1)) {
      const p = state.pieces[pid];
      if (!p) throw new Error(`Piece not found: ${pid}`);
      if (state.actedPieceIds.has(pid)) throw new Error(`Piece already acted this turn: ${pid}`);
      if (p.strength <= 0) throw new Error(`Piece has no strength: ${pid}`);
      if (p.disordered) throw new Error(`Piece is disordered: ${pid}`);
      if (p.side !== first.side) throw new Error(`Pieces not on same side`);
      if (p.localeId !== first.localeId) throw new Error(`Pieces not in same locale`);
      if (p.position !== first.position) throw new Error(`Pieces not in same position`);
    }
  }

  let next = cloneState(state);
  const destLocaleId = action.to.localeId;
  const movingSide = next.pieces[pieceIds[0]].side;

  // 全駒を移動
  for (const pid of pieceIds) {
    const piece = next.pieces[pid];
    if (!piece) throw new Error(`Piece not found: ${pid}`);
    next.pieces[pid] = {
      ...piece,
      localeId: destLocaleId,
      position: action.to.position,
      actedThisTurn: true,
    };
    // ロケール占拠履歴を更新（ロケール移動のみ）
    if (destLocaleId !== piece.localeId && destLocaleId !== null) {
      next.localeLastOccupant = { ...(next.localeLastOccupant ?? {}), [destLocaleId]: piece.side };
    }
  }

  // Section 14: 混乱ルール — 整列駒が混乱駒のいるロケールへ入ると全員混乱
  // 移動駒のいずれかが非混乱かつ目的地に味方混乱駒がいれば全員混乱
  const anyNonDisordered = pieceIds.some(pid => !state.pieces[pid].disordered);
  if (anyNonDisordered) {
    const disorderedInDest = Object.values(next.pieces).some(
      p => !pieceIds.includes(p.id) && p.localeId === destLocaleId && p.side === movingSide && p.disordered
    );
    if (disorderedInDest) {
      for (const pid of Object.keys(next.pieces)) {
        const p = next.pieces[pid];
        if (p.localeId === destLocaleId && p.side === movingSide) {
          next.pieces[pid] = { ...p, disordered: true };
        }
      }
    }
  }

  // #11: 砲撃自動取り消し — 砲兵が宣言したアプローチを離れた場合
  for (const pid of pieceIds) {
    if (next.pendingBombardment?.artilleryId === pid) {
      const origPiece = state.pieces[pid];
      if (origPiece.position !== action.to.position || origPiece.localeId !== action.to.localeId) {
        next.pendingBombardment = null;
        next.pieces[pid] = { ...next.pieces[pid], faceUp: false };
      }
    }
  }

  // 道路行軍: 横断交通制限を記録（代表駒で記録）
  if (action.type === 'road_march' && action.crossingPath) {
    for (const { canonicalEdgeId, direction, step } of action.crossingPath) {
      if (!next.crossingTraffic[canonicalEdgeId]) {
        next.crossingTraffic[canonicalEdgeId] = [];
      }
      next.crossingTraffic[canonicalEdgeId].push({ pieceId: pieceIds[0], steps: step, direction });
    }
  }

  // 司令ポイント消費・acted登録（全駒まとめて1CP）
  next.commandPoints -= action.commandCost ?? 0;
  if ((action.commandCost ?? 0) > 0) {
    for (const pid of pieceIds) {
      next.actedPieceIds.add(pid);
    }
  }

  // 入場直後の行軍完了: enteredThisTurn から削除して actedPieceIds に追加
  // （0CP道路行軍の場合も acted 扱いとする）
  if (!next.enteredThisTurn) next.enteredThisTurn = {};
  for (const pid of pieceIds) {
    if (next.enteredThisTurn[pid] !== undefined) {
      delete next.enteredThisTurn[pid];
      next.actedPieceIds.add(pid);
    }
  }

  // 継続行軍資格の更新
  if (!next.continuationEligiblePieces) next.continuationEligiblePieces = {};
  if (action.type === 'road_march' || action.type === 'cross_country_march') {
    // 騎兵がリザーブへ移動した場合（ロケール移動を伴う場合のみ）
    for (const pid of pieceIds) {
      const orig = state.pieces[pid];
      const moved = next.pieces[pid];
      if (
        moved &&
        moved.type === 'cavalry' &&
        moved.position === 'reserve' &&
        moved.localeId !== orig.localeId
      ) {
        next.continuationEligiblePieces[pid] = {
          fromLocaleId: action.type === 'road_march' ? orig.localeId : null,
        };
      }
    }
  } else if (action.type === 'continuation_march') {
    // 継続行軍実行後は資格を消去
    for (const pid of pieceIds) {
      delete next.continuationEligiblePieces[pid];
    }
  }

  return { newState: next, interruption: null };
}

/**
 * 急襲解決後の状態を適用するヘルパー。
 * initiateRaid（アプローチ攻撃の即時解決）と processDefenseResponse の両方から呼ばれる。
 *
 * @param {object} result    - combat.resolveRaid の返り値
 * @param {object} ctx       - { attackerPieceIds, targetLocaleId, defenseEdgeIdx,
 *                              attackFromApproach, isRoadMarchRaid }
 * @param {string} attackerSide - 攻撃側の陣営
 * @returns {{ newState, interruption }}
 */
function _applyRaidOutcome(result, ctx, attackerSide) {
  // result.newState は resolveRaid 内で cloneState 済み
  // morale.investMorale も内部で clone するのでそのまま渡す
  let st = result.newState;

  if (result.winner === 'defender') {
    // 防御側勝利: 防御側が士気トークン投入
    const defenderSide = attackerSide === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
    st = morale.investMorale(defenderSide, ctx.targetLocaleId, result.moraleInvestment, st);

    if (ctx.isRoadMarchRaid) {
      // 道路行軍急襲: 騎兵を表向き・行軍終了
      for (const pid of ctx.attackerPieceIds) {
        const p = st.pieces[pid];
        if (p) st.pieces[pid] = { ...p, faceUp: true };
        st.actedPieceIds.add(pid);
      }
      return { newState: st, interruption: null };
    }

    if (ctx.attackFromApproach) {
      // アプローチから攻撃 → 攻撃駒はその場に留まる、ATTACKER_APPROACHは不要
      return { newState: st, interruption: null };
    }

    // リザーブから攻撃 → ATTACKER_APPROACH インタラプション（クライアントで選択）
    const opposite = map.getOppositeApproach(ctx.targetLocaleId, ctx.defenseEdgeIdx);
    if (opposite) {
      const approachInt = {
        type: INTERRUPTION.ATTACKER_APPROACH,
        waitingFor: attackerSide,
        context: {
          attackerPieceIds: ctx.attackerPieceIds,
          attackLocaleId:   opposite.localeIdx,
          attackEdgeIdx:    opposite.edgeIdx,
        },
      };
      st.pendingInterruption = approachInt;
      st.controlToken = { holder: attackerSide, reason: INTERRUPTION.ATTACKER_APPROACH };
      return { newState: st, interruption: approachInt };
    }

    // getOppositeApproach が null の場合（想定外）: そのまま返す
    return { newState: st, interruption: null };

  } else {
    // 攻撃側勝利
    st.localeLastOccupant = {
      ...(st.localeLastOccupant ?? {}),
      [ctx.targetLocaleId]: attackerSide,
    };

    if (ctx.isRoadMarchRaid) {
      // 道路行軍急襲: 騎兵を表向き（actedPieceIds には追加しない → 継続行軍可能）
      for (const pid of ctx.attackerPieceIds) {
        const p = st.pieces[pid];
        if (p) st.pieces[pid] = { ...p, faceUp: true };
      }
    }

    const retreatInt = {
      type: INTERRUPTION.RETREAT_DESTINATION,
      waitingFor: result.retreatInfo.losingside,
      context: { ...result.retreatInfo, isRaid: true },
    };
    st.pendingInterruption = retreatInt;
    st.controlToken = { holder: result.retreatInfo.losingside, reason: INTERRUPTION.RETREAT_DESTINATION };
    return { newState: st, interruption: retreatInt };
  }
}

/**
 * 急襲の開始処理。
 *
 * - 攻撃がアプローチから: 防御対応なし、即時解決
 * - 攻撃がリザーブから:   DEFENSE_RESPONSE インタラプション生成
 */
function initiateRaid(action, state) {
  let next = cloneState(state);
  const piece = next.pieces[action.pieceId];

  // 司令ポイント消費
  next.commandPoints -= 3;
  next.actedPieceIds.add(action.pieceId);

  const attackerPieceIds = [action.pieceId];
  const defSide   = piece.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
  const defLocale = action.targetLocaleId;

  // 「最初の急襲」チェック
  const raidHistory = next.raidHistoryThisTurn ?? [];
  const isFirstRaidThroughApproach = !raidHistory.some(
    r => r.localeId === defLocale && r.edgeIdx === action.defenseEdgeIdx
  );
  next.raidHistoryThisTurn = [...raidHistory, { localeId: defLocale, edgeIdx: action.defenseEdgeIdx }];

  const attackFromApproach = action.fromPosition?.startsWith('approach_') ?? false;

  if (attackFromApproach) {
    // アプローチから攻撃: 防御対応なし、即時解決
    const result = combat.resolveRaid({
      attackerPieceIds,
      targetLocaleId:            defLocale,
      defenseEdgeIdx:            action.defenseEdgeIdx,
      defenseResponsePieceIds:   [],
      isFirstRaidThroughApproach,
    }, next);

    return _applyRaidOutcome(result, {
      attackerPieceIds,
      targetLocaleId:    defLocale,
      defenseEdgeIdx:    action.defenseEdgeIdx,
      attackFromApproach: true,
      isRoadMarchRaid:    false,
    }, piece.side);
  }

  // リザーブから攻撃: DEFENSE_RESPONSE インタラプション生成
  const franceCanBlockThisRound = !(next.round === 1 && defSide === SIDES.FRANCE);
  const defenderReserve = franceCanBlockThisRound
    ? Object.values(next.pieces).filter(
        p => p.localeId === defLocale && p.side === defSide && p.position === 'reserve' && p.strength > 0
      )
    : [];

  const interruption = {
    type: INTERRUPTION.DEFENSE_RESPONSE,
    waitingFor: defSide,
    context: {
      attackerPieceIds,
      targetLocaleId: defLocale,
      defenseEdgeIdx: action.defenseEdgeIdx,
      availableDefenders: defenderReserve.map(p => p.id),
      maxResponse: attackerPieceIds.length,
      isFirstRaidThroughApproach,
    },
  };

  next.pendingInterruption = interruption;
  next.controlToken = { holder: defSide, reason: INTERRUPTION.DEFENSE_RESPONSE };
  return { newState: next, interruption };
}

/**
 * 突撃の開始処理。
 * 防御先導駒のインタラプションを生成する。
 */
function initiateAssault(action, state) {
  let next = cloneState(state);
  const piece = next.pieces[action.pieceId];

  // 司令ポイント消費
  next.commandPoints -= 3;
  next.actedPieceIds.add(action.pieceId);

  const atkSide = piece.side;
  const defSide = atkSide === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;

  // 突撃参加駒: 攻撃側アプローチにいる全駒
  const atkPosKey = `approach_${action.attackEdgeIdx}`;
  const atkAssaultIds = Object.values(next.pieces)
    .filter(p => p.localeId === action.attackLocaleId && p.position === atkPosKey && p.side === atkSide && p.strength > 0)
    .map(p => p.id);

  // 防御参加駒: 防御側アプローチにいる全駒 + リザーブ
  const defPosKey = `approach_${action.defenseEdgeIdx}`;
  const defAssaultIds = Object.values(next.pieces)
    .filter(p => p.localeId === action.defenseLocaleId && p.side === defSide && p.strength > 0)
    .map(p => p.id);

  const interruption = {
    type: INTERRUPTION.ASSAULT_DEF_LEADERS,
    waitingFor: defSide,
    context: {
      attackLocaleId: action.attackLocaleId,
      attackEdgeIdx: action.attackEdgeIdx,
      defenseLocaleId: action.defenseLocaleId,
      defenseEdgeIdx: action.defenseEdgeIdx,
      atkAssaultIds,
      defAssaultIds,
      atkSide,
      defSide,
    },
  };

  next.pendingInterruption = interruption;
  next.controlToken = { holder: defSide, reason: INTERRUPTION.ASSAULT_DEF_LEADERS };

  return { newState: next, interruption };
}

/**
 * 砲撃宣言。
 */
function executeBombardmentDeclare(action, state) {
  let next = cloneState(state);

  // 砲兵を表向きに（宣言済み）
  next.pieces[action.pieceId] = { ...next.pieces[action.pieceId], faceUp: true };

  // 砲撃予約を登録
  next.pendingBombardment = {
    artilleryId: action.pieceId,
    targetLocaleId: action.targetLocaleId,
    defenseApproachIdx: action.fromEdgeIdx,
    declaredRound: next.round,
  };

  return { newState: next, interruption: null };
}

/**
 * 砲撃宣言の取り消し（#11）。
 * コスト・ペナルティなし。砲兵を裏向きに戻す。
 */
function executeBombardmentCancel(action, state) {
  let next = cloneState(state);

  const bombInfo = next.pendingBombardment;
  if (!bombInfo || bombInfo.artilleryId !== action.pieceId) {
    throw new Error('取り消し対象の砲撃宣言がありません');
  }

  next.pendingBombardment = null;
  next.pieces[action.pieceId] = { ...next.pieces[action.pieceId], faceUp: false };
  next = addLog(next, `砲兵 ${action.pieceId} の砲撃宣言を取り消し`);

  return { newState: next, interruption: null };
}

/**
 * 駒のシャッフル（#12）。
 * 制御権に関係なくいつでも実行可能。
 * 同じロケール・ポジションの複数の駒の順序を入れ替える（状態変化なし、バリデーションのみ）。
 */
function executeShuffle(action, state) {
  const { pieceIds, side } = action;
  if (!pieceIds || pieceIds.length < 2) {
    throw new Error('シャッフルには2つ以上の駒が必要です');
  }

  let next = cloneState(state);
  const pieces = pieceIds.map(id => {
    const p = next.pieces[id];
    if (!p) throw new Error(`駒が見つかりません: ${id}`);
    return p;
  });

  // シャッフルを実施するプレイヤーの駒であること
  if (side && !pieces.every(p => p.side === side)) {
    throw new Error('他の陣営の駒はシャッフルできません');
  }

  // 全駒が同じロケールとポジションにいること
  const { localeId, position } = pieces[0];
  if (!pieces.every(p => p.localeId === localeId && p.position === position)) {
    throw new Error('シャッフルは同じロケール・ポジションの駒のみ可能です');
  }

  // 済/未アクション駒の混在不可
  const actedCount = pieces.filter(p => state.actedPieceIds.has(p.id)).length;
  if (actedCount > 0 && actedCount < pieces.length) {
    throw new Error('アクション済み駒と未アクション駒を混在させてシャッフルすることはできません');
  }

  next = addLog(next, `駒 ${pieceIds.join(', ')} をシャッフル（ロケール: ${localeId}, ポジション: ${position}）`);

  return { newState: next, interruption: null };
}

/**
 * 砲撃完遂（次のターン）。
 * 防御側の被弾駒選択インタラプションを生成する。
 */
function executeBombardmentComplete(action, state) {
  let next = cloneState(state);
  const bombInfo = next.pendingBombardment;
  if (!bombInfo) throw new Error('No pending bombardment');

  // 対象駒の候補を取得
  const targets = combat.getBombardmentTargets(
    { artilleryId: bombInfo.artilleryId, targetLocaleId: bombInfo.targetLocaleId, defenseEdgeIdx: bombInfo.defenseApproachIdx },
    next
  );

  const artillery = next.pieces[bombInfo.artilleryId];
  if (!artillery) throw new Error('Artillery not found');

  const defSide = artillery.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;

  const interruption = {
    type: INTERRUPTION.BOMBARDMENT_REDUCTION,
    waitingFor: defSide,
    context: {
      artilleryId: bombInfo.artilleryId,
      targetLocaleId: bombInfo.targetLocaleId,
      defenseEdgeIdx: bombInfo.defenseApproachIdx,
      availableTargets: targets,
    },
  };

  next.pendingInterruption = interruption;
  next.controlToken = { holder: defSide, reason: INTERRUPTION.BOMBARDMENT_REDUCTION };

  return { newState: next, interruption };
}

/**
 * 再編成。
 */
function executeReorganize(action, state) {
  let next = cloneState(state);
  const { pieceIds, localeId } = action;

  if (!pieceIds || !Array.isArray(pieceIds) || pieceIds.length === 0) {
    return { newState: next, interruption: null };
  }

  // Section 14: 全員まとめてか0か
  // ロケールの全混乱駒を取得
  const allDisordered = Object.values(next.pieces).filter(
    p => p.localeId === localeId && p.side === SIDES.FRANCE && p.disordered
  ).map(p => p.id);

  // 全混乱駒を渡していること（部分再編成不可）
  if (pieceIds.length !== allDisordered.length) {
    throw new Error('ロケール内の全混乱駒をまとめて再編成する必要があります');
  }

  // 各駒のバリデーション
  for (const pid of pieceIds) {
    const piece = next.pieces[pid];
    if (!piece) throw new Error(`駒が見つかりません: ${pid}`);
    if (piece.side !== SIDES.FRANCE) throw new Error(`フランス軍の駒ではありません: ${pid}`);
    if (!piece.disordered) throw new Error(`混乱していません: ${pid}`);
    if (piece.localeId !== localeId) throw new Error(`指定ロケールにいません: ${pid}`);
  }

  // CP消費 = 再編成する駒の数（再編成した駒はactedPieceIdsに追加しない → 同ターン行動可能）
  next.commandPoints -= pieceIds.length;

  for (const pid of pieceIds) {
    next.pieces[pid] = { ...next.pieces[pid], disordered: false };
  }

  return { newState: next, interruption: null };
}

/**
 * マップ入場（オーストリア）。
 * ボルミダ川渡河点からマップへ入場させる。
 */
function executeEnterMap(action, state) {
  const { BORMIDA_ENTRY_LOCALE_IDX, ARTILLERY_ENTRY_MIN_ROUND, MAX_ENTRIES_PER_TURN } = validator;

  let next = cloneState(state);
  const piece = next.pieces[action.pieceId];

  // バリデーション
  if (!piece) throw new Error(`Piece not found: ${action.pieceId}`);
  if (piece.localeId !== null) throw new Error(`Piece is already on the map: ${action.pieceId}`);
  if (piece.side !== SIDES.AUSTRIA) throw new Error(`Only Austrian pieces can enter via Bormida: ${action.pieceId}`);

  const entriesThisTurn = next.entriesThisTurn ?? 0;
  if (entriesThisTurn >= MAX_ENTRIES_PER_TURN) {
    throw new Error(`Maximum entries per turn (${MAX_ENTRIES_PER_TURN}) reached`);
  }

  if (piece.type === 'artillery' && next.round < ARTILLERY_ENTRY_MIN_ROUND) {
    throw new Error(`Artillery cannot enter before round ${ARTILLERY_ENTRY_MIN_ROUND} (7AM)`);
  }

  // 全駒CP消費なし（主要道路・舟橋ともに）
  const cost = 0;

  // 司令ポイント消費
  next.commandPoints -= cost;

  // 駒をマップ上に配置（リザーブ、裏向き）
  next.pieces[action.pieceId] = {
    ...piece,
    localeId: BORMIDA_ENTRY_LOCALE_IDX,
    position: 'reserve',
    faceUp: false,
  };

  // ロケール占拠履歴を更新
  next.localeLastOccupant = { ...(next.localeLastOccupant ?? {}), [BORMIDA_ENTRY_LOCALE_IDX]: piece.side };

  // 入場カウントを更新
  next.entriesThisTurn = entriesThisTurn + 1;

  // 入場後の継続道路行軍ステップ数を設定
  // ステップ1(1駒目)→2ステップ追加行軍可、ステップ2→1ステップ、ステップ3以降→停止
  const ENTRY_MARCH_BONUS = 2;
  const remainingSteps = Math.max(0, ENTRY_MARCH_BONUS - entriesThisTurn);
  if (!next.enteredThisTurn) next.enteredThisTurn = {};
  next.enteredThisTurn[action.pieceId] = remainingSteps;

  if (remainingSteps === 0) {
    // 行軍不可（3駒目以降）: 入場地点で止まる
    next.actedPieceIds.add(action.pieceId);
  }
  // remainingSteps > 0 の場合は actedPieceIds に追加しない（道路行軍可能）

  // #10: 増援進入時の交通制限を記録
  const { BORMIDA_ENTRY_CROSSING_ID, BORMIDA_ENTRY_DIRECTION } = validator;
  if (!next.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID]) {
    next.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID] = [];
  }
  next.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID].push({
    pieceId: action.pieceId,
    steps: entriesThisTurn + 1,
    direction: BORMIDA_ENTRY_DIRECTION,
  });

  // ログ追加
  next = addLog(next, `オーストリア駒 ${action.pieceId} がボルミダ川よりマップに入場 (コスト: 0CP)`);

  return { newState: next, interruption: null };
}

// ---------------------------------------------------------------------------
// インタラプション処理
// ---------------------------------------------------------------------------

/**
 * 防御側の応答を処理する。
 * @param {object} response - インタラプションへの応答
 * @param {object} state
 * @returns {{ newState: GameState, interruption: object | null }}
 */
function processInterruption(response, state) {
  const intType = state.pendingInterruption?.type;
  if (!intType) throw new Error('No pending interruption');

  switch (intType) {
    case INTERRUPTION.DEFENSE_RESPONSE:
      return processDefenseResponse(response, state);

    case INTERRUPTION.ASSAULT_DEF_LEADERS:
      return processAssaultDefLeaders(response, state);

    case INTERRUPTION.ASSAULT_ATK_LEADERS:
      return processAssaultAtkLeaders(response, state);

    case INTERRUPTION.ASSAULT_DEF_ARTILLERY:
      return processAssaultDefArtillery(response, state);

    case INTERRUPTION.ASSAULT_COUNTER:
      return processAssaultCounter(response, state);

    case INTERRUPTION.ASSAULT_REDUCTIONS:
      return processAssaultReductions(response, state);

    case INTERRUPTION.BOMBARDMENT_REDUCTION:
      return processBombardmentReduction(response, state);

    case INTERRUPTION.RETREAT_DESTINATION:
      return processRetreatDestination(response, state);

    case INTERRUPTION.ATTACKER_APPROACH:
      return processAttackerApproach(response, state);

    case INTERRUPTION.MORALE_TOKEN_REMOVAL:
      return processMoraleTokenRemoval(response, state);

    case INTERRUPTION.FRANCE_MORALE_RECOVERY:
      return processFranceMoraleRecovery(response, state);

    default:
      throw new Error(`Unknown interruption type: ${intType}`);
  }
}

/**
 * 急襲: 防御応答処理。
 */
function processDefenseResponse(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  // 応答駒をアプローチへ移動
  const responseIds = response.pieceIds ?? [];
  for (const pid of responseIds) {
    const p = next.pieces[pid];
    if (p) next.pieces[pid] = { ...p, position: `approach_${ctx.defenseEdgeIdx}` };
  }

  // インタラプションをクリア
  next.pendingInterruption = null;
  next.controlToken = { holder: next.activePlayer, reason: 'active_player' };

  // 急襲を解決
  const result = combat.resolveRaid({
    attackerPieceIds:          ctx.attackerPieceIds,
    targetLocaleId:            ctx.targetLocaleId,
    defenseEdgeIdx:            ctx.defenseEdgeIdx,
    defenseResponsePieceIds:   responseIds,
    isFirstRaidThroughApproach: ctx.isFirstRaidThroughApproach ?? true,
  }, next);

  // 共通アウトカム処理（processDefenseResponse = 常にリザーブからの攻撃）
  return _applyRaidOutcome(result, {
    attackerPieceIds:   ctx.attackerPieceIds,
    targetLocaleId:     ctx.targetLocaleId,
    defenseEdgeIdx:     ctx.defenseEdgeIdx,
    attackFromApproach: false,
    isRoadMarchRaid:    ctx.isRoadMarchRaid ?? false,
  }, next.activePlayer);
}

/**
 * 突撃: 防御先導駒の選択処理。
 */
function processAssaultDefLeaders(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  let defLeaderIds = response.leaderIds ?? [];
  // cav_impassable または cav_obstacle: 騎兵は防御先導駒に選択不可
  if (
    map.isCavalryImpassable(ctx.defenseLocaleId, ctx.defenseEdgeIdx) ||
    map.hasCavalryObstacle(ctx.defenseLocaleId, ctx.defenseEdgeIdx)
  ) {
    defLeaderIds = defLeaderIds.filter(id => next.pieces[id]?.type !== 'cavalry');
  }
  const updatedCtx = { ...ctx, defLeaderIds };

  // 次: 攻撃先導駒の選択
  const interruption = {
    type: INTERRUPTION.ASSAULT_ATK_LEADERS,
    waitingFor: ctx.atkSide,
    context: updatedCtx,
  };

  next.pendingInterruption = interruption;
  next.controlToken = { holder: ctx.atkSide, reason: INTERRUPTION.ASSAULT_ATK_LEADERS };

  return { newState: next, interruption };
}

/**
 * 突撃: 攻撃先導駒の選択処理。
 */
function processAssaultAtkLeaders(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  let atkLeaderIds = response.leaderIds ?? [];
  // cav_impassable: 騎兵は攻撃先導駒に選択不可
  // ※ cav_obstacle は攻撃側にペナルティを与えるが先導駒選択を禁じない（calculateAssaultResult で処理）
  if (map.isCavalryImpassable(ctx.defenseLocaleId, ctx.defenseEdgeIdx)) {
    atkLeaderIds = atkLeaderIds.filter(id => next.pieces[id]?.type !== 'cavalry');
  }
  const updatedCtx = { ...ctx, atkLeaderIds };

  // 次: 防御砲撃（条件チェック）
  // 防御砲兵が非先導かつ砲撃未宣言 かつ アプローチに砲兵ペナルティなし
  const defArtillery = Object.values(next.pieces).filter(p =>
    p.localeId === ctx.defenseLocaleId &&
    p.side === ctx.defSide &&
    p.type === 'artillery' &&
    p.strength > 0 &&
    !ctx.defLeaderIds.includes(p.id)
  );

  const hasArtPenalty = map.hasArtilleryPenalty(ctx.defenseLocaleId, ctx.defenseEdgeIdx);
  const bombInfo = next.pendingBombardment;
  const artFiredLastTurn = bombInfo && defArtillery.some(a => a.id === bombInfo.artilleryId);

  const canDefArtillery = defArtillery.length > 0 && !hasArtPenalty && !artFiredLastTurn;

  if (canDefArtillery) {
    const interruption = {
      type: INTERRUPTION.ASSAULT_DEF_ARTILLERY,
      waitingFor: ctx.defSide,
      context: { ...updatedCtx, availableArtillery: defArtillery.map(a => a.id) },
    };
    next.pendingInterruption = interruption;
    next.controlToken = { holder: ctx.defSide, reason: INTERRUPTION.ASSAULT_DEF_ARTILLERY };
    return { newState: next, interruption };
  }

  // 砲撃不要: カウンター選択へ
  return advanceToCounter({ ...updatedCtx }, next);
}

/**
 * 突撃: 防御砲撃処理。
 */
function processAssaultDefArtillery(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  if (response.fire) {
    // 攻撃先導駒を各 1 減少
    for (const lid of ctx.atkLeaderIds) {
      const p = next.pieces[lid];
      if (p && p.strength > 0) {
        next.pieces[lid] = { ...p, strength: Math.max(0, p.strength - 1) };
      }
    }
  }

  return advanceToCounter(ctx, next);
}

/**
 * カウンター選択インタラプションへ進める内部ヘルパー。
 */
function advanceToCounter(ctx, state) {
  let next = cloneState(state);

  const interruption = {
    type: INTERRUPTION.ASSAULT_COUNTER,
    waitingFor: ctx.defSide,
    context: ctx,
  };

  next.pendingInterruption = interruption;
  next.controlToken = { holder: ctx.defSide, reason: INTERRUPTION.ASSAULT_COUNTER };

  return { newState: next, interruption };
}

/**
 * 突撃: カウンター駒処理。
 */
function processAssaultCounter(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  let counterIds = response.counterIds ?? [];
  // cav_impassable または cav_obstacle: 騎兵はカウンター駒に選択不可
  if (
    map.isCavalryImpassable(ctx.defenseLocaleId, ctx.defenseEdgeIdx) ||
    map.hasCavalryObstacle(ctx.defenseLocaleId, ctx.defenseEdgeIdx)
  ) {
    counterIds = counterIds.filter(id => next.pieces[id]?.type !== 'cavalry');
  }

  // カウンター: 攻撃先導駒を (counterIds の数) だけ減少
  const counterCount = counterIds.length;
  if (counterCount > 0) {
    // 攻撃先導駒に均等に適用
    const perLeader = Math.floor(counterCount / (ctx.atkLeaderIds.length || 1));
    let extra = counterCount % (ctx.atkLeaderIds.length || 1);
    for (const lid of ctx.atkLeaderIds) {
      const p = next.pieces[lid];
      if (!p || p.strength <= 0) continue;
      const amount = perLeader + (extra > 0 ? 1 : 0);
      extra = Math.max(0, extra - 1);
      next.pieces[lid] = { ...p, strength: Math.max(0, p.strength - amount) };
    }
  }

  const updatedCtx = { ...ctx, counterIds };

  // 突撃結果計算
  const { result, atkWins } = combat.calculateAssaultResult(
    {
      atkLeaderIds: updatedCtx.atkLeaderIds,
      defLeaderIds: updatedCtx.defLeaderIds,
      counterIds,
      defenseLocaleId: updatedCtx.defenseLocaleId,
      defenseEdgeIdx: updatedCtx.defenseEdgeIdx,
      attackEdgeIdx: updatedCtx.attackEdgeIdx,
    },
    next
  );

  const { atkReductions, defReductions } = combat.calculateAssaultReductions(
    { result, atkWins, atkLeaderIds: updatedCtx.atkLeaderIds, defLeaderIds: updatedCtx.defLeaderIds, counterIds },
    next
  );

  const finalCtx = { ...updatedCtx, result, atkWins, atkReductions, defReductions };

  // 減少割り当てインタラプション（攻撃側が余剰を割り当てる）
  const interruption = {
    type: INTERRUPTION.ASSAULT_REDUCTIONS,
    waitingFor: atkWins ? ctx.defSide : ctx.atkSide,
    context: finalCtx,
  };

  next.pendingInterruption = interruption;
  next.controlToken = { holder: interruption.waitingFor, reason: INTERRUPTION.ASSAULT_REDUCTIONS };

  return { newState: next, interruption };
}

/**
 * 突撃: 減少割り当て処理と完了。
 */
function processAssaultReductions(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  // 減少を適用
  next = combat.applyAssaultReductions(
    {
      atkReductions: ctx.atkReductions,
      defReductions: ctx.defReductions,
      atkLeaderIds: ctx.atkLeaderIds,
      defLeaderIds: ctx.defLeaderIds,
      atkAssaultIds: ctx.atkAssaultIds,
      defAssaultIds: ctx.defAssaultIds,
      atkApproachChoice: response.atkApproachChoice ?? [],
    },
    next
  );

  // 突撃完了
  const completeResult = combat.completeAssault(
    {
      atkWins: ctx.atkWins,
      atkAssaultIds: ctx.atkAssaultIds,
      defAssaultIds: ctx.defAssaultIds,
      attackLocaleId: ctx.attackLocaleId,
      attackEdgeIdx: ctx.attackEdgeIdx,
      defenseLocaleId: ctx.defenseLocaleId,
      defenseEdgeIdx: ctx.defenseEdgeIdx,
    },
    next
  );

  next = completeResult.newState;

  if (ctx.atkWins) {
    // 防御側士気投入: 先導駒 + カウンター駒の数
    const defInvestCount = ctx.defLeaderIds.length + ctx.counterIds.length;
    if (defInvestCount > 0) {
      next = morale.investMorale(ctx.defSide, ctx.defenseLocaleId, defInvestCount, next);
    }
    // 突撃勝利: 元の防御側ロケールへの道路行軍を同一ターン中禁止
    next.roadMarchBlockedLocales = [
      ...(next.roadMarchBlockedLocales ?? []),
      ctx.defenseLocaleId,
    ];
    // ロケール占拠履歴を更新（攻撃側が防御側ロケールへ移動）
    next.localeLastOccupant = {
      ...(next.localeLastOccupant ?? {}),
      [ctx.defenseLocaleId]: ctx.atkSide,
    };
  }

  // 敗者の士気低下（勝者は除外: ルール Section 突撃）
  if (ctx.atkWins) {
    // 防御側が敗者 → defReductions 分だけ士気低下
    if (ctx.defReductions > 0) {
      next = morale.reduceMorale(ctx.defSide, ctx.defReductions, next);
    }
  } else {
    // 攻撃側が敗者 → atkReductions 分だけ士気低下
    if (ctx.atkReductions > 0) {
      next = morale.reduceMorale(ctx.atkSide, ctx.atkReductions, next);
    }
    // 突撃敗北: 同一ターン中この攻撃アプローチを通じた攻撃・行軍を禁止
    next.blockedApproachesAfterAssault = [
      ...(next.blockedApproachesAfterAssault ?? []),
      { localeId: ctx.attackLocaleId, edgeIdx: ctx.attackEdgeIdx },
    ];
  }

  next.pendingInterruption = null;
  next.controlToken = { holder: next.activePlayer, reason: 'active_player' };

  if (completeResult.retreatNeeded) {
    const retreatInterruption = {
      type: INTERRUPTION.RETREAT_DESTINATION,
      waitingFor: completeResult.retreatInfo.losingSide,
      context: completeResult.retreatInfo,
    };
    next.pendingInterruption = retreatInterruption;
    next.controlToken = {
      holder: completeResult.retreatInfo.losingSide,
      reason: INTERRUPTION.RETREAT_DESTINATION,
    };
    return { newState: next, interruption: retreatInterruption };
  }

  return _flushMoraleRemovals(next) ?? { newState: next, interruption: null };
}

/**
 * 砲撃: 被弾駒選択処理。
 */
function processBombardmentReduction(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  next = combat.completeBombardment(
    {
      artilleryId: ctx.artilleryId,
      targetLocaleId: ctx.targetLocaleId,
      defenseEdgeIdx: ctx.defenseEdgeIdx,
      targetPieceId: response.targetPieceId,
    },
    next
  );

  // 士気損失: 1 (砲撃による減少)
  const artillery = state.pieces[ctx.artilleryId];
  if (artillery) {
    const defSide = artillery.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
    next = morale.reduceMorale(defSide, 1, next);
  }

  next.pendingInterruption = null;
  next.controlToken = { holder: next.activePlayer, reason: 'active_player' };

  return _flushMoraleRemovals(next) ?? { newState: next, interruption: null };
}

/**
 * 退却: 退却先選択処理。
 */
/**
 * 急襲後: 攻撃側アプローチ移動オプション処理。
 * response: { moveToApproach: boolean[] または pieceIds: string[] }
 */
function processAttackerApproach(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  next.pendingInterruption = null;
  next.controlToken = { holder: next.activePlayer, reason: 'active_player' };

  // 移動選択された駒をアプローチへ
  const selectedIds = response.pieceIds ?? [];
  for (const pid of selectedIds) {
    const p = next.pieces[pid];
    if (p && p.localeId === ctx.attackLocaleId && p.position === 'reserve') {
      next.pieces[pid] = { ...p, position: `approach_${ctx.attackEdgeIdx}` };
    }
  }

  return { newState: next, interruption: null };
}

// ---------------------------------------------------------------------------
// 士気関連インタラプション処理
// ---------------------------------------------------------------------------

/**
 * pendingMoraleRemovals の先頭があればインタラプションを生成して返す。
 * なければ null を返す。
 * @param {object} state
 * @returns {{ newState, interruption } | null}
 */
function _flushMoraleRemovals(state) {
  const removals = state.pendingMoraleRemovals;
  if (!removals || removals.length === 0) return null;

  const removal = removals[0];
  const opponent = removal.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
  const availableTokens = state.moraleTokens
    .filter(t => t.side === removal.side)
    .map(t => t.localeId);

  if (availableTokens.length === 0) {
    // 除去するトークンがない（士気崩壊目前など） → スキップして次へ
    const next = cloneState(state);
    next.pendingMoraleRemovals = removals.slice(1);
    return _flushMoraleRemovals(next);
  }

  const interruption = {
    type: INTERRUPTION.MORALE_TOKEN_REMOVAL,
    waitingFor: opponent,
    context: { side: removal.side, amount: removal.amount, availableTokens },
  };
  const next = cloneState(state);
  next.pendingInterruption = interruption;
  next.controlToken = { holder: opponent, reason: INTERRUPTION.MORALE_TOKEN_REMOVAL };
  return { newState: next, interruption };
}

/**
 * 士気マップトークン除去: 相手プレイヤーが対象ロケールを選択。
 * response: { localeIds: number[] }  - 除去するロケール（重複可）
 */
function processMoraleTokenRemoval(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  // 選ばれたロケールからトークンを除去
  const chosenLocaleIds = (response.localeIds || []).map(Number);
  let toRemove = ctx.amount;

  for (const localeId of chosenLocaleIds) {
    if (toRemove <= 0) break;
    const idx = next.moraleTokens.findIndex(t => t.side === ctx.side && t.localeId === localeId);
    if (idx !== -1) {
      next.moraleTokens.splice(idx, 1);
      toRemove--;
    }
  }
  // 不足分は先頭から自動除去
  while (toRemove > 0) {
    const idx = next.moraleTokens.findIndex(t => t.side === ctx.side);
    if (idx === -1) break;
    next.moraleTokens.splice(idx, 1);
    toRemove--;
  }

  // この除去を pendingMoraleRemovals から取り除く
  next.pendingMoraleRemovals = (next.pendingMoraleRemovals || []).slice(1);
  next.pendingInterruption = null;
  next.controlToken = { holder: next.activePlayer, reason: 'active_player' };

  // 次の除去インタラプションがあれば連鎖
  return _flushMoraleRemovals(next) ?? { newState: next, interruption: null };
}

/**
 * フランス士気回収: フランスが1トークンをマップから未投入へ返還。
 * response: { localeId: number | null }  - null = スキップ
 */
function processFranceMoraleRecovery(response, state) {
  let next = cloneState(state);
  next.pendingInterruption = null;

  const chosenLocaleId = response.localeId !== undefined && response.localeId !== null
    ? Number(response.localeId)
    : null;

  if (chosenLocaleId !== null) {
    // 回収可能かチェック
    const recoverable = morale.getRecoverableTokens(next);
    const isValid = recoverable.some(r => r.localeId === chosenLocaleId);
    if (isValid) {
      const idx = next.moraleTokens.findIndex(
        t => t.side === SIDES.FRANCE && t.localeId === chosenLocaleId
      );
      if (idx !== -1) {
        next.moraleTokens.splice(idx, 1);
        next.morale[SIDES.FRANCE].uncommitted++;
      }
    }
  }
  // localeId = null はスキップ

  // 次のプレイヤーのターンへ進む
  const newState = startPlayerTurn(next);
  return { newState, interruption: null };
}

function processRetreatDestination(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  // reductionChoices がなければ calculateRetreatReductions から計算
  const reductionChoices = response.reductionChoices
    ?? combat.calculateRetreatReductions({ losingLocaleId: ctx.losingLocaleId, attackInfo: ctx.attackInfo }, next).reductions;

  const retreatResult = combat.resolveRetreat(
    {
      losingLocaleId: ctx.losingLocaleId,
      attackInfo: ctx.attackInfo,
      reductionChoices,
      destinations: Object.fromEntries(
        Object.entries(response.destinations ?? {}).map(([k, v]) => [k, v != null ? Number(v) : null])
      ),
    },
    next
  );

  next = retreatResult.newState;

  // ロケール占拠履歴を更新（退却先ロケール）
  const dests = response.destinations ?? {};
  for (const [, destLocaleId] of Object.entries(dests)) {
    if (destLocaleId !== null && destLocaleId !== undefined) {
      const p = Object.values(next.pieces).find(p2 => p2.localeId === destLocaleId);
      if (p) {
        next.localeLastOccupant = { ...(next.localeLastOccupant ?? {}), [destLocaleId]: p.side };
      }
    }
  }

  // 士気投入（オーストリアが退却する場合）
  if (retreatResult.moraleInvestment > 0) {
    const losingSide = ctx.losingSide ?? map.getLocaleOccupant(ctx.losingLocaleId, state);
    if (losingSide) {
      next = morale.investMorale(losingSide, ctx.losingLocaleId, retreatResult.moraleInvestment, next);
    }
  }

  // 士気損失
  if (retreatResult.moraleReduction > 0) {
    const losingSide = ctx.losingSide ?? map.getLocaleOccupant(ctx.losingLocaleId, state);
    if (losingSide) {
      next = morale.reduceMorale(losingSide, retreatResult.moraleReduction, next);
    }
  }

  next.pendingInterruption = null;
  next.controlToken = { holder: next.activePlayer, reason: 'active_player' };

  return _flushMoraleRemovals(next) ?? { newState: next, interruption: null };
}

// ---------------------------------------------------------------------------
// ターン終了・ラウンド進行
// ---------------------------------------------------------------------------

/**
 * アクションフェーズ終了。
 * 士気クリーンアップ → プレイヤー切り替えまたはラウンド進行。
 * @param {object} state
 * @returns {GameState}
 */
function endActionPhase(state) {
  let next = cloneState(state);

  // 士気クリーンアップ
  next = morale.moraleCleanup(next.activePlayer, next.round, next);
  next.phase = PHASES.MORALE_CLEANUP;

  // プレイヤー切り替え
  if (next.activePlayer === SIDES.AUSTRIA) {
    // オーストリアが終わったのでフランスのターンへ
    // このターン投入したトークン記録を「直前の相手ターン」として引き継ぐ（フランス回収ルール用）
    next.moraleTokensPlacedByEnemyLastTurn = [...(next.moraleTokensPlacedThisTurn ?? [])];
    next.activePlayer = SIDES.FRANCE;
    next.controlToken = { holder: SIDES.FRANCE, reason: 'active_player' };
    next.phase = PHASES.MORALE_UPDATE;
  } else {
    // フランスが終わったのでラウンド進行
    next = advanceRound(next);
  }

  return next;
}

/**
 * ラウンドを進める。
 * @param {object} state
 * @returns {GameState}
 */
function advanceRound(state) {
  let next = cloneState(state);
  next.round++;
  next.activePlayer = SIDES.AUSTRIA;
  next.controlToken = { holder: SIDES.AUSTRIA, reason: 'active_player' };
  next.phase = PHASES.MORALE_UPDATE;
  return next;
}

// ---------------------------------------------------------------------------
// 勝利条件チェック
// ---------------------------------------------------------------------------

/**
 * 勝利条件をチェックする。
 * @param {object} state
 * @returns {{ winner: string, type: string } | null}
 */
function checkVictory(state) {
  // 士気崩壊
  const collapse = morale.checkMoraleCollapse(state);
  if (collapse) {
    const winner = collapse.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
    return { winner, type: 'morale_collapse' };
  }

  // ゲーム終了（ラウンド16終了後）
  if (state.round > 16) {
    // 目標ライン判定: 東側にオーストリア駒が3つ以上 → オーストリア辺縁勝利
    const austriaEast = Object.values(state.pieces).filter(p => {
      if (p.side !== SIDES.AUSTRIA || p.strength <= 0) return false;
      const area = map.getLocale(p.localeId);
      return area?.eastOfObjective === true;
    }).length;

    if (austriaEast >= 3) {
      return { winner: SIDES.AUSTRIA, type: 'marginal_objective' };
    } else {
      return { winner: SIDES.FRANCE, type: 'marginal_objective' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

module.exports = {
  startPlayerTurn,
  executeAction,
  processInterruption,
  endActionPhase,
  advanceRound,
  checkVictory,
  applyApproachCleanup,
};
