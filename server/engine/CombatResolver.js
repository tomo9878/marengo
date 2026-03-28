'use strict';

/**
 * CombatResolver.js
 * 戦闘解決の純粋関数群
 *
 * 状態を変更せず、必要な入力を引数として受け取り、新しい状態を返す。
 * TurnManager がインタラプション状態の管理を担当する。
 */

const { SIDES, PIECE_TYPES, cloneState } = require('./GameState');
const map = require('./MapGraph');

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function enemySide(side) {
  return side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
}

/**
 * 駒の強度を減少させる（0 以下にはならない）。
 * @param {GameState} state
 * @param {string} pieceId
 * @param {number} amount
 * @returns {GameState}
 */
function reducePieceStrength(state, pieceId, amount) {
  const next = cloneState(state);
  const piece = next.pieces[pieceId];
  if (!piece) return next;
  piece.strength = Math.max(0, piece.strength - amount);
  return next;
}

// ---------------------------------------------------------------------------
// 先導駒・カウンター駒の候補取得
// ---------------------------------------------------------------------------

/**
 * 突撃の先導駒として有効な候補を返す。
 * @param {number} localeId - 自分側のロケール
 * @param {number} edgeIdx - 自分側のアプローチのエッジインデックス
 * @param {string} side
 * @param {object} state
 * @returns {string[]} - pieceId の配列
 */
function getValidAssaultLeaders(localeId, edgeIdx, side, state) {
  const posKey = `approach_${edgeIdx}`;
  const pieces = Object.values(state.pieces).filter(
    p => p.localeId === localeId && p.side === side && p.strength >= 2
  );

  // 先導駒はアプローチまたはリザーブにいる駒から選ぶ（突撃参加駒）
  // 実際には突撃駒セットから選ぶが、ここでは strength >= 2 のすべてを候補とする
  return pieces
    .filter(p => p.position === posKey || p.position === 'reserve')
    .map(p => p.id);
}

/**
 * 防御カウンター駒として有効な候補を返す。
 * @param {number} localeId - 防御側のロケール
 * @param {number} edgeIdx - 防御側のアプローチのエッジインデックス（攻撃を受けている側）
 * @param {string} side - 防御側
 * @param {object} state
 * @returns {string[]}
 */
function getValidCounterPieces(localeId, edgeIdx, side, state) {
  const hasCavObstacle = map.hasCavalryObstacle(localeId, edgeIdx);
  const cavImpassable = map.isCavalryImpassable(localeId, edgeIdx);
  const pieces = Object.values(state.pieces).filter(
    p => p.localeId === localeId && p.side === side && p.strength >= 2
  );

  return pieces
    .filter(p => {
      // 騎兵突撃不可 or 騎兵障害物があれば騎兵不可
      if ((cavImpassable || hasCavObstacle) && p.type === PIECE_TYPES.CAVALRY) return false;
      return true;
    })
    .map(p => p.id);
}

/**
 * 退却先として有効なロケール一覧を返す。
 * @param {string} pieceId
 * @param {number} losingLocaleId - 退却元ロケール
 * @param {{ attackLocaleId, attackEdgeIdx }} attackInfo
 * @param {object} state
 * @returns {number[]} - 有効な退却先ロケールの idx 配列
 */
