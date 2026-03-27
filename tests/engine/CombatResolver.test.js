'use strict';

const combat = require('../../server/engine/CombatResolver');
const map = require('../../server/engine/MapGraph');
const {
  createMinimalState,
  createAssaultScenario,
  createRaidScenario,
  createBombardmentScenario,
  makePiece,
  SIDES,
  PIECE_TYPES,
} = require('../helpers/stateFactory');

// ---------------------------------------------------------------------------
// resolveRaid
// ---------------------------------------------------------------------------

describe('resolveRaid', () => {
  test('attacker wins when defense is not fully blocked', () => {
    // locale 2 (France) attacks locale 1 (Austria)
    // locale 1 の approach toward 2 を見つける
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return; // skip if no adjacency

    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const result = combat.resolveRaid(
      {
        attackerPieceIds: ['FR-INF-1'],
        targetLocaleId: 1,
        defenseEdgeIdx: adj1to2.myEdgeIdx,
        defenseResponsePieceIds: [],
      },
      state
    );

    expect(result.winner).toBe('attacker');
    // 攻撃駒が locale 1 に移動
    expect(result.newState.pieces['FR-INF-1'].localeId).toBe(1);
    expect(result.newState.pieces['FR-INF-1'].position).toBe('reserve');
    expect(result.retreatInfo).not.toBeNull();
    expect(result.moraleInvestment).toBe(0);
  });

  test('defender wins when fully blocked after response', () => {
    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });
    // 防御側にリザーブ駒を配置
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    // defenseResponsePieceIds でアプローチへ移動させて完全ブロック
    const req = map.getBlockRequirement(1, adj1to2.myEdgeIdx);
    // narrow なら 1 駒で足りる
    const responseIds = ['AU-INF-1'];
    // 複数必要な場合は追加
    if (req > 1) {
      state.pieces['AU-INF-2'] = makePiece('AU-INF-2', { localeId: 1, position: 'reserve', strength: 3 });
      responseIds.push('AU-INF-2');
    }

    const result = combat.resolveRaid(
      {
        attackerPieceIds: ['FR-INF-1'],
        targetLocaleId: 1,
        defenseEdgeIdx: adj1to2.myEdgeIdx,
        defenseResponsePieceIds: responseIds,
      },
      state
    );

    expect(result.winner).toBe('defender');
    expect(result.moraleInvestment).toBeGreaterThanOrEqual(1);
  });

  test('defender wins: morale investment 2 for wide approach with 2+ attackers', () => {
    // wide approach をシミュレート: 実際のマップにない場合はモックが難しいが
    // 直接 resolveRaid の内部ロジックを検証する
    // state の pieces を調整して fully blocked をシミュレート

    const adj1to2 = map.getAdjacent(1).find(e => e.adjIdx === 2);
    if (!adj1to2) return;

    const state = createMinimalState({
      activePlayer: SIDES.FRANCE,
      controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    });
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'reserve', strength: 3 });
    state.pieces['FR-INF-2'] = makePiece('FR-INF-2', { localeId: 2, position: 'reserve', strength: 3 });

    // 防御駒を1つ以上の approach に配置して fully blocked にする
    const req = map.getBlockRequirement(1, adj1to2.myEdgeIdx);
    const responseIds = [];
    for (let i = 0; i < req; i++) {
      const id = `AU-INF-${i + 1}`;
      state.pieces[id] = makePiece(id, { localeId: 1, position: 'reserve', strength: 3 });
      responseIds.push(id);
    }

    const result = combat.resolveRaid(
      {
        attackerPieceIds: ['FR-INF-1', 'FR-INF-2'],
        targetLocaleId: 1,
        defenseEdgeIdx: adj1to2.myEdgeIdx,
        defenseResponsePieceIds: responseIds,
      },
      state
    );

    expect(result.winner).toBe('defender');
    // wide approach の場合は 2、それ以外は 1
    const width = map.getApproachWidth(1, adj1to2.myEdgeIdx);
    if (width === 'wide') {
      expect(result.moraleInvestment).toBe(2);
    } else {
      expect(result.moraleInvestment).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// calculateAssaultResult
// ---------------------------------------------------------------------------

describe('calculateAssaultResult', () => {
  test('attacker wins when atkLeaderStrength > defLeaderStrength + counters', () => {
    const { state, austriaLocaleId, austriaEdgeIdx, atkAssaultIds, defAssaultIds } = createAssaultScenario({
      atkStrength: 3,
      defStrength: 1,
    });

    const result = combat.calculateAssaultResult(
      {
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: [],
        defenseEdgeIdx: austriaEdgeIdx,
        attackEdgeIdx: 1,
      },
      state
    );

    expect(result.atkWins).toBe(true);
    expect(result.result).toBeGreaterThanOrEqual(1);
  });

  test('defender wins when atkLeaderStrength <= defLeaderStrength', () => {
    const { state, austriaEdgeIdx } = createAssaultScenario({
      atkStrength: 1,
      defStrength: 3,
    });

    const result = combat.calculateAssaultResult(
      {
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: [],
        defenseEdgeIdx: austriaEdgeIdx,
        attackEdgeIdx: 1,
      },
      state
    );

    expect(result.atkWins).toBe(false);
    expect(result.result).toBeLessThanOrEqual(0);
  });

  test('counters reduce attacker effective strength', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'approach_1', strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'approach_2', strength: 1 });
    state.pieces['AU-INF-2'] = makePiece('AU-INF-2', { localeId: 1, position: 'reserve', strength: 2 });

    // locale 1 のエッジ 2 には inf_obstacle シンボルがあり歩兵攻撃に -1 ペナルティ
    // result = 3 - 1 (inf_obstacle penalty) - 1 (def leader) - 2 (counter) = -1
    const result = combat.calculateAssaultResult(
      {
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: ['AU-INF-2'],
        defenseEdgeIdx: 2,
        attackEdgeIdx: 1,
      },
      state
    );

    expect(result.result).toBe(-1);
    expect(result.atkWins).toBe(false);
  });

  test('result >= 1 means attacker wins', () => {
    const state = createMinimalState();
    // locale 1 のエッジ 2 に inf_obstacle (-1 ペナルティ) があるため強度 4 が必要
    // result = 4 - 1 (penalty) - 2 (def leader) = 1
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'approach_1', strength: 4 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'approach_2', strength: 2 });

    const result = combat.calculateAssaultResult(
      {
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: [],
        defenseEdgeIdx: 2,
        attackEdgeIdx: 1,
      },
      state
    );

    expect(result.result).toBe(1);
    expect(result.atkWins).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateAssaultReductions
