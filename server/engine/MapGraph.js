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
const DEFAULT_CAPACITY = 10;

function isOverCapacity(localeIdx, side, state) {
  const area = getLocale(localeIdx);
  const capacity = (area.capacity !== null && area.capacity !== undefined)
    ? area.capacity
    : DEFAULT_CAPACITY;
  return getLocaleCount(localeIdx, side, state) >= capacity;
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
 * 細道（thin road）のアクセス制限を返す。
 * null = 両軍使用可、'france' = 仏軍のみ、'austria' = 墺軍のみ。
 * thick road には適用しない（常に両軍使用可）。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {'france' | 'austria' | null}
 */
function getThinRoadAccess(localeIdx, edgeIdx) {
  const area = getLocale(localeIdx);
  return area.edges[edgeIdx]?.road_access ?? null;
}

/**
 * 指定サイドがそのエッジの細道を使用できるか判定する。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @param {'france' | 'austria'} side
 * @returns {boolean}
 */
function canSideUseThinRoad(localeIdx, edgeIdx, side) {
  const access = getThinRoadAccess(localeIdx, edgeIdx);
  if (access === null) return true;  // 両軍使用可
  return access === side;
}

/**
 * 2つの隣接ロケール間の道路タイプを返す。
 * 双方のエッジを確認し、thickまたはthinがあればそれを返す。
 * @param {number} localeA
 * @param {number} localeB
 * @returns {'thick' | 'thin' | 'none' | null}
 */
function getRoadTypeBetween(localeA, localeB) {
  // 複数辺が存在する場合は最良の道路タイプを返す（thick > thin > none）
  const adjs = getAdjacent(localeA).filter(e => e.adjIdx === localeB);
  if (adjs.length === 0) return null;
  const types = adjs.map(e => getRoadType(localeA, e.myEdgeIdx));
  if (types.includes('thick')) return 'thick';
  if (types.includes('thin')) return 'thin';
  return 'none';
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

/**
 * パス内の全細道セグメントが指定サイドに使用可能か判定する。
 * @param {number[]} path - ロケールidxのリスト
 * @param {'france' | 'austria'} side
 * @returns {boolean}
 */
function isPathAccessibleForSide(path, side) {
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to   = path[i + 1];
    const adjs = getAdjacent(from).filter(e => e.adjIdx === to);
    for (const { myEdgeIdx } of adjs) {
      const rt = getRoadType(from, myEdgeIdx);
      if (rt === 'thin' && !canSideUseThinRoad(from, myEdgeIdx, side)) {
        return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// 横断（Crossing）— エッジベース交通制限
// ---------------------------------------------------------------------------

/**
 * エッジの canonical crossing ID を返す。
 * 2つのロケールを結ぶ個別の道路が1つの「横断」。
 * 双方のエッジID（id と shared_with）のうち辞書順で小さい方を canonical ID とする。
 * @param {number} localeIdx
 * @param {number} edgeIdx
 * @returns {string | null}
 */
function getCanonicalCrossingId(localeIdx, edgeIdx) {
  const area = getLocale(localeIdx);
  const edge = area.edges[edgeIdx];
  if (!edge?.id) return null;
  const myId = edge.id;
  const theirId = edge.shared_with;
  if (!theirId) return myId;
  return myId < theirId ? myId : theirId;
}

/**
 * 2つのロケール間の全道路エッジを返す（指定サイドがアクセス可能なもの）。
 * エリア間に複数の道路がある場合、それぞれが独立した横断。
 * @param {number} localeA
 * @param {number} localeB
 * @param {'france' | 'austria' | null} side - null なら全エッジを返す
 * @returns {Array<{ edgeIdx: number, canonicalId: string, roadType: string }>}
 */
function getRoadEdgesBetween(localeA, localeB, side = null) {
  const adjs = getAdjacent(localeA).filter(e => e.adjIdx === localeB);
  const result = [];
  for (const { myEdgeIdx } of adjs) {
    const rt = getRoadType(localeA, myEdgeIdx);
    if (rt !== 'thick' && rt !== 'thin') continue;
    if (isImpassable(localeA, myEdgeIdx)) continue;
    if (rt === 'thin' && side && !canSideUseThinRoad(localeA, myEdgeIdx, side)) continue;
    const canonicalId = getCanonicalCrossingId(localeA, myEdgeIdx);
    if (!canonicalId) continue;
    result.push({ edgeIdx: myEdgeIdx, canonicalId, roadType: rt });
  }
  return result;
}

/**
 * 横断の交通制限チェック。
 *
 * 仕様:
 * - 1横断につき 1ターン最大3駒まで通過可。
 * - 後続の駒は直前に通過した駒より大きなステップ数で通過しなければならない。
 * - 一度使用された方向と逆方向からは通過不可（逆走禁止）。
 *
 * @param {string} canonicalId  - canonical crossing ID（エッジ ID）
 * @param {string} direction    - 方向文字列 "fromLocale->toLocale"
 * @param {number} minPieceStep - この駒が最早で通過できるステップ（前の横断ステップ+1）
 * @param {object} state        - GameState
 * @returns {{ canPass: boolean, minStep: number }} minStep は実際に通過するステップ
 */
function checkCrossingTraffic(canonicalId, direction, minPieceStep, state) {
  const traffic = state.crossingTraffic[canonicalId] || [];

  // 逆走禁止チェック（方向が異なる駒が既に通過していれば拒否）
  if (traffic.some(t => t.direction !== direction)) {
    return { canPass: false, minStep: Infinity };
  }

  // 最大3駒制限
  if (traffic.length >= 3) {
    return { canPass: false, minStep: Infinity };
  }

  // 空きスロット探索: minPieceStep 以上で最小の未使用ステップを選ぶ。
  // ステップ2が使用済みでもステップ1が空いていれば使用可能。
  // （1駒の行軍内では時刻は単調増加なので minPieceStep の下限は維持する）
  const usedSteps = new Set(traffic.map(t => t.steps));
  for (let step = minPieceStep; step <= 3; step++) {
    if (!usedSteps.has(step)) {
      return { canPass: true, minStep: step };
    }
  }

  return { canPass: false, minStep: Infinity };
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
  getThinRoadAccess,
  canSideUseThinRoad,
  isPathAccessibleForSide,

  // 横断
  getCanonicalCrossingId,
  getRoadEdgesBetween,
  checkCrossingTraffic,
};
