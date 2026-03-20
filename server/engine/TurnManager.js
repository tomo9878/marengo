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
function executeAction(action, state) {
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

    case 'bombardment_complete':
      return executeBombardmentComplete(action, state);

    case 'reorganize':
      return executeReorganize(action, state);

    case 'ENTER_MAP':
      return executeEnterMap(action, state);

    case 'end_turn': {
      const afterPhase = endActionPhase(state);
      const newState = startPlayerTurn(afterPhase);
      return { newState, interruption: null };
    }

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}

/**
 * 行軍アクションの実行。
 */
function executeMarch(action, state) {
  let next = cloneState(state);
  const piece = next.pieces[action.pieceId];
  if (!piece) throw new Error(`Piece not found: ${action.pieceId}`);

  const destLocaleId = action.to.localeId;

  // 移動実行
  next.pieces[action.pieceId] = {
    ...piece,
    localeId: destLocaleId,
    position: action.to.position,
    actedThisTurn: true,
  };

  // Section 14: 混乱ルール — 整列駒が混乱駒のいるロケールへ入ると全員混乱
  if (!piece.disordered) {
    const disorderedInDest = Object.values(next.pieces).some(
      p => p.id !== action.pieceId && p.localeId === destLocaleId && p.side === piece.side && p.disordered
    );
    if (disorderedInDest) {
      // 同サイドの全駒（移動した駒も含む）を混乱状態にする
      for (const pid of Object.keys(next.pieces)) {
        const p = next.pieces[pid];
        if (p.localeId === destLocaleId && p.side === piece.side) {
          next.pieces[pid] = { ...p, disordered: true };
        }
      }
    }
  }

  // 道路行軍: 横断交通制限を記録
  if (action.type === 'road_march' && action.crossingPath) {
    for (const { canonicalEdgeId, direction, step } of action.crossingPath) {
      if (!next.crossingTraffic[canonicalEdgeId]) {
        next.crossingTraffic[canonicalEdgeId] = [];
      }
      next.crossingTraffic[canonicalEdgeId].push({ pieceId: action.pieceId, steps: step, direction });
    }
  }

  // 司令ポイント消費
  next.commandPoints -= action.commandCost ?? 0;
  if (action.commandCost > 0) {
    next.actedPieceIds.add(action.pieceId);
  }

  return { newState: next, interruption: null };
}

/**
 * 急襲の開始処理。
 * 防御側の応答インタラプションを生成する。
 */
function initiateRaid(action, state) {
  let next = cloneState(state);
  const piece = next.pieces[action.pieceId];

  // 司令ポイント消費
  next.commandPoints -= 3;
  next.actedPieceIds.add(action.pieceId);

  // 攻撃側の駒を記録
  // 急襲では単一駒のため attackerPieceIds = [pieceId]
  const attackerPieceIds = [action.pieceId];

  // 防御側がリザーブから応答できるか確認
  const defSide = piece.side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
  const defLocale = action.targetLocaleId;

  const defenderReserve = Object.values(next.pieces).filter(
    p => p.localeId === defLocale && p.side === defSide && p.position === 'reserve' && p.strength > 0
  );

  // インタラプション生成
  const interruption = {
    type: INTERRUPTION.DEFENSE_RESPONSE,
    waitingFor: defSide,
    context: {
      attackerPieceIds,
      targetLocaleId: defLocale,
      defenseEdgeIdx: action.defenseEdgeIdx,
      availableDefenders: defenderReserve.map(p => p.id),
      maxResponse: attackerPieceIds.length,
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

  // コスト計算: 最初の入場は0CP（ポンツーン橋）、以降は1CP
  const cost = entriesThisTurn === 0 ? 0 : 1;
  if (cost > next.commandPoints) {
    throw new Error(`Not enough command points (need ${cost}, have ${next.commandPoints})`);
  }

  // 司令ポイント消費
  next.commandPoints -= cost;

  // 駒をマップ上に配置（リザーブ、裏向き）
  next.pieces[action.pieceId] = {
    ...piece,
    localeId: BORMIDA_ENTRY_LOCALE_IDX,
    position: 'reserve',
    faceUp: false,
  };

  // 入場済み駒として記録
  next.actedPieceIds.add(action.pieceId);

  // 入場カウントを更新
  next.entriesThisTurn = entriesThisTurn + 1;

  // ログ追加
  next = addLog(next, `オーストリア駒 ${action.pieceId} がボルミダ川よりマップに入場 (コスト: ${cost}CP)`);

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
    if (p) {
      next.pieces[pid] = { ...p, position: `approach_${ctx.defenseEdgeIdx}` };
    }
  }

  // インタラプションをクリア
  next.pendingInterruption = null;
  next.controlToken = { holder: next.activePlayer, reason: 'active_player' };

  // 急襲を解決
  const result = combat.resolveRaid(
    {
      attackerPieceIds: ctx.attackerPieceIds,
      targetLocaleId: ctx.targetLocaleId,
      defenseEdgeIdx: ctx.defenseEdgeIdx,
      defenseResponsePieceIds: responseIds,
    },
    next
  );

  next = result.newState;

  if (result.winner === 'defender') {
    // 防御側勝ち: 士気投入
    const defSide = next.controlToken.holder;
    const atkSide = defSide === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
    next = morale.investMorale(atkSide, ctx.targetLocaleId, result.moraleInvestment, next);
    return { newState: next, interruption: null };
  } else {
    // 攻撃側勝ち: 退却インタラプション
    const retreatInterruption = {
      type: INTERRUPTION.RETREAT_DESTINATION,
      waitingFor: result.retreatInfo.losingside,
      context: {
        ...result.retreatInfo,
        isRaid: true,
      },
    };
    next.pendingInterruption = retreatInterruption;
    next.controlToken = {
      holder: result.retreatInfo.losingside,
      reason: INTERRUPTION.RETREAT_DESTINATION,
    };
    return { newState: next, interruption: retreatInterruption };
  }
}

/**
 * 突撃: 防御先導駒の選択処理。
 */
function processAssaultDefLeaders(response, state) {
  const ctx = state.pendingInterruption.context;
  let next = cloneState(state);

  const defLeaderIds = response.leaderIds ?? [];
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

  const atkLeaderIds = response.leaderIds ?? [];
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

  const counterIds = response.counterIds ?? [];

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

  return { newState: next, interruption: null };
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

  return { newState: next, interruption: null };
}

/**
 * 退却: 退却先選択処理。
 */
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
      destinations: response.destinations ?? {},
    },
    next
  );

  next = retreatResult.newState;

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

  return { newState: next, interruption: null };
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