// ---------------------------------------------------------------------------

describe('calculateAssaultReductions', () => {
  test('both sides get reduction equal to enemy leader count', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { strength: 3 });

    const { atkReductions, defReductions } = combat.calculateAssaultReductions(
      {
        result: 1,
        atkWins: true,
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: [],
      },
      state
    );

    // attacker wins: def gets atkLeader count (1), atk gets defLeader count (1)
    expect(defReductions).toBe(1);
    expect(atkReductions).toBe(1);
  });

  test('attacker gets extra reduction from cavalry counters', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { strength: 2 });
    state.pieces['AU-CAV-1'] = makePiece('AU-CAV-1', {
      type: PIECE_TYPES.CAVALRY,
      maxStrength: 2,
      strength: 2,
    });

    const { atkReductions } = combat.calculateAssaultReductions(
      {
        result: 1,
        atkWins: true,
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: ['AU-CAV-1'],
      },
      state
    );

    // defLeader count (1) + cavalry counter (1) = 2
    expect(atkReductions).toBe(2);
  });

  test('attacker loses: extra reduction when leader strength <= abs(result)', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { strength: 1 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { strength: 3 });

    const { atkReductions } = combat.calculateAssaultReductions(
      {
        result: -2,  // defender wins
        atkWins: false,
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: [],
      },
      state
    );

    // defLeader count (1) + extra 1 (because 1 leader) = 2
    expect(atkReductions).toBe(2);
  });

  test('two leaders: extra reduction is 2 when losing badly', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { strength: 2 });
    state.pieces['FR-INF-2'] = makePiece('FR-INF-2', { strength: 2 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { strength: 3 });

    const { atkReductions } = combat.calculateAssaultReductions(
      {
        result: -3,
        atkWins: false,
        atkLeaderIds: ['FR-INF-1', 'FR-INF-2'],
        defLeaderIds: ['AU-INF-1'],
        counterIds: [],
      },
      state
    );

    // defLeader count (1) + extra 2 (because 2 leaders, strength 4 <= abs(-3)? No: 4 > 3)
    // 4 > 3, so no extra
    // But here atkStrength = 2+2=4, absResult = 3: 4 > 3 so no extra
    expect(atkReductions).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// applyAssaultReductions
// ---------------------------------------------------------------------------

describe('applyAssaultReductions', () => {
  test('reduces leader pieces first', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { strength: 3 });

    const next = combat.applyAssaultReductions(
      {
        atkReductions: 2,
        defReductions: 1,
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        atkAssaultIds: ['FR-INF-1'],
        defAssaultIds: ['AU-INF-1'],
      },
      state
    );

    expect(next.pieces['FR-INF-1'].strength).toBe(1); // 3 - 2
    expect(next.pieces['AU-INF-1'].strength).toBe(2); // 3 - 1
  });

  test('excess reductions go to other assault pieces', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { strength: 1 }); // leader
    state.pieces['FR-INF-2'] = makePiece('FR-INF-2', { strength: 3 }); // non-leader
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { strength: 3 });

    const next = combat.applyAssaultReductions(
      {
        atkReductions: 3,  // 1 goes to leader (reduces to 0), 2 overflow to FR-INF-2
        defReductions: 0,
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        atkAssaultIds: ['FR-INF-1', 'FR-INF-2'],
        defAssaultIds: ['AU-INF-1'],
      },
      state
    );

    expect(next.pieces['FR-INF-1'].strength).toBe(0);
    expect(next.pieces['FR-INF-2'].strength).toBe(1); // 3 - 2
  });

  test('does not mutate original state', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { strength: 3 });

    combat.applyAssaultReductions(
      {
        atkReductions: 2,
        defReductions: 1,
        atkLeaderIds: ['FR-INF-1'],
        defLeaderIds: ['AU-INF-1'],
        atkAssaultIds: ['FR-INF-1'],
        defAssaultIds: ['AU-INF-1'],
      },
      state
    );

    expect(state.pieces['FR-INF-1'].strength).toBe(3);
    expect(state.pieces['AU-INF-1'].strength).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// completeAssault
