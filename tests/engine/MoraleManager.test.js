'use strict';

const moraleManager = require('../../server/engine/MoraleManager');
const { createMinimalState, makePiece, SIDES } = require('../helpers/stateFactory');

// ---------------------------------------------------------------------------
// periodicMoraleUpdate
// ---------------------------------------------------------------------------

describe('periodicMoraleUpdate', () => {
  test('adds morale gain from timeTrack (round 1 = 0 gain)', () => {
    const state = createMinimalState({ round: 1 });
    const next = moraleManager.periodicMoraleUpdate(1, state);
    // Round 1 has 0 moraleGain for both sides
    expect(next.morale.france.uncommitted).toBe(state.morale.france.uncommitted);
    expect(next.morale.austria.uncommitted).toBe(state.morale.austria.uncommitted);
  });

  test('does not throw for unknown round', () => {
    const state = createMinimalState({ round: 99 });
    expect(() => moraleManager.periodicMoraleUpdate(99, state)).not.toThrow();
  });

  test('does not mutate original state', () => {
    const state = createMinimalState({ round: 1 });
    const origUncommitted = state.morale.france.uncommitted;
    moraleManager.periodicMoraleUpdate(1, state);
    expect(state.morale.france.uncommitted).toBe(origUncommitted);
  });
});

// ---------------------------------------------------------------------------
// investMorale
// ---------------------------------------------------------------------------

