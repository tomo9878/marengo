'use strict';

/**
 * MapGraph.js
 * マップの位相計算（隣接・アプローチ・道路・横断）
 *
 * map.json を読み込み、ゲームロジックが必要とする
 * 全ての地理的クエリに答える。
 */

const mapData = require('../../data/map.json');

// ---------------------------------------------------------------------------
// 内部キャッシュ構築
// ---------------------------------------------------------------------------

// idx -> area のマップ
const areaByIdx = new Map(mapData.areas.map(a => [a.idx, a]));

// 隣接関係の逆引きキャッシュ
// adjacencyMap[localeIdx] = [ { adjIdx, myEdgeIdx, theirEdgeIdx } ]
const adjacencyMap = new Map();
for (const area of mapData.areas) {
  if (!adjacencyMap.has(area.idx)) adjacencyMap.set(area.idx, []);
  for (let i = 0; i < area.edges.length; i++) {
    const edge = area.edges[i];
    if (edge.adj_area_idx !== null && edge.adj_area_idx !== undefined) {
      adjacencyMap.get(area.idx).push({
        adjIdx:     edge.adj_area_idx,
        myEdgeIdx:  i,
        theirEdgeIdx: null,  // 後で埋める
      });
    }
  }
}
// theirEdgeIdx を逆引きで埋める
for (const area of mapData.areas) {
  for (let i = 0; i < area.edges.length; i++) {
    const edge = area.edges[i];
    if (edge.adj_area_idx === null || edge.adj_area_idx === undefined) continue;
    const adjList = adjacencyMap.get(edge.adj_area_idx) || [];
    const entry = adjList.find(e => e.adjIdx === area.idx && e.theirEdgeIdx === null);
    if (entry) entry.theirEdgeIdx = i;
  }
}

// ---------------------------------------------------------------------------
// ロケールの基本情報
// ---------------------------------------------------------------------------

/**
 * ロケールデータを取得する。
 * @param {number} localeIdx
 * @returns {object}
 */
function getLocale(localeIdx) {
  const area = areaByIdx.get(localeIdx);
  if (!area) throw new Error(`Unknown locale: ${localeIdx}`);
  return area;
}

/**
 * 隣接ロケールの一覧を返す。
 * @param {number} localeIdx
 * @returns {Array<{ adjIdx, myEdgeIdx, theirEdgeIdx }>}
 */
function getAdjacent(localeIdx) {
  return adjacencyMap.get(localeIdx) || [];
}

/**
 * 2つのロケールが隣接しているか判定する。
 * @param {number} idxA
 * @param {number} idxB
 * @returns {boolean}
 */
function isAdjacent(idxA, idxB) {
  return getAdjacent(idxA).some(e => e.adjIdx === idxB);
}

/**
 * ロケール A の edgeIdx に対応する向かい側アプローチ（ロケール B 側）を返す。
 * @param {number} localeA
 * @param {number} edgeIdxA - A 側のエッジインデックス
 * @returns {{ localeIdx: number, edgeIdx: number } | null}
 */
function getOppositeApproach(localeA, edgeIdxA) {
  const adj = getAdjacent(localeA).find(e => e.myEdgeIdx === edgeIdxA);
  if (!adj) return null;
  return { localeIdx: adj.adjIdx, edgeIdx: adj.theirEdgeIdx };
}

// ---------------------------------------------------------------------------
// アプローチ属性
// ---------------------------------------------------------------------------

/**
 * アプローチ幅を返す。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {'narrow' | 'wide' | null}  null = 未設定(TODO)
 */
function getApproachWidth(localeIdx, edgeIdx) {
  const area = getLocale(localeIdx);
  return area.edges[edgeIdx]?.width ?? null;
}

/**
 * アプローチのシンボル一覧を返す。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {string[]}  例: ['inf_penalty', 'cav_obstacle']
 */
function getApproachSymbols(localeIdx, edgeIdx) {
  const area = getLocale(localeIdx);
  return area.edges[edgeIdx]?.symbols ?? [];
}

/**
 * アプローチが通行不可か判定する。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {boolean}
 */
function isImpassable(localeIdx, edgeIdx) {
  return getApproachSymbols(localeIdx, edgeIdx).includes('impassable');
}

/**
 * アプローチが騎兵障害物を持つか判定する。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {boolean}
 */
function hasCavalryObstacle(localeIdx, edgeIdx) {
  return getApproachSymbols(localeIdx, edgeIdx).includes('cav_obstacle');
}

/**
 * アプローチに歩兵/騎兵ペナルティがあるか判定する。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {boolean}
 */
