'use strict';

/**
 * MoraleManager.js
 * 士気の管理（投入・損失・クリーンアップ・崩壊判定）
 *
 * 全関数は純粋関数。状態を引数として受け取り、新しい状態を返す。
 */

const { SIDES, cloneState, getTotalMorale } = require('./GameState');
const map = require('./MapGraph');
const scenarios = require('../../data/scenarios.json');

// ---------------------------------------------------------------------------
// 士気取得ユーティリティ
// ---------------------------------------------------------------------------

/**
 * 指定陣営のマップ上のトークン一覧を返す。
 * @param {string} side
 * @param {object} state
 * @returns {Array<{ localeId: number }>}
 */
function getMapTokens(side, state) {
  return state.moraleTokens.filter(t => t.side === side);
}

// getTotalMorale は GameState から再エクスポート
// ここでは MoraleManager が独自に提供するが、GameState のものと同じロジック
function _getTotalMorale(side, state) {
  return getTotalMorale(side, state);
}

// ---------------------------------------------------------------------------
// 定期士気更新（ターン開始時）
// ---------------------------------------------------------------------------

/**
 * 定期士気更新: タイムトラックのトークンを uncommitted に移動する。
 * activePlayer のターン開始時にそのプレイヤーの士気のみ更新する。
 * @param {number} round
 * @param {string} activePlayer - 'france' | 'austria'
 * @param {object} state
 * @returns {GameState}
 */
function periodicMoraleUpdate(round, activePlayer, state) {
  const next = cloneState(state);
  const entry = scenarios.timeTrack.find(t => t.round === round);
  if (!entry) return next;

  const { moraleGain } = entry;
  const gain = moraleGain[activePlayer] ?? 0;
  if (gain > 0) {
    next.morale[activePlayer].uncommitted += gain;
  }

  return next;
}

// ---------------------------------------------------------------------------
// 士気投入
// ---------------------------------------------------------------------------

/**
 * 指定陣営がロケールにトークンを投入する。
 * uncommitted が不足する場合は相手のマップトークンから取る。
 * @param {string} side - 投入する陣営
 * @param {number} localeId - 投入先ロケール
 * @param {number} count - 投入数
 * @param {object} state
 * @returns {GameState}
 */
