'use strict';
/**
 * morale_interruptions.js
 * 士気インタラプション（MORALE_TOKEN_REMOVAL / FRANCE_MORALE_RECOVERY）の検証
 *
 * 実行: node tests/morale_interruptions.js
 *
 * ─── Test 1: MORALE_TOKEN_REMOVAL ────────────────────────────────────────
 *  フランス砲兵がオーストリアを砲撃 → オーストリアの uncommitted=0 かつ
 *  マップトークンあり → reduceMorale → MORALE_TOKEN_REMOVAL 発生
 *  フランス（対戦相手）がオーストリアのマップトークンを選んで除去
 *
 * ─── Test 2: FRANCE_MORALE_RECOVERY ──────────────────────────────────────
 *  フランスがターン終了 → moraleCleanup 後もマップトークンが残存
 *  （オーストリア駒が隣接しているので除去されない）
 *  フランスが選択で1トークン回収
 *
 * ─── マップ参考 ───────────────────────────────────────────────────────────
 *  locale 1  adj edge2 → locale 2
 *  locale 2  adj edge1 → locale 1
 *  locale 9  adj → locale 10 (index 0 or equivalent)
 *  locale 10 adj: 9, 13, 14, 15, 11
 *  locale 14 adj: 10, 15, ...
 *  locale 15 adj: 10, 14, 18
 */

const TurnManager = require('../server/engine/TurnManager');
const { SIDES, INTERRUPTION } = require('../server/engine/GameState');

// ─── ヘルパー ────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function piece(id, side, type, str, pos, locale) {
  return {
    id, side, type,
    maxStrength: str,
    strength: str,
    faceUp: false,
    disordered: false,
    localeId: locale,
    position: pos,
    actedThisTurn: false,
  };
}

function baseState(overrides = {}) {
  return {
    round: 5,
    activePlayer: SIDES.FRANCE,
    phase: 'action',
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    pendingInterruption: null,
    commandPoints: 3,
    morale: {
      france:  { uncommitted: 3, total: 12 },
      austria: { uncommitted: 0, total: 12 },
    },
    moraleTokens: [],
    moraleTokensPlacedThisTurn: [],
    pendingMoraleRemovals: [],
    pendingBombardment: null,
    crossingTraffic: {},
    actedPieceIds: new Set(),
    log: [],
    pieces: {},
    ...overrides,
  };
}

function resp(state, response) {
  return TurnManager.processInterruption(response, state);
}

// =============================================================================
// Test 1: MORALE_TOKEN_REMOVAL
// =============================================================================
// シナリオ:
//  フランス砲兵 locale2 approach_1 → locale1 に向けて砲撃（bombardment_complete）
//  locale1 にオーストリア歩兵（reserve）
//  オーストリアは uncommitted=0、マップトークンが locale3/locale5 にある
//  砲撃解決後 reduceMorale(austria, 1) が走り uncommitted が不足
//  → pendingMoraleRemovals に積まれ → MORALE_TOKEN_REMOVAL インタラプション
//  フランス（相手）が locale3 のトークンを選んで除去
// =============================================================================
console.log('\n=== Test 1: MORALE_TOKEN_REMOVAL ===');
{
  // pendingBombardment を直接仕込み、bombardment_complete から開始
  const state = baseState({
    morale: {
      france:  { uncommitted: 3, total: 12 },
      austria: { uncommitted: 0, total: 12 }, // uncommitted なし
    },
    moraleTokens: [
      { side: 'austria', localeId: 3 },
      { side: 'austria', localeId: 5 },
    ],
    pendingBombardment: {
      artilleryId: 'FR-ART-1',
      targetLocaleId: 1,
      defenseApproachIdx: 2, // locale1 の edge2 が locale2 に向いている
      declaredRound: 5,
    },
    pieces: {
      // フランス砲兵: locale2 の approach_1 (→ locale1 方向)
      'FR-ART-1': piece('FR-ART-1', 'france', 'artillery', 1, 'approach_1', 2),
      // オーストリア歩兵: locale1 のリザーブ（砲撃ターゲット）
      'AU-INF-1': piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', 1),
    },
  });

  // 砲撃完遂 → BOMBARDMENT_REDUCTION（防御側が被弾駒を選ぶ）
  let r = TurnManager.executeAction({ type: 'bombardment_complete' }, state);

  expect('bombardment_complete → BOMBARDMENT_REDUCTION',
    r.interruption?.type, INTERRUPTION.BOMBARDMENT_REDUCTION);

  expect('BOMBARDMENT_REDUCTION waitingFor → austria',
    r.interruption?.waitingFor, SIDES.AUSTRIA);

  // オーストリアが被弾駒を選択
  r = resp(r.newState, { targetPieceId: 'AU-INF-1' });

  expect('after bombardment resolve → MORALE_TOKEN_REMOVAL',
    r.interruption?.type, INTERRUPTION.MORALE_TOKEN_REMOVAL);

  expect('MORALE_TOKEN_REMOVAL waitingFor → france (オーストリアの相手)',
    r.interruption?.waitingFor, SIDES.FRANCE);

  expect('available tokens = austria map token locales [3, 5]',
    r.interruption?.context?.availableTokens?.slice().sort((a,b) => a-b),
    [3, 5]);

  expect('amount = 1',
    r.interruption?.context?.amount, 1);

  // フランスがオーストリアのトークンを選んで除去（locale3 を選択）
  r = resp(r.newState, { localeIds: [3] });

  expect('after removal → no interruption',
    r.interruption, null);

  expect('austria map tokens: locale3 removed, locale5 remains',
    r.newState.moraleTokens.filter(t => t.side === 'austria').map(t => t.localeId),
    [5]);
}