function hasInfCavPenalty(localeIdx, edgeIdx) {
  return getApproachSymbols(localeIdx, edgeIdx).includes('inf_penalty');
}

/**
 * アプローチに砲兵ペナルティがあるか判定する。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {boolean}
 */
function hasArtilleryPenalty(localeIdx, edgeIdx) {
  return getApproachSymbols(localeIdx, edgeIdx).includes('artillery_penalty');
}

// ---------------------------------------------------------------------------
// ブロック判定
// ---------------------------------------------------------------------------

/**
 * 指定アプローチをブロックしている駒の一覧を返す。
 * @param {number} localeIdx - そのアプローチを持つロケール
 * @param {number} edgeIdx
 * @param {object} state - GameState
 * @returns {object[]} - PieceState の配列
 */
function getBlockingPieces(localeIdx, edgeIdx, state) {
  const posKey = `approach_${edgeIdx}`;
  return Object.values(state.pieces).filter(
    p => p.localeId === localeIdx && p.position === posKey
  );
}

/**
 * 完全ブロックに必要な駒数を返す。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {number} 1（narrow）または 2（wide）
 */
function getBlockRequirement(localeIdx, edgeIdx) {
  const width = getApproachWidth(localeIdx, edgeIdx);
  return width === 'wide' ? 2 : 1;
}

/**
 * アプローチが完全ブロックされているか判定する。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @param {object} state
 * @returns {boolean}
 */
function isFullyBlocked(localeIdx, edgeIdx, state) {
  const pieces = getBlockingPieces(localeIdx, edgeIdx, state);
  return pieces.length >= getBlockRequirement(localeIdx, edgeIdx);
}

/**
 * アプローチが部分ブロックされているか判定する（wide の場合に駒1つ）。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @param {object} state
 * @returns {boolean}
 */
function isPartiallyBlocked(localeIdx, edgeIdx, state) {
  const pieces = getBlockingPieces(localeIdx, edgeIdx, state);
  const required = getBlockRequirement(localeIdx, edgeIdx);
  return pieces.length > 0 && pieces.length < required;
}

// ---------------------------------------------------------------------------
// ロケールの占拠状態
// ---------------------------------------------------------------------------

/**
 * ロケールを占拠している軍を返す。
 * いずれかのポジションに駒が1つでもあれば占拠とみなす。
 * @param {number} localeIdx
 * @param {object} state
 * @returns {'france' | 'austria' | null}
 */
function getLocaleOccupant(localeIdx, state) {
  const pieces = Object.values(state.pieces).filter(p => p.localeId === localeIdx);
  if (pieces.length === 0) return null;
  // 両軍が混在することはゲーム上ないが、念のため多数側を返す
  const sides = pieces.map(p => p.side);
  return sides.includes('france') ? 'france' : 'austria';
}

/**
 * 指定ポジションにいる駒の一覧を返す。
 * @param {number} localeIdx
 * @param {string} position - 'reserve' | 'approach_N'
 * @param {object} state
 * @returns {object[]}
 */
function getPiecesAt(localeIdx, position, state) {
  return Object.values(state.pieces).filter(
    p => p.localeId === localeIdx && p.position === position
  );
}

/**
 * ロケール内の指定陣営の駒数を返す。
 * @param {number} localeIdx
 * @param {string} side
 * @param {object} state
 * @returns {number}
 */
function getLocaleCount(localeIdx, side, state) {
  return Object.values(state.pieces).filter(
    p => p.localeId === localeIdx && p.side === side
  ).length;
}

/**
 * ロケール制限を超えているか判定する。
 * @param {number} localeIdx
 * @param {string} side
 * @param {object} state
 * @returns {boolean}
 */
function isOverCapacity(localeIdx, side, state) {
  const area = getLocale(localeIdx);
  if (area.capacity === null || area.capacity === undefined) return false;
  return getLocaleCount(localeIdx, side, state) >= area.capacity;
}

// ---------------------------------------------------------------------------
// 道路グラフ
// ---------------------------------------------------------------------------

/**
 * 道路のエッジタイプを返す。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {'thick' | 'thin' | 'none' | null}
 */
function getRoadType(localeIdx, edgeIdx) {
  const area = getLocale(localeIdx);
  return area.edges[edgeIdx]?.road_type ?? null;
}

/**
 * 2つの隣接ロケール間の道路タイプを返す。
 * 双方のエッジを確認し、thickまたはthinがあればそれを返す。
 * @param {number} localeA
 * @param {number} localeB
 * @returns {'thick' | 'thin' | 'none' | null}
 */
function getRoadTypeBetween(localeA, localeB) {
  const adj = getAdjacent(localeA).find(e => e.adjIdx === localeB);
  if (!adj) return null;
  return getRoadType(localeA, adj.myEdgeIdx);
}