function getValidRetreatDestinations(pieceId, losingLocaleId, attackInfo, state) {
  const piece = state.pieces[pieceId];
  if (!piece) return [];

  const side = piece.side;
  const adjacentList = map.getAdjacent(losingLocaleId);
  const results = [];

  for (const { adjIdx, myEdgeIdx } of adjacentList) {
    // 攻撃元ロケールへは退却不可
    if (adjIdx === attackInfo.attackLocaleId) continue;
    // 敵占拠ロケールへは不可
    const occupant = map.getLocaleOccupant(adjIdx, state);
    if (occupant === enemySide(side)) continue;
    // 容量超過不可
    if (map.isOverCapacity(adjIdx, side, state)) continue;

    results.push(adjIdx);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 急襲（Section 9）
// ---------------------------------------------------------------------------

/**
 * 急襲を解決する（勝敗判定・攻撃側移動）。
 *
 * 防御側勝利条件:
 *   1. 完全ブロック（狭い=1体、広い=2体）
 *   2. 部分ブロック（広い=1体）かつ 攻撃側が1体 かつ このアプローチ最初の急襲
 *
 * @param {{ attackerPieceIds, targetLocaleId, defenseEdgeIdx,
 *           defenseResponsePieceIds, isFirstRaidThroughApproach }} params
 * @param {object} state
 * @returns {{ winner: 'attacker'|'defender', retreatInfo, moraleInvestment, newState }}
 */
function resolveRaid(
  { attackerPieceIds, targetLocaleId, defenseEdgeIdx, defenseResponsePieceIds = [], isFirstRaidThroughApproach = true },
  state
) {
  let next = cloneState(state);

  // 防御応答駒を防御アプローチへ移動（まだ移動していない場合）
  for (const pid of defenseResponsePieceIds) {
    const p = next.pieces[pid];
    if (p) {
      next.pieces[pid] = { ...p, position: `approach_${defenseEdgeIdx}` };
    }
  }

  // ブロック状況を確認
  const blockingCount  = map.getBlockingPieces(targetLocaleId, defenseEdgeIdx, next).length;
  const requirement    = map.getBlockRequirement(targetLocaleId, defenseEdgeIdx);
  const isFullBlock    = blockingCount >= requirement;
  const isPartialBlock = blockingCount > 0 && blockingCount < requirement;
  const singleAttacker = attackerPieceIds.length === 1;

  // 防御側勝利判定
  const defenderWins = isFullBlock || (isPartialBlock && singleAttacker && isFirstRaidThroughApproach);

  if (defenderWins) {
    const width = map.getApproachWidth(targetLocaleId, defenseEdgeIdx);
    const isWide = width === 'wide';
    const multipleAttackers = attackerPieceIds.length >= 2;

    // 士気投入数: 1。ただし広いアプローチ AND 2体以上攻撃 AND 最初の急襲 → 2
    let moraleInvestment = 1;
    if (isWide && multipleAttackers && isFirstRaidThroughApproach) {
      moraleInvestment = 2;
    }

    return {
      winner: 'defender',
      retreatInfo: null,
      moraleInvestment,
      newState: next,
    };
  }

  // 攻撃側勝利: 攻撃駒が対象ロケールのリザーブへ、防御側は退却
  const defenderSide = map.getLocaleOccupant(targetLocaleId, next);

  for (const pid of attackerPieceIds) {
    const p = next.pieces[pid];
    if (p) {
      next.pieces[pid] = { ...p, localeId: targetLocaleId, position: 'reserve' };
    }
  }

  const retreatInfo = {
    losingLocaleId: targetLocaleId,
    losingside: defenderSide,
    attackInfo: {
      attackLocaleId: attackerPieceIds.length > 0
        ? state.pieces[attackerPieceIds[0]]?.localeId
        : null,
      attackEdgeIdx: null,
      isRaid: true,
    },
  };

  return {
    winner: 'attacker',
    retreatInfo,
    moraleInvestment: 0,
    newState: next,
  };
}

// ---------------------------------------------------------------------------
// 突撃（Section 11）
// ---------------------------------------------------------------------------

/**
 * 突撃の結果を計算する（純粋計算、状態変更なし）。
 * @param {{ atkLeaderIds, defLeaderIds, counterIds, defenseEdgeIdx, attackEdgeIdx }} params
 * @param {object} state
 * @returns {{ result: number, atkWins: boolean }}
 */
function calculateAssaultResult(
  { atkLeaderIds, defLeaderIds, counterIds, defenseLocaleId, defenseEdgeIdx, attackEdgeIdx },
  state
) {
  // 攻撃先導駒の強度合計
  const atkLeaderStrength = atkLeaderIds.reduce((sum, id) => {
    const p = state.pieces[id];
    return sum + (p ? p.strength : 0);
  }, 0);

  // 防御アプローチのペナルティ計算
  // 攻撃先導駒の兵種とシンボルが一致するごとに -1
  const defLocaleId = defenseLocaleId
    ?? state.pieces[defLeaderIds[0]]?.localeId
    ?? (counterIds.length > 0 ? state.pieces[counterIds[0]]?.localeId : null);

  let atkPenalties = 0;
  if (defLocaleId !== null && defLocaleId !== undefined) {
    const symbols = map.getApproachSymbols(defLocaleId, defenseEdgeIdx);
    const hasInfLeader = atkLeaderIds.some(id => state.pieces[id]?.type === PIECE_TYPES.INFANTRY);
    const hasCavLeader = atkLeaderIds.some(id => state.pieces[id]?.type === PIECE_TYPES.CAVALRY);
    for (const sym of symbols) {
      if (sym === 'inf_obstacle' && hasInfLeader) atkPenalties++;
      if (sym === 'cav_obstacle' && hasCavLeader) atkPenalties++;
    }
  }

  // 防御先導駒の強度合計
  const defLeaderStrength = defLeaderIds.reduce((sum, id) => {
    const p = state.pieces[id];
    return sum + (p ? p.strength : 0);
  }, 0);

  // カウンター駒の強度合計
  const counterStrength = counterIds.reduce((sum, id) => {
    const p = state.pieces[id];
    return sum + (p ? p.strength : 0);
  }, 0);

  const result = atkLeaderStrength - atkPenalties - defLeaderStrength - counterStrength;
  return { result, atkWins: result >= 1 };
}

/**
 * 突撃の戦力減少量を計算する。
 * @param {{ result, atkWins, atkLeaderIds, defLeaderIds, counterIds }} params
 * @param {object} state
 * @returns {{ atkReductions: number, defReductions: number }}
 */
function calculateAssaultReductions(
  { result, atkWins, atkLeaderIds, defLeaderIds, counterIds },
  state
) {
  // 双方: 敵先導駒の数 (数、強度でなく)
  let defReductions = atkLeaderIds.length; // 防御側が受ける = 攻撃先導駒の数
  let atkReductions = defLeaderIds.length; // 攻撃側が受ける = 防御先導駒の数

  // 攻撃側: + 生き残っている防御騎兵カウンター数
  const survivingDefCavCounters = counterIds.filter(id => {
    const p = state.pieces[id];
    return p && p.strength > 0 && p.type === PIECE_TYPES.CAVALRY;
  }).length;
  atkReductions += survivingDefCavCounters;

  // 攻撃側が負けた場合、追加減少
  // 先導駒の戦力が敗北マージン以下（先導駒が圧倒された）かつ実際にマージンがある場合
  if (!atkWins) {
    const currentAtkLeaderStrength = atkLeaderIds.reduce((sum, id) => {
      const p = state.pieces[id];
      return sum + (p ? p.strength : 0);
    }, 0);
    const absResult = Math.abs(result);
    if (absResult > 0 && currentAtkLeaderStrength <= absResult) {
      // 1 先導駒なら +1, 2 先導駒なら +2
      atkReductions += atkLeaderIds.length >= 2 ? 2 : 1;
    }
  }

  return { atkReductions, defReductions };
}

/**
 * 突撃の戦力減少を適用する。
 * @param {{ atkReductions, defReductions, atkLeaderIds, defLeaderIds, atkAssaultIds, defAssaultIds, atkApproachChoice }} params
 *   atkApproachChoice: 余剰減少をどの駒に割り当てるか (pieceId -> amount の配列)
 * @param {object} state
 * @returns {GameState}
 */
function applyAssaultReductions(
  { atkReductions, defReductions, atkLeaderIds, defLeaderIds, atkAssaultIds, defAssaultIds, atkApproachChoice = [] },
  state
) {
  let next = cloneState(state);

  // 防御側の減少: 防御先導駒に均等に
  next = applyReductionsToGroup(next, defLeaderIds, defReductions, defAssaultIds);

  // 攻撃側の減少: 攻撃先導駒に均等に
  next = applyReductionsToGroup(next, atkLeaderIds, atkReductions, atkAssaultIds, atkApproachChoice);

  return next;
}

/**
 * 減少をグループ（先導駒優先、余剰を他へ）に適用する内部ヘルパー。
 * @param {GameState} state
 * @param {string[]} leaderIds - 先導駒 (優先)
 * @param {number} totalReductions
 * @param {string[]} otherIds - 余剰を受ける駒
 * @param {Array<{pieceId, amount}>} overflowChoice - 余剰割り当て（省略時は先頭から）
 * @returns {GameState}
 */
function applyReductionsToGroup(state, leaderIds, totalReductions, otherIds, overflowChoice = []) {
  let next = cloneState(state);
  let remaining = totalReductions;

  // 先導駒に均等に分配
  if (leaderIds.length > 0 && remaining > 0) {
    const perLeader = Math.floor(remaining / leaderIds.length);
    const extra = remaining % leaderIds.length;

    for (let i = 0; i < leaderIds.length && remaining > 0; i++) {
      const amount = perLeader + (i < extra ? 1 : 0);
      const p = next.pieces[leaderIds[i]];
      if (!p) continue;
      const actual = Math.min(amount, p.strength);
      next.pieces[leaderIds[i]] = { ...p, strength: Math.max(0, p.strength - actual) };
      remaining -= actual;
    }
  }

  // 余剰を他の突撃駒へ
  if (remaining > 0 && overflowChoice.length > 0) {
    for (const { pieceId, amount } of overflowChoice) {
      if (remaining <= 0) break;
      const p = next.pieces[pieceId];
      if (!p) continue;
      const actual = Math.min(amount, p.strength, remaining);
      next.pieces[pieceId] = { ...p, strength: Math.max(0, p.strength - actual) };
      remaining -= actual;
    }
  } else if (remaining > 0) {
    // デフォルト: otherIds の先頭から割り当て
    const others = otherIds.filter(id => !leaderIds.includes(id));
    for (const id of others) {
      if (remaining <= 0) break;
      const p = next.pieces[id];
      if (!p || p.strength <= 0) continue;
      const actual = Math.min(remaining, p.strength);
      next.pieces[id] = { ...p, strength: Math.max(0, p.strength - actual) };
      remaining -= actual;
    }
  }

  return next;
}

/**
 * 突撃の完了処理（移動・退却設定）。
 * @param {{ atkWins, atkAssaultIds, defAssaultIds, attackLocaleId, attackEdgeIdx, defenseLocaleId, defenseEdgeIdx }} params
 * @param {object} state
 * @returns {{ retreatNeeded: boolean, retreatInfo, newState }}
 */
function completeAssault(
  { atkWins, atkAssaultIds, defAssaultIds, attackLocaleId, attackEdgeIdx, defenseLocaleId, defenseEdgeIdx },
  state
) {
  let next = cloneState(state);

  if (atkWins) {
    // 攻撃側: 全突撃駒が防御ロケールのリザーブへ
    for (const pid of atkAssaultIds) {
      const p = next.pieces[pid];
      if (p && p.strength > 0) {
        next.pieces[pid] = { ...p, localeId: defenseLocaleId, position: 'reserve' };
      }
    }

    // 防御側は退却
    return {
      retreatNeeded: true,
      retreatInfo: {
        losingLocaleId: defenseLocaleId,
        losingSide: map.getLocaleOccupant(defenseLocaleId, state),
        attackInfo: {
          attackLocaleId,
          attackEdgeIdx,
          isWideApproach: map.getApproachWidth(defenseLocaleId, defenseEdgeIdx) === 'wide',
          attackerPieceCount: atkAssaultIds.filter(id => {
            const p = next.pieces[id];
            return p && p.strength > 0;
          }).length,
        },
      },
      newState: next,
    };
  } else {
    // 防御側の勝ち: 全駒は動かない
    // 攻撃駒は approach に戻るかもしれない（オプション）
    return {
      retreatNeeded: false,
      retreatInfo: null,
      newState: next,
    };
  }
}

// ---------------------------------------------------------------------------
// 砲撃完遂（Section 10）
// ---------------------------------------------------------------------------

/**
 * 砲撃の完遂処理。
 * @param {{ artilleryId, targetLocaleId, defenseEdgeIdx, targetPieceId }} params
 *   targetPieceId: 防御側が選んだ被弾駒
 * @param {object} state
 * @returns {GameState}
 */
function completeBombardment({ artilleryId, targetLocaleId, defenseEdgeIdx, targetPieceId }, state) {
  let next = cloneState(state);

  // 対象駒の強度を 1 減少
  if (targetPieceId && next.pieces[targetPieceId]) {
    const p = next.pieces[targetPieceId];
    next.pieces[targetPieceId] = { ...p, strength: Math.max(0, p.strength - 1) };
  }

  // 砲兵を表向き（face-up = false に戻す = 完遂済み）
  if (artilleryId && next.pieces[artilleryId]) {
    next.pieces[artilleryId] = { ...next.pieces[artilleryId], faceUp: false };
  }

  // pendingBombardment をクリア
  next.pendingBombardment = null;

  return next;
}

/**
 * 砲撃の対象駒候補を優先順位付きで返す。
 * 優先: 1. 向かい側アプローチの駒, 2. リザーブの駒, 3. その他アプローチの駒
 * @param {{ artilleryId, targetLocaleId, defenseEdgeIdx }} params
 * @param {object} state
 * @returns {string[]} - pieceId の配列（優先順）
 */
function getBombardmentTargets({ artilleryId, targetLocaleId, defenseEdgeIdx }, state) {
  const artillery = state.pieces[artilleryId];
  if (!artillery) return [];

  const targetSide = enemySide(artillery.side);
  const piecesInLocale = Object.values(state.pieces).filter(
    p => p.localeId === targetLocaleId && p.side === targetSide && p.strength > 0
  );

  // 向かい側アプローチ: defenseEdgeIdx に対する向かい側
  const oppositeApproach = map.getOppositeApproach(artillery.localeId, state.pendingBombardment?.defenseApproachIdx ?? defenseEdgeIdx);

  const priority1 = piecesInLocale.filter(p => oppositeApproach && p.position === `approach_${oppositeApproach.edgeIdx}`);
  const priority2 = piecesInLocale.filter(p => p.position === 'reserve');
  const priority3 = piecesInLocale.filter(p => p.position.startsWith('approach_') && !priority1.includes(p));

  return [...priority1, ...priority2, ...priority3].map(p => p.id);
}

// ---------------------------------------------------------------------------
// 退却（Section 13）
// ---------------------------------------------------------------------------

/**
 * 退却前の戦力減少を計算する。
 * @param {{ losingLocaleId, attackInfo }} params
 *   attackInfo: { isWideApproach, attackerPieceCount }
 * @param {object} state
 * @returns {{ reductions: Array<{ pieceId, amount }> }}
 */
function calculateRetreatReductions({ losingLocaleId, attackInfo }, state) {
  const losingOccupant = map.getLocaleOccupant(losingLocaleId, state);
  if (!losingOccupant) return { reductions: [] };

  const locale = map.getLocale(losingLocaleId);
  const reductions = [];

  // 1. 全砲兵: 全ポジションで除去（strength → 0）
  const artillery = Object.values(state.pieces).filter(
    p => p.localeId === losingLocaleId && p.side === losingOccupant
       && p.type === PIECE_TYPES.ARTILLERY && p.strength > 0
  );
  for (const art of artillery) {
    reductions.push({ pieceId: art.id, amount: art.strength });
  }

  // 2. 各アプローチ: ブロックしている歩兵/騎兵に減少
  for (let i = 0; i < locale.edges.length; i++) {
    const blockingPieces = map.getBlockingPieces(losingLocaleId, i, state).filter(
      p => p.side === losingOccupant && (p.type === PIECE_TYPES.INFANTRY || p.type === PIECE_TYPES.CAVALRY)
    );
    if (blockingPieces.length === 0) continue;

    const width = map.getApproachWidth(losingLocaleId, i);
    const approachReduction = width === 'wide' ? 2 : 1;

    // 駒を選んで減少（防御側の選択。ここでは最初の 1〜2 駒に適用）
    let toReduce = approachReduction;
    for (const bp of blockingPieces) {
      if (toReduce <= 0) break;
      const actual = Math.min(toReduce, bp.strength);
      reductions.push({ pieceId: bp.id, amount: actual });
      toReduce -= actual;
    }
  }

  // 3. リザーブの歩兵: 1 減少
  //    例外: 広いアプローチからの攻撃 AND 複数の攻撃駒が入る → 2 減少
  const isWideApproach = attackInfo?.isWideApproach ?? false;
  const multipleAttackersEnter = (attackInfo?.attackerPieceCount ?? 0) >= 2;
  const reserveInfReduction = (isWideApproach && multipleAttackersEnter) ? 2 : 1;

  const reserveInf = Object.values(state.pieces).filter(
    p => p.localeId === losingLocaleId && p.side === losingOccupant
       && p.type === PIECE_TYPES.INFANTRY && p.position === 'reserve' && p.strength > 0
  );
  for (const inf of reserveInf) {
    const actual = Math.min(reserveInfReduction, inf.strength);
    reductions.push({ pieceId: inf.id, amount: actual });
  }

  // 4. リザーブの騎兵: 減少なし

  return { reductions };
}

/**
 * 退却を解決する（減少の適用 + 駒の移動）。
 * @param {{ losingLocaleId, attackInfo, reductionChoices, destinations }} params
 *   reductionChoices: Array<{ pieceId, amount }> - 防御側が選んだ減少割り当て
 *   destinations: { [pieceId]: number } - 各駒の退却先ロケール
 * @param {object} state
 * @returns {{ newState: GameState, moraleInvestment: number, moraleReduction: number }}
 */
function resolveRetreat({ losingLocaleId, attackInfo, reductionChoices, destinations }, state) {
  let next = cloneState(state);
  const losingOccupant = map.getLocaleOccupant(losingLocaleId, next);

  let totalStrengthReduced = 0;
  let retreatingPieceCount = 0;

  // 減少の適用
  for (const { pieceId, amount } of reductionChoices) {
    const p = next.pieces[pieceId];
    if (!p) continue;
    const actual = Math.min(amount, p.strength);
    next.pieces[pieceId] = { ...p, strength: Math.max(0, p.strength - actual) };
    totalStrengthReduced += actual;
  }

  // 退却: 生き残った駒を退却先へ
  const losingPieces = Object.values(next.pieces).filter(
    p => p.localeId === losingLocaleId && p.side === losingOccupant && p.strength > 0
  );

  const revealedCavalryIds = [];
  for (const piece of losingPieces) {
    const dest = destinations?.[piece.id];
    if (dest !== undefined && dest !== null) {
      // リザーブの騎兵が退却する場合、騎兵であることを示すために表向きにする
      const showFaceUp = piece.type === PIECE_TYPES.CAVALRY && piece.position === 'reserve';
      if (showFaceUp) revealedCavalryIds.push(piece.id);
      next.pieces[piece.id] = { ...piece, localeId: dest, position: 'reserve', faceUp: showFaceUp };
      retreatingPieceCount++;
    } else {
      // 退却先がない → 除去
      next.pieces[piece.id] = { ...piece, strength: 0 };
    }
  }

  // 士気投入（オーストリアのみ、退却駒の数）
  let moraleInvestment = 0;
  if (losingOccupant === SIDES.AUSTRIA) {
    moraleInvestment = retreatingPieceCount;
  }

  // 士気損失: 強度減少分
  const moraleReduction = totalStrengthReduced;

  return { newState: next, moraleInvestment, moraleReduction, revealedCavalryIds };
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

module.exports = {
  // 急襲
  resolveRaid,

  // 突撃
  calculateAssaultResult,
  calculateAssaultReductions,
  applyAssaultReductions,
  completeAssault,

  // 砲撃
  completeBombardment,
  getBombardmentTargets,

  // 退却
  calculateRetreatReductions,
  resolveRetreat,

  // ヘルパー
  getValidAssaultLeaders,
  getValidCounterPieces,
  getValidRetreatDestinations,
  reducePieceStrength,
};
