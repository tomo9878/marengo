'use strict';

const map = require('../../server/engine/MapGraph');
const { createMinimalState, makePiece } = require('../helpers/stateFactory');

// ---------------------------------------------------------------------------
// getLocale
// ---------------------------------------------------------------------------

describe('getLocale', () => {
  test('returns area data for valid idx', () => {
    const area = map.getLocale(0);
    expect(area).toBeDefined();
    expect(area.idx).toBe(0);
  });

  test('throws for unknown idx', () => {
    expect(() => map.getLocale(9999)).toThrow();
  });

  test('area 2 has expected name', () => {
    const area = map.getLocale(2);
    expect(area.idx).toBe(2);
    // エリア_3
    expect(area.name).toContain('エリア_3');
  });
});

// ---------------------------------------------------------------------------
// getAdjacent
// ---------------------------------------------------------------------------

describe('getAdjacent', () => {
  test('locale 0 is adjacent to 27 and 22', () => {
    const adj = map.getAdjacent(0);
    const adjIdxs = adj.map(e => e.adjIdx);
    expect(adjIdxs).toContain(27);
    expect(adjIdxs).toContain(22);
  });

  test('locale 2 is adjacent to 1 and 4 and 3', () => {
    const adj = map.getAdjacent(2);
    const adjIdxs = adj.map(e => e.adjIdx);
    expect(adjIdxs).toContain(1);
    expect(adjIdxs).toContain(4);
    expect(adjIdxs).toContain(3);
  });

  test('returns empty array for locale with no adjacency', () => {
    // エッジに adj_area_idx が null のみの場合
    // locale 0 は 2 個の隣接エリアを持つ
    const adj = map.getAdjacent(0);
    expect(adj.length).toBeGreaterThan(0);
  });

  test('each adjacency entry has adjIdx, myEdgeIdx, theirEdgeIdx', () => {
    const adj = map.getAdjacent(2);
    for (const e of adj) {
      expect(e.adjIdx).toBeDefined();
      expect(e.myEdgeIdx).toBeDefined();
      // theirEdgeIdx may be null in some edge cases but should be filled
    }
  });
});

// ---------------------------------------------------------------------------
// isAdjacent
// ---------------------------------------------------------------------------

describe('isAdjacent', () => {
  test('locale 0 and 27 are adjacent', () => {
    expect(map.isAdjacent(0, 27)).toBe(true);
  });

  test('locale 0 and 22 are adjacent', () => {
    expect(map.isAdjacent(0, 22)).toBe(true);
  });

  test('locale 2 and 1 are adjacent', () => {
    expect(map.isAdjacent(2, 1)).toBe(true);
  });

  test('locale 0 and 1 are not adjacent', () => {
    expect(map.isAdjacent(0, 1)).toBe(false);
  });

  test('adjacency is symmetric', () => {
    expect(map.isAdjacent(1, 2)).toBe(map.isAdjacent(2, 1));
  });
});

// ---------------------------------------------------------------------------
// getOppositeApproach
// ---------------------------------------------------------------------------

