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
 *  フランスが選択で1トークン回収
 */

const TurnManager = require('../server/engine/TurnManager');
const { createInitialState, SIDES, INTERRUPTION } = require('../server/engine/GameState');

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

/**
 * createInitialState() ベースのテスト用状態を作る。
 * overrides で必要なフィールドを上書きする。
 */
function baseState(overrides = {}) {
  const s = createInitialState();
  s.round = 5;
  s.activePlayer = SIDES.FRANCE;
  s.phase = 'action';
  s.controlToken = { holder: SIDES.FRANCE, reason: 'active_player' };
  s.commandPoints = 3;
  s.morale = {
    france:  { uncommitted: 3, total: 12 },
    austria: { uncommitted: 0, total: 12 },
  };
  s.moraleTokens = [];
  s.moraleTokensPlacedThisTurn = [];
  s.moraleTokensPlacedByEnemyLastTurn = [];
  s.pendingMoraleRemovals = [];
  s.pendingBombardment = null;
  s.pieces = {};
  for (const [k, v] of Object.entries(overrides)) {
    s[k] = v;
  }
  return s;
}

function resp(state, response) {
  return TurnManager.processInterruption(response, state);
}

// =============================================================================
// Test 1: MORALE_TOKEN_REMOVAL（砲撃経由）
// =============================================================================
// フランス砲兵 locale2 → locale1 に砲撃
// オーストリア uncommitted=0、マップトークン locale3/locale5
// 砲撃解決 → reduceMorale(austria,1) → uncommitted不足 → MORALE_TOKEN_REMOVAL
// フランスが locale3 のトークンを選んで除去
// =============================================================================
console.log('\n=== Test 1: MORALE_TOKEN_REMOVAL（砲撃経由） ===');
{
  const state = baseState({
    morale: {
      france:  { uncommitted: 3, total: 12 },
      austria: { uncommitted: 0, total: 12 },
    },
    moraleTokens: [
      { side: 'austria', localeId: 3 },
      { side: 'austria', localeId: 5 },
    ],
    pendingBombardment: {
      artilleryId: 'FR-ART-1',
      targetLocaleId: 1,
      defenseApproachIdx: 2,
      declaredRound: 5,
    },
    pieces: {
      'FR-ART-1': piece('FR-ART-1', 'france', 'artillery', 1, 'approach_1', 2),
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
  expect('MORALE_TOKEN_REMOVAL waitingFor → france',
    r.interruption?.waitingFor, SIDES.FRANCE);
  expect('available tokens = [3, 5]',
    r.interruption?.context?.availableTokens?.slice().sort((a, b) => a - b),
    [3, 5]);
  expect('amount = 1',
    r.interruption?.context?.amount, 1);

  // フランスが locale3 のトークンを選んで除去
  r = resp(r.newState, { localeIds: [3] });

  expect('after removal → no interruption',
    r.interruption, null);
  expect('austria map tokens: locale3 除去・locale5 残る',
    r.newState.moraleTokens.filter(t => t.side === 'austria').map(t => t.localeId),
    [5]);
}

// =============================================================================
// Test 2: FRANCE_MORALE_RECOVERY
// =============================================================================
// フランスがターン終了 → moraleCleanup 後もマップトークンが残存
// （オーストリア駒が隣接しているので除去されない）
// フランスが1トークン回収選択
// =============================================================================
console.log('\n=== Test 2: FRANCE_MORALE_RECOVERY ===');
{
  // locale10 の隣接: 9, 11, 13, 14, 15
  // locale15 の隣接: 10, 14, 18
  // Austria at locale9 → locale10 のトークンが残る
  // Austria at locale14 → locale15 のトークンが残る
  const state = baseState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    round: 8,
    morale: {
      france:  { uncommitted: 2, total: 12 },
      austria: { uncommitted: 3, total: 12 },
    },
    moraleTokens: [
      { side: 'france', localeId: 10 },
      { side: 'france', localeId: 15 },
    ],
    moraleTokensPlacedThisTurn: [],
    moraleTokensPlacedByEnemyLastTurn: [],
    pieces: {
      'FR-INF-1': piece('FR-INF-1', 'france', 'infantry', 3, 'reserve', 10),
      'AU-INF-1': piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', 9),
      'AU-INF-2': piece('AU-INF-2', 'austria', 'infantry', 3, 'reserve', 14),
    },
  });

  const r = TurnManager.executeAction({ type: 'end_turn' }, state);

  expect('end_turn → FRANCE_MORALE_RECOVERY',
    r.interruption?.type, INTERRUPTION.FRANCE_MORALE_RECOVERY);
  expect('waitingFor → france',
    r.interruption?.waitingFor, SIDES.FRANCE);

  const recoverableLocales = r.interruption?.context?.recoverableTokens?.map(t => t.localeId).sort((a, b) => a - b);
  expect('recoverable tokens: locale10 と locale15',
    recoverableLocales, [10, 15]);

  // フランスが locale10 のトークンを回収
  const r2 = resp(r.newState, { localeId: 10 });

  expect('after recovery → no interruption',
    r2.interruption, null);
  expect('france uncommitted +1（回収のみ、round9 の periodicGain=0）',
    r2.newState.morale.france.uncommitted, 2 + 1);
  expect('locale10 トークン除去',
    r2.newState.moraleTokens.some(t => t.side === 'france' && t.localeId === 10),
    false);
  expect('locale15 トークン残存',
    r2.newState.moraleTokens.some(t => t.side === 'france' && t.localeId === 15),
    true);
  expect('turn advanced → activePlayer = austria',
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
    round: 8,
    morale: {
      france:  { uncommitted: 1, total: 12 },
      austria: { uncommitted: 3, total: 12 },
    },
    moraleTokens: [
      { side: 'france', localeId: 10 },
    ],
    moraleTokensPlacedThisTurn: [],
    moraleTokensPlacedByEnemyLastTurn: [],
    pieces: {
      'FR-INF-1': piece('FR-INF-1', 'france', 'infantry', 3, 'reserve', 10),
      'AU-INF-1': piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', 9),
    },
  });

  const r = TurnManager.executeAction({ type: 'end_turn' }, state);

  expect('end_turn → FRANCE_MORALE_RECOVERY',
    r.interruption?.type, INTERRUPTION.FRANCE_MORALE_RECOVERY);

  // スキップ（localeId: null）
  const r2 = resp(r.newState, { localeId: null });

  expect('after skip → no interruption',
    r2.interruption, null);
  expect('uncommitted 変化なし（round9 の periodicGain=0）',
    r2.newState.morale.france.uncommitted, 1);
  expect('locale10 トークン残存',
    r2.newState.moraleTokens.some(t => t.side === 'france' && t.localeId === 10),
    true);
  expect('turn advanced → activePlayer = austria',
    r2.newState.activePlayer, SIDES.AUSTRIA);
}