// =============================================================================
// Test 2: FRANCE_MORALE_RECOVERY
// =============================================================================
// シナリオ:
//  フランスがターン終了 → moraleCleanup が走る
//  フランスのマップトークン: locale10, locale15 (このターン未投入)
//  オーストリア駒が locale9（locale10 の隣接）と locale14（locale15 の隣接）にいる
//  → cleanup でトークンが除去されず残る
//  → getRecoverableTokens で回収可能トークンが見つかる
//  → FRANCE_MORALE_RECOVERY インタラプション発生
//  → フランスが locale10 のトークンを回収
//  → uncommitted+1、ターン進行
// =============================================================================
console.log('\n=== Test 2: FRANCE_MORALE_RECOVERY ===');
{
  // locale10 の隣接: 9, 11, 13, 14, 15
  // locale15 の隣接: 10, 14, 18
  // Austria at locale9 → locale10 に隣接（token stays）
  // Austria at locale14 → locale15 に隣接（token stays）
  const state = baseState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    round: 8, // < 11 なのでフランス特権有効（round9 に進む → France morale gain = 0）
    morale: {
      france:  { uncommitted: 2, total: 12 },
      austria: { uncommitted: 3, total: 12 },
    },
    moraleTokens: [
      { side: 'france', localeId: 10 }, // このターン未投入
      { side: 'france', localeId: 15 }, // このターン未投入
    ],
    moraleTokensPlacedThisTurn: [], // 今ターンは置いていない
    pieces: {
      // フランス駒: locale10（自占拠にして token を守る）
      'FR-INF-1': piece('FR-INF-1', 'france', 'infantry', 3, 'reserve', 10),
      // オーストリア駒: locale9（locale10 の隣接）→ cleanup で token が除去されない
      'AU-INF-1': piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', 9),
      // オーストリア駒: locale14（locale15 の隣接）→ cleanup で token が除去されない
      'AU-INF-2': piece('AU-INF-2', 'austria', 'infantry', 3, 'reserve', 14),
    },
  });

  // フランスがターン終了
  const r = TurnManager.executeAction({ type: 'end_turn' }, state);

  expect('end_turn → FRANCE_MORALE_RECOVERY interruption',
    r.interruption?.type, INTERRUPTION.FRANCE_MORALE_RECOVERY);

  expect('waitingFor → france',
    r.interruption?.waitingFor, SIDES.FRANCE);

  const recoverableLocales = r.interruption?.context?.recoverableTokens?.map(t => t.localeId).sort();
  expect('recoverable tokens include locale10 and locale15',
    recoverableLocales, [10, 15].sort());

  // フランスが locale10 のトークンを回収
  const r2 = resp(r.newState, { localeId: 10 });

  expect('after recovery → no interruption',
    r2.interruption, null);

  // round8→9: periodicMoraleUpdate(9) → France gain=0 なので uncommitted は recovery の +1 のみ
  expect('france uncommitted increased by 1 (recovery only, no periodic gain at round9)',
    r2.newState.morale.france.uncommitted, 2 + 1);

  expect('locale10 token removed from map',
    r2.newState.moraleTokens.some(t => t.side === 'france' && t.localeId === 10),
    false);

  expect('locale15 token still on map',
    r2.newState.moraleTokens.some(t => t.side === 'france' && t.localeId === 15),
    true);

  expect('turn advanced (activePlayer changed to austria)',
    r2.newState.activePlayer, SIDES.AUSTRIA);
}

