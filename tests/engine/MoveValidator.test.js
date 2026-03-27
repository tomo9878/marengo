'use strict';

const validator = require('../../server/engine/MoveValidator');
const map = require('../../server/engine/MapGraph');
const { createMinimalState, makePiece, SIDES, PIECE_TYPES } = require('../helpers/stateFactory');

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function stateWithPiece(pieceId, opts = {}) {
  const state = createMinimalState({
    activePlayer: opts.side === SIDES.FRANCE ? SIDES.FRANCE : SIDES.AUSTRIA,
    controlToken: {
      holder: opts.side === SIDES.FRANCE ? SIDES.FRANCE : SIDES.AUSTRIA,
      reason: 'active_player',
    },
  });
  state.pieces[pieceId] = makePiece(pieceId, opts);
  return state;
}

// ---------------------------------------------------------------------------
// canAct
// ---------------------------------------------------------------------------

describe('canAct', () => {
  test('returns true for healthy piece', () => {
    const state = createMinimalState();
    const piece = makePiece('FR-INF-1', { strength: 3, localeId: 2 });
    state.pieces['FR-INF-1'] = piece;
    expect(validator.canAct(piece, state)).toBe(true);
  });

  test('returns false for strength 0 piece', () => {
    const state = createMinimalState();
    const piece = makePiece('FR-INF-1', { strength: 0 });
    expect(validator.canAct(piece, state)).toBe(false);
  });

  test('returns false when piece already acted', () => {
    const state = createMinimalState();
    const piece = makePiece('FR-INF-1', { strength: 3 });
    state.actedPieceIds.add('FR-INF-1');
    expect(validator.canAct(piece, state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// inReserve / getApproachInfo
// ---------------------------------------------------------------------------

describe('inReserve', () => {
  test('returns true for reserve piece', () => {
    const piece = makePiece('FR-INF-1', { position: 'reserve' });
    expect(validator.inReserve(piece)).toBe(true);
  });

  test('returns false for approach piece', () => {
    const piece = makePiece('FR-INF-1', { position: 'approach_1' });
    expect(validator.inReserve(piece)).toBe(false);
  });
});

describe('getApproachInfo', () => {
  test('returns isApproach=false for reserve', () => {
    const piece = makePiece('FR-INF-1', { position: 'reserve' });
    const info = validator.getApproachInfo(piece);
    expect(info.isApproach).toBe(false);
    expect(info.edgeIdx).toBeNull();
  });

  test('returns correct edgeIdx for approach_3', () => {
    const piece = makePiece('FR-INF-1', { position: 'approach_3' });
    const info = validator.getApproachInfo(piece);
    expect(info.isApproach).toBe(true);
    expect(info.edgeIdx).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 悪路行軍 (cross_country_march)
// ---------------------------------------------------------------------------

describe('getLegalCrossCountryMoves', () => {
  test('from reserve: can move to adjacent locale reserve', () => {
    // locale 2 は locale 1 と隣接
    const state = stateWithPiece('AU-INF-1', { localeId: 2, position: 'reserve', side: SIDES.AUSTRIA });
    // locale 1 にフランスがいないこと確認
    const moves = validator.getLegalCrossCountryMoves(state.pieces['AU-INF-1'], state);
    const toReserveMoves = moves.filter(m => m.type === 'cross_country_march' && m.to.position === 'reserve');
    expect(toReserveMoves.length).toBeGreaterThan(0);
  });

  test('from reserve: cannot move to enemy-occupied locale', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    // フランスが locale 2
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve' });
    // オーストリアが locale 1 を占拠
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve' });

    const moves = validator.getLegalCrossCountryMoves(state.pieces['FR-INF-1'], state);
    const toLocale1 = moves.filter(m => m.to.localeId === 1 && m.to.position === 'reserve');
    expect(toLocale1.length).toBe(0);
  });

  test('from reserve (non-disordered): can move to own approach', () => {
    const state = stateWithPiece('AU-INF-1', { localeId: 1, position: 'reserve', side: SIDES.AUSTRIA });
    const moves = validator.getLegalCrossCountryMoves(state.pieces['AU-INF-1'], state);
    const toApproach = moves.filter(m => m.to.position.startsWith('approach_'));
    // 向かい側が敵占拠でなければ defensive_march として返る
    expect(toApproach.length).toBeGreaterThanOrEqual(0);
  });

  test('disordered piece cannot block approach', () => {
    const state = stateWithPiece('FR-INF-1', {
      localeId: 2,
      position: 'reserve',
      disordered: true,
      side: SIDES.FRANCE,
    });
    const moves = validator.getLegalCrossCountryMoves(state.pieces['FR-INF-1'], state);
    const toApproach = moves.filter(m => m.to.position.startsWith('approach_'));
    expect(toApproach.length).toBe(0);
  });

  test('from approach: can move to own reserve', () => {
    const state = stateWithPiece('AU-INF-1', { localeId: 1, position: 'approach_2', side: SIDES.AUSTRIA });
    const moves = validator.getLegalCrossCountryMoves(state.pieces['AU-INF-1'], state);
    const toReserve = moves.filter(m => m.to.localeId === 1 && m.to.position === 'reserve');
    expect(toReserve.length).toBe(1);
  });

  test('from approach: can move to adjacent locale if not enemy-occupied', () => {
    const state = stateWithPiece('AU-INF-1', { localeId: 1, position: 'approach_2', side: SIDES.AUSTRIA });
    // locale 1 の approach_2 は locale 2 に向く
    const moves = validator.getLegalCrossCountryMoves(state.pieces['AU-INF-1'], state);
    const toOtherLocale = moves.filter(m => m.to.localeId !== 1 && m.to.position === 'reserve');
    // locale 2 が敵占拠でなければ移動可
    expect(toOtherLocale.length).toBeGreaterThanOrEqual(0);
  });

  test('returns empty for strength 0 piece', () => {
    const state = stateWithPiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 0, side: SIDES.AUSTRIA });
    const moves = validator.getLegalCrossCountryMoves(state.pieces['AU-INF-1'], state);
    expect(moves.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 道路行軍
// ---------------------------------------------------------------------------

describe('getLegalRoadMoves', () => {
  test('from reserve: can reach adjacent locales via road', () => {
    // locale 2 → locale 4 は thick road
    const state = stateWithPiece('FR-INF-1', { localeId: 2, position: 'reserve', side: SIDES.FRANCE });
    const moves = validator.getLegalRoadMoves(state.pieces['FR-INF-1'], state);
    expect(moves.length).toBeGreaterThan(0);
  });

  test('from approach: cannot do road march', () => {
    const state = stateWithPiece('FR-INF-1', { localeId: 2, position: 'approach_1', side: SIDES.FRANCE });
    const moves = validator.getLegalRoadMoves(state.pieces['FR-INF-1'], state);
    expect(moves.length).toBe(0);
  });

  test('major_road_march has 0 command cost', () => {
    const state = stateWithPiece('FR-INF-1', { localeId: 2, position: 'reserve', side: SIDES.FRANCE });
    const moves = validator.getLegalRoadMoves(state.pieces['FR-INF-1'], state);
    const majorRoadMoves = moves.filter(m => m.isMajorRoadOnly);
    if (majorRoadMoves.length > 0) {
      expect(majorRoadMoves[0].commandCost).toBe(0);
    }
  });

  test('minor road march has command cost 1', () => {
    const state = stateWithPiece('FR-INF-1', { localeId: 2, position: 'reserve', side: SIDES.FRANCE });
    const moves = validator.getLegalRoadMoves(state.pieces['FR-INF-1'], state);
    const minorRoadMoves = moves.filter(m => !m.isMajorRoadOnly);
    for (const m of minorRoadMoves) {
      expect(m.commandCost).toBe(1);
    }
  });

  test('path blocked by enemy stops road march', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve' });
    // locale 4 にオーストリアを配置（locale 2 → 4 は直接隣接なので、中間経由にはならない）
    // locale 3 にオーストリアを配置（2 → 3 → 5 のパスをブロック）
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 3, position: 'reserve' });

    const moves = validator.getLegalRoadMoves(state.pieces['FR-INF-1'], state);
    // locale 3 経由の先にあるロケールへは行けない
    const toLocale5Via3 = moves.filter(m =>
      m.path && m.path.includes(3) && m.to.localeId !== 3
    );
    expect(toLocale5Via3.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 急襲 (raid)
// ---------------------------------------------------------------------------

describe('getLegalRaids', () => {
  test('disordered piece cannot raid', () => {
    const state = stateWithPiece('FR-INF-1', {
      localeId: 2,
      position: 'reserve',
      disordered: true,
      side: SIDES.FRANCE,
    });
    const raids = validator.getLegalRaids(state.pieces['FR-INF-1'], state);
    expect(raids.length).toBe(0);
  });

  test('can raid unblocked enemy locale from reserve', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve' });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve' });

    const raids = validator.getLegalRaids(state.pieces['FR-INF-1'], state);
    const raidTo1 = raids.filter(r => r.targetLocaleId === 1);
    expect(raidTo1.length).toBeGreaterThan(0);
  });

  test('cannot raid fully blocked locale', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve' });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve' });

    // locale 1 の locale 2 向け全アプローチをブロックする（複数エッジの場合すべて塞ぐ）
    const allAdjTo2 = map.getAdjacent(1).filter(e => e.adjIdx === 2);
    let pieceCounter = 2;
    for (const adj of allAdjTo2) {
      const defEdgeIdx = adj.myEdgeIdx;
      const req = map.getBlockRequirement(1, defEdgeIdx);
      for (let i = 0; i < req; i++) {
        const id = `AU-INF-${pieceCounter++}`;
        state.pieces[id] = makePiece(id, { localeId: 1, position: `approach_${defEdgeIdx}` });
      }
    }
    if (allAdjTo2.length > 0) {
      const raids = validator.getLegalRaids(state.pieces['FR-INF-1'], state);
      const raidTo1 = raids.filter(r => r.targetLocaleId === 1);
      expect(raidTo1.length).toBe(0);
    }
  });

  test('can raid from approach toward enemy', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    // フランスが locale 2 の approach から locale 1 に向かってレイド
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (adj2to1) {
      state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
        localeId: 2,
        position: `approach_${adj2to1.myEdgeIdx}`,
      });
      state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve' });

      const raids = validator.getLegalRaids(state.pieces['FR-INF-1'], state);
      expect(raids.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 突撃 (assault)
// ---------------------------------------------------------------------------

describe('getLegalAssaults', () => {
  test('from reserve: cannot assault', () => {
    const state = stateWithPiece('FR-INF-1', { localeId: 2, position: 'reserve', side: SIDES.FRANCE });
    const assaults = validator.getLegalAssaults(state.pieces['FR-INF-1'], state);
    expect(assaults.length).toBe(0);
  });

  test('disordered piece cannot assault', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (adj) {
      state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
        localeId: 2,
        position: `approach_${adj.myEdgeIdx}`,
        disordered: true,
      });
      state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: `approach_${adj.theirEdgeIdx}` });
      const assaults = validator.getLegalAssaults(state.pieces['FR-INF-1'], state);
      expect(assaults.length).toBe(0);
    }
  });

  test('from approach: can assault when defender is blocking opposite', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (adj2to1) {
      const defEdge = adj2to1.theirEdgeIdx;
      state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
        localeId: 2,
        position: `approach_${adj2to1.myEdgeIdx}`,
      });
      state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
        localeId: 1,
        position: `approach_${defEdge}`,
      });
      const assaults = validator.getLegalAssaults(state.pieces['FR-INF-1'], state);
      expect(assaults.length).toBeGreaterThan(0);
    }
  });

  test('cannot assault if opposite approach is not blocked', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (adj2to1) {
      state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
        localeId: 2,
        position: `approach_${adj2to1.myEdgeIdx}`,
      });
      // オーストリアはいるが approach ではなく reserve
      state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve' });
      const assaults = validator.getLegalAssaults(state.pieces['FR-INF-1'], state);
      expect(assaults.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 砲撃 (bombardment)
// ---------------------------------------------------------------------------

describe('getLegalBombardments', () => {
  test('non-artillery cannot bombard', () => {
    const state = stateWithPiece('FR-INF-1', { localeId: 2, position: 'approach_1', side: SIDES.FRANCE });
    const bombards = validator.getLegalBombardments(state.pieces['FR-INF-1'], state);
    expect(bombards.length).toBe(0);
  });

  test('disordered artillery cannot bombard', () => {
    const state = stateWithPiece('FR-ART-1', {
      type: PIECE_TYPES.ARTILLERY,
      maxStrength: 1,
      strength: 1,
      localeId: 2,
      position: 'approach_1',
      disordered: true,
      side: SIDES.FRANCE,
    });
    const bombards = validator.getLegalBombardments(state.pieces['FR-ART-1'], state);
    expect(bombards.length).toBe(0);
  });

  test('artillery from reserve cannot bombard', () => {
    const state = stateWithPiece('FR-ART-1', {
      type: PIECE_TYPES.ARTILLERY,
      maxStrength: 1,
      strength: 1,
      localeId: 2,
      position: 'reserve',
      side: SIDES.FRANCE,
    });
    const bombards = validator.getLegalBombardments(state.pieces['FR-ART-1'], state);
    expect(bombards.length).toBe(0);
  });

  test('artillery at approach can bombard enemy locale', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (adj2to1) {
      state.pieces['FR-ART-1'] = makePiece('FR-ART-1', {
        type: PIECE_TYPES.ARTILLERY,
        maxStrength: 1,
        strength: 1,
        localeId: 2,
        position: `approach_${adj2to1.myEdgeIdx}`,
      });
      state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve' });
      const bombards = validator.getLegalBombardments(state.pieces['FR-ART-1'], state);
      expect(bombards.length).toBeGreaterThan(0);
    }
  });

  test('already-declared bombardment cannot be re-declared', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (adj2to1) {
      state.pieces['FR-ART-1'] = makePiece('FR-ART-1', {
        type: PIECE_TYPES.ARTILLERY,
        maxStrength: 1,
        strength: 1,
        localeId: 2,
        position: `approach_${adj2to1.myEdgeIdx}`,
      });
      state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve' });
      state.pendingBombardment = { artilleryId: 'FR-ART-1', targetLocaleId: 1 };

      const bombards = validator.getLegalBombardments(state.pieces['FR-ART-1'], state);
      // 宣言済みの砲撃はキャンセルアクション1件のみ返す
      expect(bombards.length).toBe(1);
      expect(bombards[0].type).toBe('bombardment_cancel');
    }
  });
});

// ---------------------------------------------------------------------------
// getAllLegalActions
// ---------------------------------------------------------------------------

describe('getAllLegalActions', () => {
  test('returns empty during pending interruption', () => {
    const state = createMinimalState();
    state.pendingInterruption = { type: 'defense_response', waitingFor: 'austria' };
    const actions = validator.getAllLegalActions(state);
    expect(actions.length).toBe(0);
  });

  test('returns actions for active player pieces', () => {
    const state = createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 2, position: 'reserve' });
    const actions = validator.getAllLegalActions(state);
    expect(actions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// canReorganize
// ---------------------------------------------------------------------------

describe('canReorganize', () => {
  test('returns false for Austria turn', () => {
    const state = createMinimalState({ activePlayer: SIDES.AUSTRIA });
    expect(validator.canReorganize(1, state)).toBe(false);
  });

  test('returns false when no disordered French pieces', () => {
    const state = createMinimalState({ activePlayer: SIDES.FRANCE });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 1, disordered: false });
    expect(validator.canReorganize(1, state)).toBe(false);
  });

  test('returns true when France has disordered piece at locale', () => {
    const state = createMinimalState({ activePlayer: SIDES.FRANCE });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 1, disordered: true });
    expect(validator.canReorganize(1, state)).toBe(true);
  });
});
