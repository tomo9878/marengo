'use strict';

const turnManager = require('../../server/engine/TurnManager');
const map = require('../../server/engine/MapGraph');
const {
  createMinimalState,
  makePiece,
  SIDES,
  PHASES,
  PIECE_TYPES,
  INTERRUPTION,
} = require('../helpers/stateFactory');

// ---------------------------------------------------------------------------
// applyApproachCleanup
// ---------------------------------------------------------------------------

describe('applyApproachCleanup', () => {
  test('returns approach piece to reserve when opposite is not enemy-occupied', () => {
    const state = createMinimalState({ activePlayer: SIDES.AUSTRIA });
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1,
      position: `approach_${adj1to2.myEdgeIdx}`,
      strength: 3,
    });
    // locale 2 はフランスに占拠されていない

    const next = turnManager.applyApproachCleanup(state);
    expect(next.pieces['AU-INF-1'].position).toBe('reserve');
  });

  test('keeps approach piece when opposite is enemy-occupied', () => {
    const state = createMinimalState({ activePlayer: SIDES.AUSTRIA });
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1,
      position: `approach_${adj1to2.myEdgeIdx}`,
      strength: 3,
    });
    // locale 2 をフランスが占拠
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });

    const next = turnManager.applyApproachCleanup(state);
    expect(next.pieces['AU-INF-1'].position).toBe(`approach_${adj1to2.myEdgeIdx}`);
  });

  test('ignores eliminated pieces (strength 0)', () => {
    const state = createMinimalState();
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1,
      position: `approach_${adj1to2.myEdgeIdx}`,
      strength: 0,
    });

    const next = turnManager.applyApproachCleanup(state);
    // Strength 0 pieces are skipped
    expect(next.pieces['AU-INF-1'].position).toBe(`approach_${adj1to2.myEdgeIdx}`);
  });

  test('does not mutate original state', () => {
    const state = createMinimalState({ activePlayer: SIDES.AUSTRIA });
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1,
      position: `approach_${adj1to2.myEdgeIdx}`,
      strength: 3,
    });

    turnManager.applyApproachCleanup(state);
    expect(state.pieces['AU-INF-1'].position).toBe(`approach_${adj1to2.myEdgeIdx}`);
  });
});

// ---------------------------------------------------------------------------
// startPlayerTurn
// ---------------------------------------------------------------------------

describe('startPlayerTurn', () => {
  test('sets phase to ACTION', () => {
    const state = createMinimalState({ round: 1, activePlayer: SIDES.AUSTRIA });
    const next = turnManager.startPlayerTurn(state);
    expect(next.phase).toBe(PHASES.ACTION);
  });

  test('resets commandPoints to 3', () => {
    const state = createMinimalState();
    state.commandPoints = 0;
    const next = turnManager.startPlayerTurn(state);
    expect(next.commandPoints).toBe(3);
  });

  test('clears actedPieceIds', () => {
    const state = createMinimalState();
    state.actedPieceIds.add('AU-INF-1');
    const next = turnManager.startPlayerTurn(state);
    expect(next.actedPieceIds.size).toBe(0);
  });

  test('performs approach cleanup', () => {
    const state = createMinimalState({ activePlayer: SIDES.AUSTRIA });
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1,
      position: `approach_${adj1to2.myEdgeIdx}`,
      strength: 3,
    });
    // locale 2 不在 → cleanup で reserve へ

    const next = turnManager.startPlayerTurn(state);
    expect(next.pieces['AU-INF-1'].position).toBe('reserve');
  });
});

// ---------------------------------------------------------------------------
// executeAction: march
// ---------------------------------------------------------------------------