// =============================================================================
// Test 3: FRANCE_MORALE_RECOVERY — スキップ
// =============================================================================
console.log('\n=== Test 3: FRANCE_MORALE_RECOVERY — スキップ ===');
{
  const state = baseState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    round: 8, // round9 に進む → periodicMoraleUpdate(9) France gain=0
    morale: {
      france:  { uncommitted: 1, total: 12 },
      austria: { uncommitted: 3, total: 12 },
    },
    moraleTokens: [
      { side: 'france', localeId: 10 },
    ],
    moraleTokensPlacedThisTurn: [],
    pieces: {
      'FR-INF-1': piece('FR-INF-1', 'france', 'infantry', 3, 'reserve', 10),
      'AU-INF-1': piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', 9),
    },
  });

  const r = TurnManager.executeAction({ type: 'end_turn' }, state);

  expect('end_turn → FRANCE_MORALE_RECOVERY',
    r.interruption?.type, INTERRUPTION.FRANCE_MORALE_RECOVERY);

  // フランスがスキップ（localeId: null）
  const r2 = resp(r.newState, { localeId: null });

  expect('after skip → no interruption',
    r2.interruption, null);

  // round9: periodicMoraleUpdate(9) France gain=0 → uncommitted is still 1
  expect('uncommitted unchanged after skip (no periodic gain at round9)',
    r2.newState.morale.france.uncommitted, 1);

  expect('locale10 token still on map after skip',
    r2.newState.moraleTokens.some(t => t.side === 'france' && t.localeId === 10),
    true);

  expect('turn advanced after skip',
    r2.newState.activePlayer, SIDES.AUSTRIA);
}

// =============================================================================
// Test 4: FRANCE_MORALE_RECOVERY — ラウンド11以降は不発
// =============================================================================
console.log('\n=== Test 4: FRANCE_MORALE_RECOVERY — round >= 11 は不発 ===');
{
  const state = baseState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    round: 11, // 11以降は特権なし
    morale: {
      france:  { uncommitted: 1, total: 12 },
      austria: { uncommitted: 3, total: 12 },
    },
    moraleTokens: [
      { side: 'france', localeId: 10 },
    ],
    moraleTokensPlacedThisTurn: [],
    pieces: {
      'FR-INF-1': piece('FR-INF-1', 'france', 'infantry', 3, 'reserve', 10),
      'AU-INF-1': piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', 9),
    },
  });

  const r = TurnManager.executeAction({ type: 'end_turn' }, state);

  expect('round 11 end_turn → no FRANCE_MORALE_RECOVERY',
    r.interruption, null);

  expect('turn advanced to austria',
    r.newState.activePlayer, SIDES.AUSTRIA);
}

// =============================================================================
// Test 5: MORALE_TOKEN_REMOVAL — 複数除去の連鎖
// =============================================================================
// シナリオ:
//  砲撃2回分の pendingMoraleRemovals が積まれた場合に相当
//  2トークン除去が必要 → MORALE_TOKEN_REMOVAL(amount=2)
//  フランスが2つのロケールを選択して除去
// =============================================================================
console.log('\n=== Test 5: MORALE_TOKEN_REMOVAL — amount=2 ===');
{
  const state = baseState({
    morale: {
      france:  { uncommitted: 3, total: 12 },
      austria: { uncommitted: 0, total: 12 },
    },
    moraleTokens: [
      { side: 'austria', localeId: 3 },
      { side: 'austria', localeId: 5 },
      { side: 'austria', localeId: 7 },
    ],
    // 2トークン除去要求を直接仕込む
    pendingMoraleRemovals: [{ side: 'austria', amount: 2 }],
    pendingInterruption: {
      type: INTERRUPTION.MORALE_TOKEN_REMOVAL,
      waitingFor: SIDES.FRANCE,
      context: {
        side: 'austria',
        amount: 2,
        availableTokens: [3, 5, 7],
      },
    },
    controlToken: { holder: SIDES.FRANCE, reason: INTERRUPTION.MORALE_TOKEN_REMOVAL },
    pieces: {},
  });

  // フランスが2つのロケール（3,5）を選択
  const r = resp(state, { localeIds: [3, 5] });

  expect('after amount=2 removal → no interruption',
    r.interruption, null);

  expect('austria tokens: 3と5が除去、7が残る',
    r.newState.moraleTokens.filter(t => t.side === 'austria').map(t => t.localeId),
    [7]);
}

// =============================================================================
// 結果
// =============================================================================
console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${passed + failed}  ✅ ${passed}  ❌ ${failed}`);
if (failed > 0) process.exit(1);