function investMorale(side, localeId, count, state) {
  let next = cloneState(state);
  if (!next.moraleTokensPlacedThisTurn) next.moraleTokensPlacedThisTurn = [];

  for (let i = 0; i < count; i++) {
    if (next.morale[side].uncommitted > 0) {
      next.morale[side].uncommitted--;
      next.moraleTokens.push({ side, localeId });
      next.moraleTokensPlacedThisTurn.push({ side, localeId });
    } else {
      // uncommitted 不足: 相手陣営のマップトークンを奪って自陣営のトークンに変換
      // （先頭を自動選択）
      const opponentSide = side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
      const opponentTokens = next.moraleTokens.filter(t => t.side === opponentSide);
      if (opponentTokens.length > 0) {
        const idx = next.moraleTokens.indexOf(opponentTokens[0]);
        next.moraleTokens.splice(idx, 1);
        next.moraleTokens.push({ side, localeId });
        next.moraleTokensPlacedThisTurn.push({ side, localeId });
      }
      // トークンもない → 投入不可（ゲーム終了条件になるはず）
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// 士気損失
// ---------------------------------------------------------------------------

/**
 * 指定陣営の士気を減少させる。
 * uncommitted から先に、次にマップトークンから除去する。
 * @param {string} side
 * @param {number} amount
 * @param {object} state
 * @returns {GameState}
 */
function reduceMorale(side, amount, state) {
  let next = cloneState(state);
  let remaining = amount;

  // uncommitted から先に除去
  const fromUncommitted = Math.min(remaining, next.morale[side].uncommitted);
  next.morale[side].uncommitted -= fromUncommitted;
  remaining -= fromUncommitted;

  // uncommitted が尽きた場合 → pendingMoraleRemovals に積む
  // 相手プレイヤーが除去するトークンを選ぶ（MORALE_TOKEN_REMOVAL インタラプション）
  if (remaining > 0) {
    next.pendingMoraleRemovals = [
      ...(next.pendingMoraleRemovals ?? []),
      { side, amount: remaining },
    ];
  }

  return next;
}

// ---------------------------------------------------------------------------
// 士気クリーンアップ（ターン終了時）
// ---------------------------------------------------------------------------

/**
 * 士気クリーンアップ処理。
 * 1. 自トークンが敵占拠ロケールにある → 除去
 * 2. 自トークンが敵と隣接していないロケールにある → uncommitted へ返還
 * 3. フランスのみ（ラウンド11未満）: 投入済み1トークンを uncommitted へ返還可能
 * @param {string} activePlayer - 現在のアクティブプレイヤー
 * @param {number} round
 * @param {object} state
 * @returns {GameState}
 */
function moraleCleanup(activePlayer, round, state) {
  let next = cloneState(state);

  for (const side of [SIDES.FRANCE, SIDES.AUSTRIA]) {
    const enemy = side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;

    // 処理するトークンをコピー
    const toRemove = [];
    const toReturn = [];

    for (const token of next.moraleTokens.filter(t => t.side === side)) {
      // 1. 敵占拠ロケール（現在または最後に敵がいたロケール）
      const occupant = map.getLocaleOccupant(token.localeId, next);
      const lastOccupant = (next.localeLastOccupant ?? {})[token.localeId];
      if (occupant === enemy || (occupant === null && lastOccupant === enemy)) {
        toRemove.push(token);
        continue;
      }

      // 2. 敵と隣接していないロケール → uncommitted へ返還
      const adjacentLocales = map.getAdjacent(token.localeId).map(e => e.adjIdx);
      const hasEnemyNeighbor = adjacentLocales.some(adjIdx => {
        const occ = map.getLocaleOccupant(adjIdx, next);
        return occ === enemy;
      });
      if (!hasEnemyNeighbor) {
        toReturn.push(token);
      }
    }

    // 除去
    for (const token of toRemove) {
      const idx = next.moraleTokens.indexOf(token);
      if (idx !== -1) next.moraleTokens.splice(idx, 1);
    }

    // uncommitted へ返還
    for (const token of toReturn) {
      const idx = next.moraleTokens.indexOf(token);
      if (idx !== -1) {
        next.moraleTokens.splice(idx, 1);
        next.morale[side].uncommitted++;
      }
    }
  }

  // 3. フランス特権（ラウンド11未満）: TurnManager のインタラプションで処理するためここでは省略

  return next;
}

// ---------------------------------------------------------------------------
// フランス回収可能トークン
// ---------------------------------------------------------------------------

/**
 * フランスがこのターン回収できるトークンの一覧を返す。
 * 「このターン投入したもの」および「直前のオーストリアターンに移動されたもの」は除外する。
 * @param {object} state
 * @returns {Array<{ localeId: number, count: number }>}
 */
function getRecoverableTokens(state) {
  if (!state || !state.moraleTokens) return [];
  const placed = state.moraleTokensPlacedThisTurn || [];
  const placedByEnemy = state.moraleTokensPlacedByEnemyLastTurn || [];

  // 除外対象 = このターン置いたもの + 直前の相手ターンに置かれたもの（フランス分のみ）
  const excludeByLocale = {};
  for (const p of [...placed, ...placedByEnemy]) {
    if (p.side === SIDES.FRANCE) {
      excludeByLocale[p.localeId] = (excludeByLocale[p.localeId] || 0) + 1;
    }
  }

  // このターン置いたフランストークンをロケール別にカウント（互換性のため変数名維持）
  const placedCount = excludeByLocale;

  // マップ上のフランストークンをロケール別にカウント
  const totalCount = {};
  for (const t of state.moraleTokens) {
    if (t.side === SIDES.FRANCE) {
      totalCount[t.localeId] = (totalCount[t.localeId] || 0) + 1;
    }
  }

  // 回収可能 = 合計 − このターン置いた数
  const result = [];
  for (const [localeIdStr, total] of Object.entries(totalCount)) {
    const localeId = Number(localeIdStr);
    const thisPlaced = placedCount[localeId] || 0;
    const recoverable = total - thisPlaced;
    if (recoverable > 0) {
      result.push({ localeId, count: recoverable });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 崩壊判定
// ---------------------------------------------------------------------------

/**
 * いずれかの陣営の士気が 0 以下かチェックする。
 * @param {object} state
 * @returns {{ collapsed: boolean, side: string } | null}
 */
function checkMoraleCollapse(state) {
  for (const side of [SIDES.FRANCE, SIDES.AUSTRIA]) {
    if (_getTotalMorale(side, state) <= 0) {
      return { collapsed: true, side };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

module.exports = {
  periodicMoraleUpdate,
  investMorale,
  reduceMorale,
  moraleCleanup,
  checkMoraleCollapse,
  getTotalMorale: _getTotalMorale,
  getMapTokens,
  getRecoverableTokens,
};