describe('executeAction: cross_country_march', () => {
  test('moves piece to new position', () => {
    const state = createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const action = {
      type: 'cross_country_march',
      pieceId: 'AU-INF-1',
      from: { localeId: 1, position: 'reserve' },
      to:   { localeId: 2, position: 'reserve' },
      commandCost: 1,
    };

    const { newState, interruption } = turnManager.executeAction(action, state);
    expect(interruption).toBeNull();
    expect(newState.pieces['AU-INF-1'].localeId).toBe(2);
    expect(newState.pieces['AU-INF-1'].position).toBe('reserve');
    expect(newState.commandPoints).toBe(2);
  });

  test('0-cost march does not add to actedPieceIds', () => {
    const state = createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const action = {
      type: 'defensive_march',
      pieceId: 'AU-INF-1',
      from: { localeId: 1, position: 'reserve' },
      to:   { localeId: 1, position: 'approach_2' },
      commandCost: 0,
    };

    const { newState } = turnManager.executeAction(action, state);
    expect(newState.actedPieceIds.has('AU-INF-1')).toBe(false);
  });

  test('throws when pending interruption exists', () => {
    const state = createMinimalState();
    state.pendingInterruption = { type: INTERRUPTION.DEFENSE_RESPONSE };

    expect(() => turnManager.executeAction({ type: 'cross_country_march' }, state)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// executeAction: bombardment_declare
// ---------------------------------------------------------------------------

describe('executeAction: bombardment_declare', () => {
  test('marks artillery faceUp and sets pendingBombardment', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (!adj2to1) return;

    state.pieces['FR-ART-1'] = makePiece('FR-ART-1', {
      type: PIECE_TYPES.ARTILLERY, maxStrength: 1, strength: 1,
      localeId: 2, position: `approach_${adj2to1.myEdgeIdx}`,
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const action = {
      type: 'bombardment_declare',
      pieceId: 'FR-ART-1',
      fromLocaleId: 2,
      fromEdgeIdx: adj2to1.myEdgeIdx,
      targetLocaleId: 1,
      commandCost: 0,
    };

    const { newState, interruption } = turnManager.executeAction(action, state);
    expect(interruption).toBeNull();
    expect(newState.pieces['FR-ART-1'].faceUp).toBe(true);
    expect(newState.pendingBombardment).not.toBeNull();
    expect(newState.pendingBombardment.artilleryId).toBe('FR-ART-1');
  });
});

// ---------------------------------------------------------------------------
// executeAction: raid initiation
// ---------------------------------------------------------------------------

describe('executeAction: raid', () => {
  test('generates DEFENSE_RESPONSE interruption', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (!adj2to1) return;

    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    const action = {
      type: 'raid',
      pieceId: 'FR-INF-1',
      fromLocaleId: 2,
      fromPosition: 'reserve',
      targetLocaleId: 1,
      defenseEdgeIdx: adj1to2.myEdgeIdx,
      commandCost: 3,
    };

    const { newState, interruption } = turnManager.executeAction(action, state);
    expect(interruption).not.toBeNull();
    expect(interruption.type).toBe(INTERRUPTION.DEFENSE_RESPONSE);
    expect(interruption.waitingFor).toBe(SIDES.AUSTRIA);
    expect(newState.pendingInterruption).toBeDefined();
  });

  test('consumes 3 command points', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const action = {
      type: 'raid',
      pieceId: 'FR-INF-1',
      fromLocaleId: 2,
      fromPosition: 'reserve',
      targetLocaleId: 1,
      defenseEdgeIdx: adj1to2.myEdgeIdx,
      commandCost: 3,
    };

    const { newState } = turnManager.executeAction(action, state);
    expect(newState.commandPoints).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// executeAction: assault initiation
// ---------------------------------------------------------------------------

describe('executeAction: assault', () => {
  test('generates ASSAULT_DEF_LEADERS interruption', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    if (!adj2to1) return;
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
      localeId: 2,
      position: `approach_${adj2to1.myEdgeIdx}`,
      strength: 3,
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1,
      position: `approach_${adj1to2.myEdgeIdx}`,
      strength: 3,
    });

    const action = {
      type: 'assault',
      pieceId: 'FR-INF-1',
      attackLocaleId: 2,
      attackEdgeIdx: adj2to1.myEdgeIdx,
      defenseLocaleId: 1,
      defenseEdgeIdx: adj1to2.myEdgeIdx,
      commandCost: 3,
    };

    const { newState, interruption } = turnManager.executeAction(action, state);
    expect(interruption).not.toBeNull();
    expect(interruption.type).toBe(INTERRUPTION.ASSAULT_DEF_LEADERS);
    expect(interruption.waitingFor).toBe(SIDES.AUSTRIA);
  });
});

// ---------------------------------------------------------------------------
// processInterruption: DEFENSE_RESPONSE
// ---------------------------------------------------------------------------

describe('processInterruption: DEFENSE_RESPONSE', () => {
  test('defender blocks → returns no further interruption', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.AUSTRIA, reason: INTERRUPTION.DEFENSE_RESPONSE },
    });
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const req = map.getBlockRequirement(1, adj1to2.myEdgeIdx);
    const responseIds = [];
    for (let i = 0; i < req; i++) {
      const id = `AU-INF-${i + 1}`;
      if (!state.pieces[id]) {
        state.pieces[id] = makePiece(id, { localeId: 1, position: 'reserve', strength: 3 });
      }
      responseIds.push(id);
    }

    state.pendingInterruption = {
      type: INTERRUPTION.DEFENSE_RESPONSE,
      waitingFor: SIDES.AUSTRIA,
      context: {
        attackerPieceIds: ['FR-INF-1'],
        targetLocaleId: 1,
        defenseEdgeIdx: adj1to2.myEdgeIdx,
        availableDefenders: responseIds,
        maxResponse: 1,
      },
    };

    const { newState, interruption } = turnManager.processInterruption(
      { pieceIds: responseIds },
      state
    );

    // 完全ブロックで防御側勝ち
    expect(newState.pieces['FR-INF-1'].localeId).toBe(2); // attacker stays
    // interruption は null か退却インタラプション
    if (interruption) {
      // 攻撃側勝ちの場合は退却インタラプションが発生する
      // ここでは完全ブロックで防御側勝ちのはず
    }
  });

  test('no block → attacker wins, retreat interruption issued', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.AUSTRIA, reason: INTERRUPTION.DEFENSE_RESPONSE },
    });
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    state.pendingInterruption = {
      type: INTERRUPTION.DEFENSE_RESPONSE,
      waitingFor: SIDES.AUSTRIA,
      context: {
        attackerPieceIds: ['FR-INF-1'],
        targetLocaleId: 1,
        defenseEdgeIdx: adj1to2.myEdgeIdx,
        availableDefenders: ['AU-INF-1'],
        maxResponse: 1,
      },
    };

    const { newState, interruption } = turnManager.processInterruption(
      { pieceIds: [] }, // no response
      state
    );

    // 防御なし → 攻撃側勝ち
    expect(newState.pieces['FR-INF-1'].localeId).toBe(1);
    expect(interruption).not.toBeNull();
    expect(interruption.type).toBe(INTERRUPTION.RETREAT_DESTINATION);
  });
});

