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
 * @param {number} round
 * @param {object} state
 * @returns {GameState}
 */
function periodicMoraleUpdate(round, state) {
  const next = cloneState(state);
  const entry = scenarios.timeTrack.find(t => t.round === round);
  if (!entry) return next;

  const { moraleGain } = entry;

  // 各陣営の uncommitted を増加（total の上限は超えない）
  for (const side of [SIDES.FRANCE, SIDES.AUSTRIA]) {
    const gain = moraleGain[side] ?? 0;
    if (gain > 0) {
      const currentTotal = _getTotalMorale(side, next);
      // uncommitted に追加（total を超えない）
      next.morale[side].uncommitted += gain;
    }
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

  for (let i = 0; i < count; i++) {
    if (next.morale[side].uncommitted > 0) {
      next.morale[side].uncommitted--;
      next.moraleTokens.push({ side, localeId });
    } else {
      // uncommitted 不足: 相手のマップトークンを奪う
      const opponent = side === SIDES.FRANCE ? SIDES.AUSTRIA : SIDES.FRANCE;
      const oppTokens = next.moraleTokens.filter(t => t.side === opponent);
      if (oppTokens.length > 0) {
        // 相手が選択する（ここではゲーム上の優先順位に従い、最初のトークンを除去）
        const tokenToRemove = oppTokens[0];
        const idx = next.moraleTokens.indexOf(tokenToRemove);
        next.moraleTokens.splice(idx, 1);
        // 除去した分を投入
        next.moraleTokens.push({ side, localeId });
      }
      // それも不足の場合は無視（ゲーム終了条件になるはず）
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

  // 次にマップトークンから除去（どのロケールかは敗者が選ぶ。ここでは先頭から）
  while (remaining > 0) {
    const ownTokens = next.moraleTokens.filter(t => t.side === side);
    if (ownTokens.length === 0) break;

    // 敗者の選択（デフォルトは最初のトークン）
    const tokenToRemove = ownTokens[0];
    const idx = next.moraleTokens.indexOf(tokenToRemove);
    next.moraleTokens.splice(idx, 1);
    remaining--;
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
      // 1. 敵占拠ロケール
      const occupant = map.getLocaleOccupant(token.localeId, next);
      if (occupant === enemy) {
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

  // 3. フランスのみ（ラウンド11未満: 4:00PM前）: 1トークン返還
  // ラウンド11以降は不可（4:00PMから）
  if (activePlayer === SIDES.FRANCE && round < 11) {
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    if (franceTokens.length > 0) {
      // 最初の1トークンを返還（このターン移動していないものを選ぶ、ここでは先頭）
      const token = franceTokens[0];
      const idx = next.moraleTokens.indexOf(token);
      if (idx !== -1) {
        next.moraleTokens.splice(idx, 1);
        next.morale[SIDES.FRANCE].uncommitted++;
      }
    }
  }

  return next;
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
};
