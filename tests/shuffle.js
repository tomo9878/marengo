'use strict';
/**
 * shuffle.js
 * チェックリスト #12: 駒のシャッフル
 *
 * 実行: node tests/shuffle.js
 *
 * ルール: 同じポジション・保持エリアにいる複数の駒をシャッフルして元の場所に戻せる。
 *         いつでも実施可（相手ターン中も）。ただし済/未アクション駒の混在不可。
 */

const { executeAction } = require('../server/engine/TurnManager');
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

function expectThrows(label, fn) {
  try {
    fn();
    console.log(`  ❌ ${label} (例外が発生しなかった)`);
    failed++;
  } catch (e) {
    console.log(`  ✅ ${label} (例外: ${e.message})`);
    passed++;
  }
}

function piece(id, side, type, str, locale, position, acted = false) {
  return {
    id, side, type,
    strength: str, maxStrength: str,
    disordered: false, faceUp: false,
    localeId: locale,
    position,
    actedThisTurn: acted,
  };
}

function baseState(pieces, activePlayer = 'austria') {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.round = 5;
  s.activePlayer = activePlayer;
  s.controlToken = { holder: activePlayer, reason: 'active_player' };
  s.commandPoints = 3;
  return s;
}

// ════════════════════════════════════════════════════════════════
// テスト 1: 通常のシャッフル（同じロケール・ポジション）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 通常のシャッフル ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 5, 'reserve'),
    piece('AU-INF-2', 'austria', 'infantry', 2, 5, 'reserve'),
  ]);

  const { newState } = executeAction({ type: 'shuffle', pieceIds: ['AU-INF-1', 'AU-INF-2'], side: 'austria' }, state);
  expect('シャッフル後: 駒はそのままのロケール', newState.pieces['AU-INF-1'].localeId, 5);
  expect('シャッフル後: 駒はそのままのポジション', newState.pieces['AU-INF-2'].position, 'reserve');
}

// ════════════════════════════════════════════════════════════════
// テスト 2: 相手ターン中にシャッフル可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 相手ターン中にシャッフル可能 ═══');
{
  // オーストリアがアクティブプレイヤーでも、フランス駒をシャッフルできる
  const state = baseState([
    piece('FR-INF-1', 'france', 'infantry', 2, 5, 'reserve'),
    piece('FR-INF-2', 'france', 'infantry', 2, 5, 'reserve'),
  ], 'austria'); // オーストリアターン中
  state.controlToken = { holder: 'austria', reason: 'active_player' };

  // 制御権に関係なくシャッフル実行可能
  let didThrow = false;
  try {
    executeAction({ type: 'shuffle', pieceIds: ['FR-INF-1', 'FR-INF-2'], side: 'france' }, state);
  } catch {
    didThrow = true;
  }
  expect('相手ターン中もシャッフル実行可', didThrow, false);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: アクション済み駒と未アクション駒の混在は不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 済/未アクション駒の混在不可 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 5, 'reserve'),
    piece('AU-INF-2', 'austria', 'infantry', 2, 5, 'reserve'),
  ]);
  // AU-INF-1 はアクション済みとしてマーク
  state.actedPieceIds.add('AU-INF-1');

  expectThrows(
    '済/未アクション混在: 例外が発生する',
    () => executeAction({ type: 'shuffle', pieceIds: ['AU-INF-1', 'AU-INF-2'], side: 'austria' }, state)
  );
}

// ════════════════════════════════════════════════════════════════
// テスト 4: 全員アクション済みならシャッフル可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 全員アクション済みならシャッフル可 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 5, 'reserve'),
    piece('AU-INF-2', 'austria', 'infantry', 2, 5, 'reserve'),
  ]);
  state.actedPieceIds.add('AU-INF-1');
  state.actedPieceIds.add('AU-INF-2');

  let didThrow = false;
  try {
    executeAction({ type: 'shuffle', pieceIds: ['AU-INF-1', 'AU-INF-2'], side: 'austria' }, state);
  } catch {
    didThrow = true;
  }
  expect('全員アクション済み: シャッフル可', didThrow, false);
}

// ════════════════════════════════════════════════════════════════
// テスト 5: 異なるロケールの駒は混在不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 異なるロケールの駒は混在不可 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 5, 'reserve'),
    piece('AU-INF-2', 'austria', 'infantry', 2, 6, 'reserve'), // 別ロケール
  ]);

  expectThrows(
    '異なるロケール: 例外が発生する',
    () => executeAction({ type: 'shuffle', pieceIds: ['AU-INF-1', 'AU-INF-2'], side: 'austria' }, state)
  );
}

// ════════════════════════════════════════════════════════════════
// テスト 6: 異なるポジションの駒は混在不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: 異なるポジションの駒は混在不可 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 5, 'reserve'),
    piece('AU-INF-2', 'austria', 'infantry', 2, 5, 'approach_0'), // 別ポジション
  ]);

  expectThrows(
    '異なるポジション: 例外が発生する',
    () => executeAction({ type: 'shuffle', pieceIds: ['AU-INF-1', 'AU-INF-2'], side: 'austria' }, state)
  );
}

// ════════════════════════════════════════════════════════════════
// テスト 7: 1駒でのシャッフルは不可（2駒以上が必要）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 7: 1駒ではシャッフル不可 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 5, 'reserve'),
  ]);

  expectThrows(
    '1駒: 例外が発生する',
    () => executeAction({ type: 'shuffle', pieceIds: ['AU-INF-1'], side: 'austria' }, state)
  );
}

// ════════════════════════════════════════════════════════════════
// テスト 8: シャッフルはCPを消費しない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 8: シャッフルはCPを消費しない ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 5, 'reserve'),
    piece('AU-INF-2', 'austria', 'infantry', 2, 5, 'reserve'),
  ]);
  state.commandPoints = 0; // CPがゼロでも実行可能

  let didThrow = false;
  let resultState;
  try {
    const { newState } = executeAction({ type: 'shuffle', pieceIds: ['AU-INF-1', 'AU-INF-2'], side: 'austria' }, state);
    resultState = newState;
  } catch {
    didThrow = true;
  }
  expect('CPゼロでもシャッフル可', didThrow, false);
  if (resultState) {
    expect('CP消費なし', resultState.commandPoints, 0);
  }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