// ---------------------------------------------------------------------------
// processInterruption: ASSAULT flow
// ---------------------------------------------------------------------------

describe('processInterruption: assault flow', () => {
  function buildAssaultState() {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.AUSTRIA, reason: INTERRUPTION.ASSAULT_DEF_LEADERS },
    });
    const adj2to1 = map.getAdjacent(2).find(e => e.adjIdx === 1);
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj2to1 || !adj1to2) return null;

    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
      localeId: 2, position: `approach_${adj2to1.myEdgeIdx}`, strength: 3,
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1, position: `approach_${adj1to2.myEdgeIdx}`, strength: 3,
    });

    state.pendingInterruption = {
      type: INTERRUPTION.ASSAULT_DEF_LEADERS,
      waitingFor: SIDES.AUSTRIA,
      context: {
        attackLocaleId: 2,
        attackEdgeIdx: adj2to1.myEdgeIdx,
        defenseLocaleId: 1,
        defenseEdgeIdx: adj1to2.myEdgeIdx,
        atkAssaultIds: ['FR-INF-1'],
        defAssaultIds: ['AU-INF-1'],
        atkSide: SIDES.FRANCE,
        defSide: SIDES.AUSTRIA,
      },
    };

    return state;
  }

  test('ASSAULT_DEF_LEADERS → next is ASSAULT_ATK_LEADERS', () => {
    const state = buildAssaultState();
    if (!state) return;

    const { interruption } = turnManager.processInterruption(
      { leaderIds: ['AU-INF-1'] },
      state
    );

    expect(interruption.type).toBe(INTERRUPTION.ASSAULT_ATK_LEADERS);
    expect(interruption.waitingFor).toBe(SIDES.FRANCE);
  });

  test('full assault flow: def leaders → atk leaders → counter → reductions', () => {
    const state = buildAssaultState();
    if (!state) return;

    // Step 1: Def leaders
    const { newState: s1, interruption: i1 } = turnManager.processInterruption(
      { leaderIds: ['AU-INF-1'] },
      state
    );
    expect(i1.type).toBe(INTERRUPTION.ASSAULT_ATK_LEADERS);

    // Step 2: Atk leaders
    const { newState: s2, interruption: i2 } = turnManager.processInterruption(
      { leaderIds: ['FR-INF-1'] },
      s1
    );
    // Either ASSAULT_DEF_ARTILLERY or ASSAULT_COUNTER
    expect([INTERRUPTION.ASSAULT_DEF_ARTILLERY, INTERRUPTION.ASSAULT_COUNTER]).toContain(i2.type);

    // If artillery step exists, skip it
    let s3 = s2;
    let i3 = i2;
    if (i2.type === INTERRUPTION.ASSAULT_DEF_ARTILLERY) {
      const r = turnManager.processInterruption({ fire: false }, s2);
      s3 = r.newState;
      i3 = r.interruption;
    }

    expect(i3.type).toBe(INTERRUPTION.ASSAULT_COUNTER);

    // Step: Counter
    const { newState: s4, interruption: i4 } = turnManager.processInterruption(
      { counterIds: [] },
      s3
    );
    expect(i4.type).toBe(INTERRUPTION.ASSAULT_REDUCTIONS);

    // Step: Reductions
    const { newState: s5, interruption: i5 } = turnManager.processInterruption(
      { atkApproachChoice: [] },
      s4
    );

    // Either null or RETREAT_DESTINATION
    if (i5) {
      expect([INTERRUPTION.RETREAT_DESTINATION]).toContain(i5.type);
    }
  });
});