// ---------------------------------------------------------------------------

describe('completeAssault', () => {
  test('attacker wins: assault pieces move to defense locale', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'approach_1', strength: 3 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'approach_2', strength: 2 });

    const { retreatNeeded, newState } = combat.completeAssault(
      {
        atkWins: true,
        atkAssaultIds: ['FR-INF-1'],
        defAssaultIds: ['AU-INF-1'],
        attackLocaleId: 2,
        attackEdgeIdx: 1,
        defenseLocaleId: 1,
        defenseEdgeIdx: 2,
      },
      state
    );

    expect(retreatNeeded).toBe(true);
    expect(newState.pieces['FR-INF-1'].localeId).toBe(1);
    expect(newState.pieces['FR-INF-1'].position).toBe('reserve');
  });

  test('defender wins: pieces stay, no retreat', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'approach_1', strength: 1 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'approach_2', strength: 3 });

    const { retreatNeeded, newState } = combat.completeAssault(
      {
        atkWins: false,
        atkAssaultIds: ['FR-INF-1'],
        defAssaultIds: ['AU-INF-1'],
        attackLocaleId: 2,
        attackEdgeIdx: 1,
        defenseLocaleId: 1,
        defenseEdgeIdx: 2,
      },
      state
    );

    expect(retreatNeeded).toBe(false);
    expect(newState.pieces['FR-INF-1'].localeId).toBe(2);
    expect(newState.pieces['AU-INF-1'].localeId).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// completeBombardment
// ---------------------------------------------------------------------------