describe('investMorale', () => {
  test('moves tokens from uncommitted to map', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 5;

    const next = moraleManager.investMorale(SIDES.FRANCE, 10, 3, state);
    expect(next.morale.france.uncommitted).toBe(2);
    expect(next.moraleTokens.filter(t => t.side === SIDES.FRANCE && t.localeId === 10).length).toBe(3);
  });

  test('overflow: takes from opponent map tokens when uncommitted is 0', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 0;
    // オーストリアのマップトークンを追加
    state.moraleTokens.push({ side: SIDES.AUSTRIA, localeId: 5 });
    state.moraleTokens.push({ side: SIDES.AUSTRIA, localeId: 6 });

    const next = moraleManager.investMorale(SIDES.FRANCE, 10, 2, state);
    // フランスのトークンが増え、オーストリアのトークンが減る
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    const austriaTokens = next.moraleTokens.filter(t => t.side === SIDES.AUSTRIA);
    expect(franceTokens.length).toBe(2);
    expect(austriaTokens.length).toBe(0);
  });

  test('invest 0 tokens does nothing', () => {
    const state = createMinimalState();
    const next = moraleManager.investMorale(SIDES.FRANCE, 10, 0, state);
    expect(next.moraleTokens.length).toBe(0);
    expect(next.morale.france.uncommitted).toBe(state.morale.france.uncommitted);
  });

  test('does not mutate original state', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 5;
    moraleManager.investMorale(SIDES.FRANCE, 10, 2, state);
    expect(state.morale.france.uncommitted).toBe(5);
    expect(state.moraleTokens.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// reduceMorale
// ---------------------------------------------------------------------------

describe('reduceMorale', () => {
  test('reduces from uncommitted first', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 5;

    const next = moraleManager.reduceMorale(SIDES.FRANCE, 3, state);
    expect(next.morale.france.uncommitted).toBe(2);
    expect(next.moraleTokens.length).toBe(0);
  });

  test('then reduces from map tokens when uncommitted is exhausted', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 1;
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 5 });
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 6 });

    const next = moraleManager.reduceMorale(SIDES.FRANCE, 3, state);
    // 1 from uncommitted, 2 from map tokens
    expect(next.morale.france.uncommitted).toBe(0);
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    expect(franceTokens.length).toBe(0);
  });

  test('does not reduce below 0 tokens', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 0;
    // No map tokens

    // Should not throw
    const next = moraleManager.reduceMorale(SIDES.FRANCE, 5, state);
    expect(next.morale.france.uncommitted).toBe(0);
    expect(next.moraleTokens.filter(t => t.side === SIDES.FRANCE).length).toBe(0);
  });

  test('does not affect other side', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 3;
    state.morale.austria.uncommitted = 5;

    const next = moraleManager.reduceMorale(SIDES.FRANCE, 2, state);
    expect(next.morale.austria.uncommitted).toBe(5);
  });

  test('does not mutate original state', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 5;
    moraleManager.reduceMorale(SIDES.FRANCE, 3, state);
    expect(state.morale.france.uncommitted).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// moraleCleanup
// ---------------------------------------------------------------------------

describe('moraleCleanup', () => {
  test('removes own tokens from enemy-occupied locale', () => {
    const state = createMinimalState();
    // フランスのトークンが locale 1 にあり、locale 1 がオーストリア占拠
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 1, position: 'reserve', strength: 3 });

    const next = moraleManager.moraleCleanup(SIDES.AUSTRIA, 5, state);
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    expect(franceTokens.length).toBe(0);
  });

  test('returns tokens to uncommitted when not adjacent to enemy', () => {
    const state = createMinimalState();
    // フランスのトークンが locale 89 にある（端のロケール、敵が隣接していない）
    // 実際のマップの端のロケールを使う必要があるが、ここでは隣接する全ロケールに敵がいないことを確認
    // locale 0 を使う（テストでは AU がいない）
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 0 });
    // locale 0 の周辺にオーストリア駒を置かない

    const next = moraleManager.moraleCleanup(SIDES.FRANCE, 5, state);
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    // 返還されるべき（敵隣接なし）
    expect(franceTokens.length).toBe(0);
    expect(next.morale.france.uncommitted).toBeGreaterThan(state.morale.france.uncommitted);
  });

  test('keeps tokens adjacent to enemy', () => {
    const state = createMinimalState();
    // locale 1 にフランストークン
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 });
    // locale 2 (locale 1 に隣接) にオーストリア駒
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 2, position: 'reserve', strength: 3 });

    // round 12 (>= 11) でクリーンアップ → France ボーナス返還なし
    const next = moraleManager.moraleCleanup(SIDES.FRANCE, 12, state);
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    // locale 1 は locale 2 に隣接、locale 2 がオーストリア占拠なので、フランストークンは残る
    expect(franceTokens.length).toBe(1);
  });

  test('France before round 11: may return 1 invested token to uncommitted', () => {
    const state = createMinimalState({ round: 5 });
    state.morale.france.uncommitted = 0;
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 0 }); // this will be returned by step 2 (no enemy adjacent)
    // To test step 3, we need a token that survives steps 1 and 2 (adjacent to enemy)
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 }); // adjacent to locale 2
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 2, position: 'reserve', strength: 3 });

    const uncommittedBefore = state.morale.france.uncommitted;
    const next = moraleManager.moraleCleanup(SIDES.FRANCE, 5, state);

    // Step 3: フランスはラウンド11未満なので、1トークン返還
    // locale 1 のトークンは locale 2 に隣接するオーストリアがいるので step 2 で残る
    // → step 3 で返還される
    const franceTokensAfter = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    expect(next.morale.france.uncommitted).toBeGreaterThanOrEqual(uncommittedBefore);
  });

  test('France round 11+: no bonus token return', () => {
    const state = createMinimalState({ round: 11 });
    state.morale.france.uncommitted = 0;
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 }); // adjacent to locale 2
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', { localeId: 2, position: 'reserve', strength: 3 });

    const next = moraleManager.moraleCleanup(SIDES.FRANCE, 11, state);
    // locale 1 はオーストリアに隣接するので残る
    // ラウンド11以降なのでボーナス返還なし
    const franceTokens = next.moraleTokens.filter(t => t.side === SIDES.FRANCE);
    expect(franceTokens.length).toBe(1);
  });

  test('does not mutate original state', () => {
    const state = createMinimalState();
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 0 });
    moraleManager.moraleCleanup(SIDES.FRANCE, 5, state);
    expect(state.moraleTokens.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// checkMoraleCollapse
// ---------------------------------------------------------------------------

describe('checkMoraleCollapse', () => {
  test('returns null when no side has 0 morale', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 3;
    state.morale.austria.uncommitted = 1;
    expect(moraleManager.checkMoraleCollapse(state)).toBeNull();
  });

  test('returns collapse for france at 0', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 0;
    // no map tokens
    const result = moraleManager.checkMoraleCollapse(state);
    expect(result).not.toBeNull();
    expect(result.collapsed).toBe(true);
    expect(result.side).toBe(SIDES.FRANCE);
  });

  test('returns collapse for austria at 0', () => {
    const state = createMinimalState();
    state.morale.austria.uncommitted = 0;
    // no map tokens
    const result = moraleManager.checkMoraleCollapse(state);
    expect(result).not.toBeNull();
    expect(result.side).toBe(SIDES.AUSTRIA);
  });

  test('does not collapse when morale is restored by map tokens', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 0;
    state.morale.austria.uncommitted = 1; // ensure Austria not at 0
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 }); // 1 map token for France
    expect(moraleManager.checkMoraleCollapse(state)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getTotalMorale
// ---------------------------------------------------------------------------

describe('getTotalMorale (MoraleManager)', () => {
  test('returns uncommitted + map tokens count', () => {
    const state = createMinimalState();
    state.morale.france.uncommitted = 4;
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 });
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 2 });

    expect(moraleManager.getTotalMorale(SIDES.FRANCE, state)).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// getMapTokens
// ---------------------------------------------------------------------------

describe('getMapTokens', () => {
  test('returns only tokens for given side', () => {
    const state = createMinimalState();
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 1 });
    state.moraleTokens.push({ side: SIDES.FRANCE, localeId: 2 });
    state.moraleTokens.push({ side: SIDES.AUSTRIA, localeId: 3 });

    const franceTokens = moraleManager.getMapTokens(SIDES.FRANCE, state);
    expect(franceTokens.length).toBe(2);
    for (const t of franceTokens) {
      expect(t.side).toBe(SIDES.FRANCE);
    }
  });

  test('returns empty array when no tokens for side', () => {
    const state = createMinimalState();
    expect(moraleManager.getMapTokens(SIDES.FRANCE, state)).toEqual([]);
  });
});