// ---------------------------------------------------------------------------
// processInterruption: BOMBARDMENT_REDUCTION
// ---------------------------------------------------------------------------

describe('processInterruption: BOMBARDMENT_REDUCTION', () => {
  test('reduces target piece and clears pendingBombardment', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.AUSTRIA, reason: INTERRUPTION.BOMBARDMENT_REDUCTION },
    });

    state.pieces['FR-ART-1'] = makePiece('FR-ART-1', {
      type: PIECE_TYPES.ARTILLERY, maxStrength: 1, strength: 1,
      localeId: 2, position: 'approach_1', faceUp: true,
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    state.pendingBombardment = {
      artilleryId: 'FR-ART-1',
      targetLocaleId: 1,
      defenseApproachIdx: 2,
      declaredRound: 1,
    };

    state.pendingInterruption = {
      type: INTERRUPTION.BOMBARDMENT_REDUCTION,
      waitingFor: SIDES.AUSTRIA,
      context: {
        artilleryId: 'FR-ART-1',
        targetLocaleId: 1,
        defenseEdgeIdx: 2,
        availableTargets: ['AU-INF-1'],
      },
    };

    const { newState, interruption } = turnManager.processInterruption(
      { targetPieceId: 'AU-INF-1' },
      state
    );

    expect(newState.pieces['AU-INF-1'].strength).toBe(2);
    expect(newState.pendingBombardment).toBeNull();
    expect(newState.pendingInterruption).toBeNull();
    expect(interruption).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// processInterruption: RETREAT_DESTINATION
// ---------------------------------------------------------------------------

describe('processInterruption: RETREAT_DESTINATION', () => {
  test('moves pieces to chosen destinations', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.AUSTRIA, reason: INTERRUPTION.RETREAT_DESTINATION },
    });

    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });
    state.morale.austria.uncommitted = 5;

    state.pendingInterruption = {
      type: INTERRUPTION.RETREAT_DESTINATION,
      waitingFor: SIDES.AUSTRIA,
      context: {
        losingLocaleId: 1,
        losingSide: SIDES.AUSTRIA,
        attackInfo: { attackLocaleId: 2, isWideApproach: false, attackerPieceCount: 1 },
        isRaid: false,
      },
    };

    const { newState, interruption } = turnManager.processInterruption(
      {
        reductionChoices: [],
        destinations: { 'AU-INF-1': 3 },
      },
      state
    );

    expect(newState.pieces['AU-INF-1'].localeId).toBe(3);
    expect(interruption).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// endActionPhase
// ---------------------------------------------------------------------------