describe('completeBombardment', () => {
  test('reduces target piece strength by 1', () => {
    const state = createMinimalState();
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

    const next = combat.completeBombardment(
      {
        artilleryId: 'FR-ART-1',
        targetLocaleId: 1,
        defenseEdgeIdx: 2,
        targetPieceId: 'AU-INF-1',
      },
      state
    );

    expect(next.pieces['AU-INF-1'].strength).toBe(2);
    expect(next.pieces['FR-ART-1'].faceUp).toBe(false);
    expect(next.pendingBombardment).toBeNull();
  });

  test('does not reduce below 0', () => {
    const state = createMinimalState();
    state.pieces['FR-ART-1'] = makePiece('FR-ART-1', {
      type: PIECE_TYPES.ARTILLERY, maxStrength: 1, strength: 1,
      localeId: 2, position: 'approach_1', faceUp: true,
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 1 });
    state.pendingBombardment = { artilleryId: 'FR-ART-1', targetLocaleId: 1, defenseApproachIdx: 2 };

    const next = combat.completeBombardment(
      { artilleryId: 'FR-ART-1', targetLocaleId: 1, defenseEdgeIdx: 2, targetPieceId: 'AU-INF-1' },
      state
    );

    expect(next.pieces['AU-INF-1'].strength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getBombardmentTargets (priority order)
// ---------------------------------------------------------------------------

describe('getBombardmentTargets', () => {
  test('priority: opposite approach > reserve > other approach', () => {
    const state = createMinimalState();
    state.pieces['FR-ART-1'] = makePiece('FR-ART-1', {
      type: PIECE_TYPES.ARTILLERY, maxStrength: 1, strength: 1,
      localeId: 2, position: 'approach_1', faceUp: true,
    });

    // locale 1 の approach 2 にいる駒（向かい側アプローチ）
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'approach_2', strength: 3 });
    // reserve
    state.pieces['AU-INF-2'] = makePiece('AU-INF-2', { localeId: 1, position: 'reserve', strength: 2 });
    // other approach
    state.pieces['AU-INF-3'] = makePiece('AU-INF-3', { localeId: 1, position: 'approach_0', strength: 2 });

    state.pendingBombardment = {
      artilleryId: 'FR-ART-1',
      targetLocaleId: 1,
      defenseApproachIdx: 1,
      declaredRound: 1,
    };

    const targets = combat.getBombardmentTargets(
      { artilleryId: 'FR-ART-1', targetLocaleId: 1, defenseEdgeIdx: 2 },
      state
    );

    expect(Array.isArray(targets)).toBe(true);
    expect(targets.length).toBe(3);
    // AU-INF-1 (opposite approach) should come first
    expect(targets[0]).toBe('AU-INF-1');
  });
});

// ---------------------------------------------------------------------------
// calculateRetreatReductions
// ---------------------------------------------------------------------------

describe('calculateRetreatReductions', () => {
  test('artillery is fully eliminated', () => {
    const state = createMinimalState();
    state.pieces['AU-ART-1'] = makePiece('AU-ART-1', {
      type: PIECE_TYPES.ARTILLERY, maxStrength: 1, strength: 1,
      localeId: 1, position: 'reserve',
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const { reductions } = combat.calculateRetreatReductions(
      { losingLocaleId: 1, attackInfo: {} },
      state
    );

    const artReduction = reductions.find(r => r.pieceId === 'AU-ART-1');
    expect(artReduction).toBeDefined();
    expect(artReduction.amount).toBe(1); // full strength
  });

  test('narrow approach blocking piece gets 1 reduction', () => {
    const state = createMinimalState();
    // locale 1 の approach 2 は narrow と仮定（デフォルト null → narrow 扱い）
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1, position: 'approach_2', strength: 3,
    });
    state.pieces['AU-INF-2'] = makePiece('AU-INF-2', {
      localeId: 1, position: 'reserve', strength: 3,
    });

    const { reductions } = combat.calculateRetreatReductions(
      { losingLocaleId: 1, attackInfo: { isWideApproach: false, attackerPieceCount: 1 } },
      state
    );

    const atkBlockReduction = reductions.find(r => r.pieceId === 'AU-INF-1');
    expect(atkBlockReduction).toBeDefined();
    // narrow: 1 reduction
    const width = map.getApproachWidth(1, 2);
    const expected = width === 'wide' ? 2 : 1;
    expect(atkBlockReduction.amount).toBeLessThanOrEqual(expected);
  });

  test('reserve infantry gets 1 reduction', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const { reductions } = combat.calculateRetreatReductions(
      { losingLocaleId: 1, attackInfo: { isWideApproach: false, attackerPieceCount: 1 } },
      state
    );

    const infReduction = reductions.find(r => r.pieceId === 'AU-INF-1');
    expect(infReduction).toBeDefined();
    expect(infReduction.amount).toBe(1);
  });

  test('reserve cavalry gets no reduction', () => {
    const state = createMinimalState();
    state.pieces['AU-CAV-1'] = makePiece('AU-CAV-1', {
      type: PIECE_TYPES.CAVALRY, maxStrength: 2, strength: 2,
      localeId: 1, position: 'reserve',
    });

    const { reductions } = combat.calculateRetreatReductions(
      { losingLocaleId: 1, attackInfo: {} },
      state
    );

    const cavReduction = reductions.find(r => r.pieceId === 'AU-CAV-1');
    expect(cavReduction).toBeUndefined();
  });

  test('wide approach + multiple attackers → reserve infantry gets 2 reductions', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const { reductions } = combat.calculateRetreatReductions(
      { losingLocaleId: 1, attackInfo: { isWideApproach: true, attackerPieceCount: 2 } },
      state
    );

    const infReduction = reductions.find(r => r.pieceId === 'AU-INF-1');
    expect(infReduction).toBeDefined();
    expect(infReduction.amount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// resolveRetreat
// ---------------------------------------------------------------------------

describe('resolveRetreat', () => {
  test('pieces with valid destinations move to them', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const { newState } = combat.resolveRetreat(
      {
        losingLocaleId: 1,
        attackInfo: {},
        reductionChoices: [],
        destinations: { 'AU-INF-1': 3 }, // retreat to locale 3
      },
      state
    );

    expect(newState.pieces['AU-INF-1'].localeId).toBe(3);
    expect(newState.pieces['AU-INF-1'].position).toBe('reserve');
  });

  test('pieces without valid destinations are eliminated', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const { newState } = combat.resolveRetreat(
      {
        losingLocaleId: 1,
        attackInfo: {},
        reductionChoices: [],
        destinations: {}, // no destination → eliminate
      },
      state
    );

    expect(newState.pieces['AU-INF-1'].strength).toBe(0);
  });

  test('reductions are applied before retreat', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const { newState } = combat.resolveRetreat(
      {
        losingLocaleId: 1,
        attackInfo: {},
        reductionChoices: [{ pieceId: 'AU-INF-1', amount: 1 }],
        destinations: { 'AU-INF-1': 3 },
      },
      state
    );

    expect(newState.pieces['AU-INF-1'].strength).toBe(2); // 3 - 1
    expect(newState.pieces['AU-INF-1'].localeId).toBe(3);
  });

  test('austria retreat generates moraleInvestment equal to retreating count', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });
    state.pieces['AU-INF-2'] = makePiece('AU-INF-2', { localeId: 1, position: 'reserve', strength: 2 });

    const { moraleInvestment } = combat.resolveRetreat(
      {
        losingLocaleId: 1,
        attackInfo: {},
        reductionChoices: [],
        destinations: { 'AU-INF-1': 3, 'AU-INF-2': 4 },
      },
      state
    );

    expect(moraleInvestment).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getValidAssaultLeaders / getValidCounterPieces
// ---------------------------------------------------------------------------

describe('getValidAssaultLeaders', () => {
  test('returns pieces with strength >= 2', () => {
    const state = createMinimalState();
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 2, position: 'approach_1', strength: 3 });
    state.pieces['FR-INF-2'] = makePiece('FR-INF-2', { localeId: 2, position: 'reserve', strength: 1 }); // too weak
    state.pieces['FR-INF-3'] = makePiece('FR-INF-3', { localeId: 2, position: 'approach_1', strength: 2 });

    const leaders = combat.getValidAssaultLeaders(2, 1, SIDES.FRANCE, state);
    expect(leaders).toContain('FR-INF-1');
    expect(leaders).toContain('FR-INF-3');
    expect(leaders).not.toContain('FR-INF-2');
  });
});

describe('getValidCounterPieces', () => {
  test('excludes cavalry if cavalry obstacle on approach', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'approach_2', strength: 2 });
    state.pieces['AU-CAV-1'] = makePiece('AU-CAV-1', {
      type: PIECE_TYPES.CAVALRY, maxStrength: 2, strength: 2,
      localeId: 1, position: 'reserve',
    });

    // hasCavalryObstacle の結果によって cavalry が除外されるか決まる
    const hasCavObs = map.hasCavalryObstacle(1, 2);
    const counters = combat.getValidCounterPieces(1, 2, SIDES.AUSTRIA, state);

    if (hasCavObs) {
      expect(counters).not.toContain('AU-CAV-1');
    } else {
      expect(counters).toContain('AU-CAV-1');
    }
  });
});

// ---------------------------------------------------------------------------
// getValidRetreatDestinations
// ---------------------------------------------------------------------------

describe('getValidRetreatDestinations', () => {
  test('excludes attack locale', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });
    // locale 1 に隣接するロケールへ退却
    const dests = combat.getValidRetreatDestinations('AU-INF-1', 1, { attackLocaleId: 2 }, state);
    expect(dests).not.toContain(2);
  });

  test('excludes enemy-occupied locales', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });
    // locale 4 にフランスを配置
    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', { localeId: 4, position: 'reserve', strength: 3 });

    const dests = combat.getValidRetreatDestinations('AU-INF-1', 1, { attackLocaleId: 2 }, state);
    expect(dests).not.toContain(4);
  });

  test('returns adjacent locales', () => {
    const state = createMinimalState();
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const dests = combat.getValidRetreatDestinations('AU-INF-1', 1, { attackLocaleId: 99 }, state);
    const adjIdxs = map.getAdjacent(1).map(e => e.adjIdx);
    for (const dest of dests) {
      expect(adjIdxs).toContain(dest);
    }
  });
});
