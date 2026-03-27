'use strict';
/**
 * entry_crossing_traffic.js
 * チェックリスト #10: 増援進入時の交通制限
 *
 * 実行: node tests/entry_crossing_traffic.js
 *
 * ルール: マップの端はその道路の最初の横断とみなされ交通制限が適用される。
 *         → ボルミダ進入はターン最大3駒まで（横断交通制限と同一）。
 *         最初の進入はステップ1、2番目はステップ2、3番目はステップ3。
 */

const { executeAction } = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');
const {
  getLegalEntryActions,
  BORMIDA_ENTRY_CROSSING_ID,
  BORMIDA_ENTRY_DIRECTION,
} = require('../server/engine/MoveValidator');

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

function offMapPiece(id, type = 'infantry', str = 2) {
  return {
    id, side: 'austria', type,
    strength: str, maxStrength: str,
    disordered: false, faceUp: false,
    localeId: null,
    position: 'reserve',
    actedThisTurn: false,
  };
}

function baseState(offMapPieces) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of offMapPieces) s.pieces[p.id] = p;
  s.round = 3;
  s.activePlayer = 'austria';
  s.controlToken = { holder: 'austria', reason: 'active_player' };
  s.commandPoints = 10;
  return s;
}

console.log(`\nℹ️  BORMIDA_ENTRY_CROSSING_ID = "${BORMIDA_ENTRY_CROSSING_ID}"`);
console.log(`ℹ️  BORMIDA_ENTRY_DIRECTION = "${BORMIDA_ENTRY_DIRECTION}"`);

// ════════════════════════════════════════════════════════════════
// テスト 1: 最初の進入が可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 最初の進入が可能 ═══');
{
  const state = baseState([offMapPiece('AU-INF-1')]);
  const actions = getLegalEntryActions(state);
  expect('最初の進入: エントリーアクションあり', actions.length > 0, true);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: 3駒まで進入可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 3駒まで進入可能 ═══');
{
  let state = baseState([
    offMapPiece('AU-INF-1'),
    offMapPiece('AU-INF-2'),
    offMapPiece('AU-INF-3'),
    offMapPiece('AU-INF-4'), // 4駒目（進入不可）
  ]);

  // 1駒目
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU-INF-1' }, state));
  expect('1駒目進入後: crossingTraffic ステップ1記録', state.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID]?.length, 1);
  expect('1駒目進入後: ステップ1', state.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID][0].steps, 1);

  // 2駒目
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU-INF-2' }, state));
  expect('2駒目進入後: crossingTraffic ステップ2記録', state.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID]?.length, 2);
  expect('2駒目進入後: ステップ2', state.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID][1].steps, 2);

  // 3駒目
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU-INF-3' }, state));
  expect('3駒目進入後: crossingTraffic ステップ3記録', state.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID]?.length, 3);
  expect('3駒目進入後: ステップ3', state.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID][2].steps, 3);

  // 4駒目: 進入不可
  const actions4 = getLegalEntryActions(state);
  expect('4駒目: 交通制限によりエントリーアクションなし', actions4.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: crossingTraffic に方向が正しく記録される
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: crossingTraffic に方向が記録される ═══');
{
  const state = baseState([offMapPiece('AU-INF-1')]);
  const { newState } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU-INF-1' }, state);
  const traffic = newState.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID];
  expect('crossingTraffic: 方向が記録される', traffic[0].direction, BORMIDA_ENTRY_DIRECTION);
  expect('crossingTraffic: 駒IDが記録される', traffic[0].pieceId, 'AU-INF-1');
}

// ════════════════════════════════════════════════════════════════
// テスト 4: ターン開始時に crossingTraffic がリセットされる
//           （resetCommandPoints が crossingTraffic をリセット）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: ターン開始時に交通制限がリセットされる ═══');
{
  const { resetCommandPoints } = require('../server/engine/GameState');
  const state = baseState([offMapPiece('AU-INF-1')]);
  const { newState: afterEntry } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU-INF-1' }, state);

  // 交通制限が記録されている
  expect('進入後: crossingTraffic あり',
    (afterEntry.crossingTraffic[BORMIDA_ENTRY_CROSSING_ID] ?? []).length, 1);

  // ターンリセット後
  const reset = resetCommandPoints(afterEntry);
  expect('リセット後: crossingTraffic がクリアされる',
    Object.keys(reset.crossingTraffic).length, 0);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