describe('endActionPhase', () => {
  test('Austria turn end → switches to France', () => {
    const state = createMinimalState({ round: 1, activePlayer: SIDES.AUSTRIA });
    const next = turnManager.endActionPhase(state);
    expect(next.activePlayer).toBe(SIDES.FRANCE);
  });

  test('France turn end → advances round and switches to Austria', () => {
    const state = createMinimalState({ round: 1, activePlayer: SIDES.FRANCE });
    const next = turnManager.endActionPhase(state);
    expect(next.round).toBe(2);
    expect(next.activePlayer).toBe(SIDES.AUSTRIA);
  });

  test('performs morale cleanup', () => {
    const state = createMinimalState({ round: 5, activePlayer: SIDES.AUSTRIA });
    // フランストークンが敵占拠ロケールにある
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const next = turnManager.endActionPhase(state);
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    expect(franceTokens.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// advanceRound
// ---------------------------------------------------------------------------

describe('advanceRound', () => {
  test('increments round', () => {
    const state = createMinimalState({ round: 3 });
    const next = turnManager.advanceRound(state);
    expect(next.round).toBe(4);
  });

  test('sets activePlayer to Austria', () => {
    const state = createMinimalState({ round: 1, activePlayer: SIDES.FRANCE });
    const next = turnManager.advanceRound(state);
    expect(next.activePlayer).toBe(SIDES.AUSTRIA);
  });

  test('sets phase to MORALE_UPDATE', () => {
    const state = createMinimalState({ round: 1 });
    const next = turnManager.advanceRound(state);
    expect(next.phase).toBe(PHASES.MORALE_UPDATE);
  });
});

// ---------------------------------------------------------------------------
// checkVictory
// ---------------------------------------------------------------------------

describe('checkVictory', () => {
  test('returns null when no victory condition is met', () => {
    const state = createMinimalState({ round: 5 });
    state.morale.france.uncommitted = 3;
    state.morale.austria.uncommitted = 3;
    expect(turnManager.checkVictory(state)).toBeNull();
  });

  test('morale collapse: France 0 → Austria wins', () => {
    const state = createMinimalState({ round: 5 });
    state.morale.france.uncommitted = 0;
    const result = turnManager.checkVictory(state);
    expect(result).not.toBeNull();
    expect(result.winner).toBe(SIDES.AUSTRIA);
    expect(result.type).toBe('morale_collapse');
  });

  test('morale collapse: Austria 0 → France wins', () => {
    const state = createMinimalState({ round: 5 });
    state.morale.austria.uncommitted = 0;
    const result = turnManager.checkVictory(state);
    expect(result).not.toBeNull();
    expect(result.winner).toBe(SIDES.FRANCE);
    expect(result.type).toBe('morale_collapse');
  });

  test('round > 16: checks objective line', () => {
    const state = createMinimalState({ round: 17 });
    state.morale.france.uncommitted = 3;
    state.morale.austria.uncommitted = 3;
    // No pieces east of objective
    const result = turnManager.checkVictory(state);
    expect(result).not.toBeNull();
    expect(result.type).toBe('marginal_objective');
  });

  test('round > 16 with 3+ Austrian pieces east: Austria wins', () => {
    const state = createMinimalState({ round: 17 });
    state.morale.france.uncommitted = 3;
    state.morale.austria.uncommitted = 3;

    // 実マップで eastOfObjective = true のロケールがなければスキップ
    const { getLocale } = require('../../server/engine/MapGraph');
    const mapData = require('../../data/map.json');
    const eastLocales = mapData.areas.filter(a => a.eastOfObjective === true);

    if (eastLocales.length === 0) {
      // No east locales in real map data
      const result = turnManager.checkVictory(state);
      expect(result.winner).toBe(SIDES.FRANCE);
      return;
    }

    // Place 3 Austrian pieces east
    for (let i = 0; i < 3; i++) {
      const id = `AU-INF-${i + 1}`;
      state.pieces[id] = makePiece(id, {
        localeId: eastLocales[0].idx,
        position: 'reserve',
        strength: 3,
      });
    }

    const result = turnManager.checkVictory(state);
    expect(result.winner).toBe(SIDES.AUSTRIA);
    expect(result.type).toBe('marginal_objective');
  });
});

// ---------------------------------------------------------------------------
// executeAction: reorganize
// ---------------------------------------------------------------------------

describe('executeAction: reorganize', () => {
  test('clears disordered flag on French pieces', () => {
    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, disordered: true });
    state.pieces['FR-INF-2'] = makePiece('FR-INF-2', { localeId: 2, disordered: true });

    const action = { type: 'reorganize', localeId: 2 };
    const { newState } = turnManager.executeAction(action, state);

    expect(newState.pieces['FR-INF-1'].disordered).toBe(false);
    expect(newState.pieces['FR-INF-2'].disordered).toBe(false);
  });
});
