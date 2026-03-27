'use strict';
/**
 * france_morale_recovery_enemy_turn.js
 * チェックリスト #7: FRANCE_MORALE_RECOVERY「直前の相手ターンに移動されたトークンは選択不可」
 *
 * 実行: node tests/france_morale_recovery_enemy_turn.js
 *
 * ルール: フランス回収時、直前のオーストリアターン中に別ロケールへ移動（投入）された
 *         トークンは選択できない。
 */

const { getRecoverableTokens } = require('../server/engine/MoraleManager');
const { createInitialState } = require('../server/engine/GameState');

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

function baseState() {
  const s = createInitialState();
  s.pieces = {};
  s.activePlayer  = 'france';
  s.controlToken  = { holder: 'france', reason: 'active_player' };
  s.commandPoints = 3;
  s.round = 8;
  return s;
}

// ════════════════════════════════════════════════════════════════
// テスト 1: 既存動作確認 — このターン投入したトークンは除外される
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: このターン投入したトークンは回収不可 ═══');
{
  const state = baseState();
  // ロケール10に2トークン: 1つはこのターン投入、1つは以前から
  state.moraleTokens = [
    { side: 'france', localeId: 10 },
    { side: 'france', localeId: 10 },
  ];
  state.moraleTokensPlacedThisTurn = [{ side: 'france', localeId: 10 }]; // このターン1つ投入
  state.moraleTokensPlacedByEnemyLastTurn = [];

  const tokens = getRecoverableTokens(state);
  const at10 = tokens.find(t => t.localeId === 10);
  expect('ロケール10: 1つのみ回収可能（このターン投入の1つは除外）',
    at10?.count, 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: 新ルール — 直前のオーストリアターンに投入されたトークンも除外
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 直前オーストリアターン投入のトークンは回収不可 ═══');
{
  const state = baseState();
  // ロケール10に3トークン: 1つはオーストリアターンに投入、2つは以前から
  state.moraleTokens = [
    { side: 'france', localeId: 10 },
    { side: 'france', localeId: 10 },
    { side: 'france', localeId: 10 },
  ];
  state.moraleTokensPlacedThisTurn = []; // フランスターンには投入なし
  state.moraleTokensPlacedByEnemyLastTurn = [{ side: 'france', localeId: 10 }]; // オーストリアターンに1つ投入

  const tokens = getRecoverableTokens(state);
  const at10 = tokens.find(t => t.localeId === 10);
  expect('ロケール10: 2つのみ回収可能（オーストリアターン投入の1つは除外）',
    at10?.count, 2);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: 両方除外 — このターン＋直前オーストリアターンの合計を除外
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: このターン + 直前オーストリアターンの両方を除外 ═══');
{
  const state = baseState();
  // ロケール10に4トークン
  state.moraleTokens = Array(4).fill({ side: 'france', localeId: 10 });
  state.moraleTokensPlacedThisTurn = [{ side: 'france', localeId: 10 }]; // フランスターン1つ
  state.moraleTokensPlacedByEnemyLastTurn = [{ side: 'france', localeId: 10 }, { side: 'france', localeId: 10 }]; // オーストリアターン2つ

  const tokens = getRecoverableTokens(state);
  const at10 = tokens.find(t => t.localeId === 10);
  expect('ロケール10: 1つのみ回収可能（4-1-2=1）',
    at10?.count, 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 4: 全部除外されると回収不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 全トークンが除外対象 → 回収不可 ═══');
{
  const state = baseState();
  state.moraleTokens = [{ side: 'france', localeId: 10 }];
  state.moraleTokensPlacedThisTurn = [];
  state.moraleTokensPlacedByEnemyLastTurn = [{ side: 'france', localeId: 10 }]; // 全部オーストリアターン投入

  const tokens = getRecoverableTokens(state);
  const at10 = tokens.find(t => t.localeId === 10);
  expect('ロケール10: 回収可能なし（全て除外）',
    at10, undefined);
}

// ════════════════════════════════════════════════════════════════
// テスト 5: moraleTokensPlacedByEnemyLastTurn が未設定でも安全
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: moraleTokensPlacedByEnemyLastTurn 未設定でも動作 ═══');
{
  const state = baseState();
  state.moraleTokens = [{ side: 'france', localeId: 10 }];
  state.moraleTokensPlacedThisTurn = [];
  delete state.moraleTokensPlacedByEnemyLastTurn;

  let didThrow = false;
  let tokens;
  try { tokens = getRecoverableTokens(state); } catch { didThrow = true; }
  expect('未設定でもクラッシュしない', didThrow, false);
  const at10 = tokens?.find(t => t.localeId === 10);
  expect('フィールド未設定時: トークンは回収可能', at10?.count, 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 6: オーストリアのトークンは除外対象にならない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: オーストリアのトークン投入はフランス回収に影響しない ═══');
{
  const state = baseState();
  state.moraleTokens = [{ side: 'france', localeId: 10 }];
  state.moraleTokensPlacedThisTurn = [];
  state.moraleTokensPlacedByEnemyLastTurn = [{ side: 'austria', localeId: 10 }]; // オーストリアトークン

  const tokens = getRecoverableTokens(state);
  const at10 = tokens.find(t => t.localeId === 10);
  expect('オーストリアトークンの投入はフランスの回収に影響しない',
    at10?.count, 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 7: 異なるロケールのトークンは互いに影響しない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 7: 別ロケールの除外は独立 ═══');
{
  const state = baseState();
  state.moraleTokens = [
    { side: 'france', localeId: 10 },
    { side: 'france', localeId: 20 },
    { side: 'france', localeId: 20 },
  ];
  state.moraleTokensPlacedThisTurn = [];
  state.moraleTokensPlacedByEnemyLastTurn = [{ side: 'france', localeId: 10 }]; // ロケール10のみ除外

  const tokens = getRecoverableTokens(state);
  const at10 = tokens.find(t => t.localeId === 10);
  const at20 = tokens.find(t => t.localeId === 20);
  expect('ロケール10: 回収不可（全部除外）', at10, undefined);
  expect('ロケール20: 2つ回収可能（除外なし）', at20?.count, 2);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