/**
 * 道路行軍のパスを BFS で探索する（最大3ステップ）。
 * 側道または主要道路を経由するパスを返す。
 *
 * @param {number} fromIdx   - 出発ロケール
 * @param {number} toIdx     - 目的ロケール
 * @param {'thick'|'thin'|'any'} roadType - 'thick'=主要道路のみ, 'any'=どちらも可
 * @returns {number[] | null} - 経由ロケールのリスト（from 含む、to 含む）、なければ null
 */
function getRoadPath(fromIdx, toIdx, roadType = 'any') {
  const maxSteps = 3;
  const queue = [[fromIdx]];
  const visited = new Set([fromIdx]);

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];

    if (current === toIdx) return path;
    if (path.length - 1 >= maxSteps) continue;

    for (const { adjIdx, myEdgeIdx } of getAdjacent(current)) {
      if (visited.has(adjIdx)) continue;
      const rt = getRoadType(current, myEdgeIdx);
      const validRoad = roadType === 'thick'
        ? rt === 'thick'
        : (rt === 'thick' || rt === 'thin');
      if (!validRoad) continue;
      if (isImpassable(current, myEdgeIdx)) continue;
      visited.add(adjIdx);
      queue.push([...path, adjIdx]);
    }
  }
  return null;
}

/**
 * 道路行軍で到達可能なロケール一覧を返す（最大3ステップ）。
 * @param {number} fromIdx
 * @param {'thick'|'any'} roadType
 * @returns {Array<{ localeIdx, path, steps }>}
 */
function getReachableByRoad(fromIdx, roadType = 'any') {
  const maxSteps = 3;
  const results = [];
  const queue = [[fromIdx]];
  const visited = new Set([fromIdx]);

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];
    const steps = path.length - 1;

    if (steps > 0) {
      results.push({ localeIdx: current, path: [...path], steps });
    }
    if (steps >= maxSteps) continue;

    for (const { adjIdx, myEdgeIdx } of getAdjacent(current)) {
      if (visited.has(adjIdx)) continue;
      const rt = getRoadType(current, myEdgeIdx);
      const validRoad = roadType === 'thick'
        ? rt === 'thick'
        : (rt === 'thick' || rt === 'thin');
      if (!validRoad) continue;
      if (isImpassable(current, myEdgeIdx)) continue;
      visited.add(adjIdx);
      queue.push([...path, adjIdx]);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 横断（Crossing）
// ---------------------------------------------------------------------------

/**
 * 2つの隣接ロケール間の横断情報を返す。
 * @param {number} localeA
 * @param {number} localeB
 * @returns {object | null} crossings エントリ
 */
function getCrossing(localeA, localeB) {
  return mapData.crossings?.find(
    c => (c.localeA === localeA && c.localeB === localeB) ||
         (c.localeA === localeB && c.localeB === localeA)
  ) ?? null;
}

/**
 * 横断の交通制限チェック。
 * 同一ターン中、横断を通過できる駒は最大3つ。
 * また各駒は前の駒よりも多いステップ数が必要。
 *
 * @param {string} crossingId
 * @param {number} currentSteps - 今通過しようとしている駒のステップ数
 * @param {object} state
 * @returns {{ canPass: boolean, mustWaitSteps: number }}
 */
function checkCrossingTraffic(crossingId, currentSteps, state) {
  const traffic = state.crossingTraffic[crossingId] || [];
  if (traffic.length >= 3) return { canPass: false, mustWaitSteps: Infinity };

  const lastSteps = traffic.length > 0 ? traffic[traffic.length - 1].steps : -1;
  if (currentSteps <= lastSteps) {
    return { canPass: false, mustWaitSteps: lastSteps + 1 };
  }
  return { canPass: true, mustWaitSteps: 0 };
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

module.exports = {
  // 基本情報
  getLocale,
  getAdjacent,
  isAdjacent,
  getOppositeApproach,

  // アプローチ属性
  getApproachWidth,
  getApproachSymbols,
  isImpassable,
  hasCavalryObstacle,
  hasInfCavPenalty,
  hasArtilleryPenalty,

  // ブロック判定
  getBlockingPieces,
  getBlockRequirement,
  isFullyBlocked,
  isPartiallyBlocked,

  // ロケール状態
  getLocaleOccupant,
  getPiecesAt,
  getLocaleCount,
  isOverCapacity,

  // 道路
  getRoadType,
  getRoadTypeBetween,
  getRoadPath,
  getReachableByRoad,

  // 横断
  getCrossing,
  checkCrossingTraffic,
};