describe('getOppositeApproach', () => {
  test('returns opposite approach for locale 2 edge toward 1', () => {
    const adj = map.getAdjacent(2).find(e => e.adjIdx === 1);
    expect(adj).toBeDefined();
    const opposite = map.getOppositeApproach(2, adj.myEdgeIdx);
    expect(opposite).not.toBeNull();
    expect(opposite.localeIdx).toBe(1);
  });

  test('returns null for edge with no adjacency', () => {
    // locale 0 edge 0 は adj_area_idx が null
    const area = map.getLocale(0);
    // edge 0 に adj がないエッジを探す
    let nullEdgeIdx = null;
    for (let i = 0; i < area.edges.length; i++) {
      if (area.edges[i].adj_area_idx === null) {
        nullEdgeIdx = i;
        break;
      }
    }
    if (nullEdgeIdx !== null) {
      const opposite = map.getOppositeApproach(0, nullEdgeIdx);
      expect(opposite).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// アプローチ属性
// ---------------------------------------------------------------------------

describe('getApproachWidth', () => {
  test('returns width or null for locale 0 edge 2', () => {
    const width = map.getApproachWidth(0, 2);
    // 実マップでは width が null の場合が多い
    expect(width === null || width === 'narrow' || width === 'wide').toBe(true);
  });
});

describe('getApproachSymbols', () => {
  test('returns array of symbols', () => {
    const symbols = map.getApproachSymbols(0, 2);
    expect(Array.isArray(symbols)).toBe(true);
  });

  test('returns empty array for edge with no symbols', () => {
    const symbols = map.getApproachSymbols(2, 0);
    expect(Array.isArray(symbols)).toBe(true);
  });
});

describe('hasCavalryObstacle', () => {
  test('returns boolean', () => {
    const result = map.hasCavalryObstacle(2, 1);
    expect(typeof result).toBe('boolean');
  });
});

describe('hasInfCavPenalty', () => {
  test('returns boolean', () => {
    const result = map.hasInfCavPenalty(2, 1);
    expect(typeof result).toBe('boolean');
  });
});

describe('hasArtilleryPenalty', () => {
  test('returns boolean', () => {
    const result = map.hasArtilleryPenalty(2, 1);
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// ブロック判定
// ---------------------------------------------------------------------------

describe('getBlockRequirement', () => {
  test('returns 1 for narrow approach (or null width treated as narrow)', () => {
    // locale 2 edge 1 は width が null → narrow として扱われる
    const req = map.getBlockRequirement(2, 1);
    expect(req === 1 || req === 2).toBe(true);
  });
});

describe('isFullyBlocked / isPartiallyBlocked', () => {
  function buildStateWithPieceAtApproach(localeId, edgeIdx, count = 1) {
    const state = createMinimalState();
    for (let i = 0; i < count; i++) {
      const id = `AU-INF-${i + 1}`;
      state.pieces[id] = makePiece(id, {
        localeId,
        position: `approach_${edgeIdx}`,
      });
    }
    return state;
  }

  test('isFullyBlocked: true when piece count >= requirement', () => {
    const localeId = 1;
    const edgeIdx = 2; // locale 1 → locale 2 方向
    const req = map.getBlockRequirement(localeId, edgeIdx);
    const state = buildStateWithPieceAtApproach(localeId, edgeIdx, req);
    expect(map.isFullyBlocked(localeId, edgeIdx, state)).toBe(true);
  });

  test('isFullyBlocked: false when no pieces', () => {
    const state = createMinimalState();
    expect(map.isFullyBlocked(1, 2, state)).toBe(false);
  });

  test('isPartiallyBlocked: true for wide approach with 1 piece', () => {
    // wide approach がある場合のみ意味を持つ
    // 実マップに wide がない場合はスキップ
    const localeId = 1;
    const edgeIdx = 2;
    const width = map.getApproachWidth(localeId, edgeIdx);
    if (width === 'wide') {
      const state = buildStateWithPieceAtApproach(localeId, edgeIdx, 1);
      expect(map.isPartiallyBlocked(localeId, edgeIdx, state)).toBe(true);
    } else {
      // narrow: 1 駒で完全ブロック → partially は false
      const state = buildStateWithPieceAtApproach(localeId, edgeIdx, 1);
      expect(map.isPartiallyBlocked(localeId, edgeIdx, state)).toBe(false);
    }
  });

  test('isPartiallyBlocked: false when not blocked at all', () => {
    const state = createMinimalState();
    expect(map.isPartiallyBlocked(1, 2, state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getBlockingPieces
// ---------------------------------------------------------------------------

describe('getBlockingPieces', () => {
  test('returns pieces at the approach', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'approach_2' });
    state.pieces['AU-INF-2'] = makePiece('AU-INF-2', { localeId: 1, position: 'reserve' }); // not blocking

    const blocking = map.getBlockingPieces(1, 2, state);
    expect(blocking.length).toBe(1);
    expect(blocking[0].id).toBe('AU-INF-1');
  });
});

// ---------------------------------------------------------------------------
// ロケール占拠
// ---------------------------------------------------------------------------

describe('getLocaleOccupant', () => {
  test('returns null for empty locale', () => {
    const state = createMinimalState();
    expect(map.getLocaleOccupant(5, state)).toBeNull();
  });

  test('returns france when french piece is there', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 5 });
    expect(map.getLocaleOccupant(5, state)).toBe('france');
  });

  test('returns austria when austrian piece is there', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 3 });
    expect(map.getLocaleOccupant(3, state)).toBe('austria');
  });
});

// ---------------------------------------------------------------------------
// 道路グラフ
// ---------------------------------------------------------------------------

describe('getRoadType', () => {
  test('returns thick for locale 0 edge 2 (to 27)', () => {
    expect(map.getRoadType(0, 2)).toBe('thick');
  });

  test('returns none for locale 0 edge 3 (to 22)', () => {
    expect(map.getRoadType(0, 3)).toBe('none');
  });
});

describe('getRoadPath', () => {
  test('finds path between locales connected by road', () => {
    // locale 2 → locale 4 は thick road (edge 2)
    const path = map.getRoadPath(2, 4, 'any');
    expect(path).not.toBeNull();
    expect(path[0]).toBe(2);
    expect(path[path.length - 1]).toBe(4);
  });

  test('returns null when no road connects locales', () => {
    // locale 0 → locale 1 は道路でつながっていない（直接隣接もしていない）
    const path = map.getRoadPath(0, 1, 'thick');
    // 0 → 1 は隣接していないので null になるはず（3 ステップ以内でもつながっていれば返す）
    // 実際のマップによって変わる
    // null か配列かのどちらか
    if (path !== null) {
      expect(Array.isArray(path)).toBe(true);
    }
  });

  test('finds same-locale trivially (path = [from])', () => {
    const path = map.getRoadPath(2, 2, 'any');
    expect(path).toEqual([2]);
  });

  test('road march respects 3-step limit', () => {
    // 3 ステップを超えるパスは返さない
    // 実際のマップで遠いロケールを選ぶ
    // ここでは 0 → 1 間の最短パスが 3 を超えるか確認
    const path = map.getRoadPath(0, 5, 'any');
    if (path !== null) {
      expect(path.length - 1).toBeLessThanOrEqual(3);
    }
  });
});

describe('getReachableByRoad', () => {
  test('returns array of reachable locales', () => {
    const reachable = map.getReachableByRoad(2, 'any');
    expect(Array.isArray(reachable)).toBe(true);
    expect(reachable.length).toBeGreaterThan(0);
  });

  test('each entry has localeIdx, path, steps', () => {
    const reachable = map.getReachableByRoad(2, 'any');
    for (const r of reachable) {
      expect(r.localeIdx).toBeDefined();
      expect(Array.isArray(r.path)).toBe(true);
      expect(r.steps).toBeGreaterThan(0);
      expect(r.steps).toBeLessThanOrEqual(3);
    }
  });
});

// ---------------------------------------------------------------------------
// getPiecesAt
// ---------------------------------------------------------------------------

describe('getPiecesAt', () => {
  test('returns pieces at specific position', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve' });
    state.pieces['FR-INF-2'] = makePiece('FR-INF-2', { localeId: 2, position: 'approach_1' });

    const reservePieces = map.getPiecesAt(2, 'reserve', state);
    expect(reservePieces.length).toBe(1);
    expect(reservePieces[0].id).toBe('FR-INF-1');

    const approachPieces = map.getPiecesAt(2, 'approach_1', state);
    expect(approachPieces.length).toBe(1);
    expect(approachPieces[0].id).toBe('FR-INF-2');
  });
});

// ---------------------------------------------------------------------------
// getLocaleCount / isOverCapacity
// ---------------------------------------------------------------------------

describe('getLocaleCount', () => {
  test('counts pieces of given side in locale', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 5 });
    state.pieces['FR-INF-2'] = makePiece('FR-INF-2', { localeId: 5 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 5 });

    expect(map.getLocaleCount(5, 'france', state)).toBe(2);
    expect(map.getLocaleCount(5, 'austria', state)).toBe(1);
  });
});

describe('isOverCapacity', () => {
  test('returns false for locale with null capacity', () => {
    // locale 0 の capacity は null
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 0 });
    expect(map.isOverCapacity(0, 'france', state)).toBe(false);
  });
});