// =============================================================================
// Test 4: FRANCE_MORALE_RECOVERY — round >= 11 は不発
// =============================================================================
console.log('\n=== Test 4: FRANCE_MORALE_RECOVERY — round >= 11 は不発 ===');
{
  const state = baseState({
    activePlayer: SIDES.FRANCE,
    controlToken: { holder: SIDES.FRANCE, reason: 'active_player' },
    round: 11,
    morale: {
      france:  { uncommitted: 1, total: 12 },
      austria: { uncommitted: 3, total: 12 },
    },
    moraleTokens: [
      { side: 'france', localeId: 10 },
    ],
    moraleTokensPlacedThisTurn: [],
    moraleTokensPlacedByEnemyLastTurn: [],
    pieces: {
      'FR-INF-1': piece('FR-INF-1', 'france', 'infantry', 3, 'reserve', 10),
      'AU-INF-1': piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', 9),
    },
  });

  const r = TurnManager.executeAction({ type: 'end_turn' }, state);

  expect('round 11 end_turn → FRANCE_MORALE_RECOVERY なし',
    r.interruption, null);
  expect('turn advanced → activePlayer = austria',
    r.newState.activePlayer, SIDES.AUSTRIA);
}

// =============================================================================
// Test 5: MORALE_TOKEN_REMOVAL — amount=2（直接インタラプション状態から）
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

  expect('amount=2 除去後 → no interruption',
    r.interruption, null);
  expect('austria tokens: 3と5が除去、7が残る',
    r.newState.moraleTokens.filter(t => t.side === 'austria').map(t => t.localeId),
    [7]);
}

// =============================================================================
// Test 6: MORALE_TOKEN_REMOVAL — uncommitted が途中で尽きるケース
// =============================================================================
// uncommitted=1 の状態で reduceMorale(austria, 3) が呼ばれた場合
// uncommitted から1、残り2 → pendingMoraleRemovals に { amount: 2 } が積まれる
// =============================================================================
console.log('\n=== Test 6: reduceMorale — uncommitted 途中尽き ===');
{
  const { reduceMorale } = require('../server/engine/MoraleManager');

  const state = baseState({
    morale: {
      france:  { uncommitted: 3, total: 12 },
      austria: { uncommitted: 1, total: 12 },
    },
    moraleTokens: [
      { side: 'austria', localeId: 3 },
      { side: 'austria', localeId: 5 },
    ],
  });

  const next = reduceMorale(SIDES.AUSTRIA, 3, state);

  expect('uncommitted が 0 になる', next.morale.austria.uncommitted, 0);
  expect('moraleTokens は直接除去されない（2個残る）',
    next.moraleTokens.filter(t => t.side === 'austria').length, 2);
  expect('pendingMoraleRemovals に { side: austria, amount: 2 } が積まれる',
    next.pendingMoraleRemovals,
    [{ side: 'austria', amount: 2 }]);
}

// =============================================================================
// 結果
// =============================================================================
console.log(`\n${'─'.repeat(50)}`);
console.log(`Total: ${passed + failed}  ✅ ${passed}  ❌ ${failed}`);
if (failed > 0) process.exit(1);
