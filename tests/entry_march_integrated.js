'use strict';
/**
 * entry_march_integrated.js
 * 増援進入と道路行軍の一体化テスト
 *
 * 仕様:
 *   1駒目(step1)→ 入場後さらに最大2ロケール先まで行軍可
 *   2駒目(step2)→ 入場後さらに最大1ロケール先まで行軍可
 *   3駒目(step3)→ 入場地点で止まる（actedPieceIds に即追加）
 *   4駒目(舟橋) → 入場地点で止まる
 *
 * 実行: node tests/entry_march_integrated.js
 */

const { executeAction } = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');
const {
  getAllLegalActions,
  getLegalRoadMoves,
  BORMIDA_ENTRY_LOCALE_IDX,
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

function mk(id, type = 'infantry') {
  return {
    id, side: 'austria', type,
    strength: 2, maxStrength: 2,
    disordered: false, faceUp: false,
    localeId: null, position: 'reserve',
    actedThisTurn: false,
  };
}

function baseState(pieces) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.round = 3;
  s.activePlayer = 'austria';
  s.controlToken = { holder: 'austria', reason: 'active_player' };
  s.commandPoints = 10;
  return s;
}

// ════════════════════════════════════════════════════════════════
// テスト 1: 1駒目入場後 → actedPieceIds に追加されない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 1駒目入場後は actedPieceIds に入らない ═══');
{
  let state = baseState([mk('AU1')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));

  expect('1駒目: actedPieceIds に入らない', state.actedPieceIds.has('AU1'), false);
  expect('1駒目: enteredThisTurn[AU1] = 2', state.enteredThisTurn['AU1'], 2);
  expect('1駒目: localeId = BORMIDA_ENTRY_LOCALE_IDX', state.pieces['AU1'].localeId, BORMIDA_ENTRY_LOCALE_IDX);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: 2駒目入場後 → actedPieceIds に追加されない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 2駒目入場後は actedPieceIds に入らない ═══');
{
  let state = baseState([mk('AU1'), mk('AU2')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));

  expect('2駒目: actedPieceIds に入らない', state.actedPieceIds.has('AU2'), false);
  expect('2駒目: enteredThisTurn[AU2] = 1', state.enteredThisTurn['AU2'], 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: 3駒目入場後 → actedPieceIds に即追加（入場地点で止まる）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 3駒目入場後は actedPieceIds に即追加 ═══');
{
  let state = baseState([mk('AU1'), mk('AU2'), mk('AU3')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU3' }, state));

  expect('3駒目: actedPieceIds に入る', state.actedPieceIds.has('AU3'), true);
  expect('3駒目: enteredThisTurn[AU3] = 0', state.enteredThisTurn['AU3'], 0);
  const au3Moves = getLegalRoadMoves(state.pieces['AU3'], state);
  expect('3駒目: 道路行軍アクションなし（入場地点で停止）', au3Moves.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 4: 4駒目（舟橋）入場後 → actedPieceIds に即追加
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 4駒目（舟橋）入場後は actedPieceIds に即追加 ═══');
{
  let state = baseState([mk('AU1'), mk('AU2'), mk('AU3'), mk('AU4')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU3' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU4' }, state));

  expect('4駒目: actedPieceIds に入る', state.actedPieceIds.has('AU4'), true);
  const au4Moves = getLegalRoadMoves(state.pieces['AU4'], state);
  expect('4駒目: 道路行軍アクションなし（入場地点で停止）', au4Moves.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 5: 1駒目入場後の合法行軍先（最大2ロケール）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 1駒目の道路行軍深さ（最大2ステップ先） ═══');
{
  let state = baseState([mk('AU1')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));

  const moves = getLegalRoadMoves(state.pieces['AU1'], state);
  // ステップ数が1と2の行軍先がある（最大2ステップ先）
  const maxStep = moves.reduce((m, a) => Math.max(m, a.steps), 0);
  expect('1駒目: 道路行軍が存在する', moves.length > 0, true);
  expect('1駒目: 最大ステップ数 ≤ 2', maxStep <= 2, true);
  expect('1駒目: ステップ3以上の行軍先なし',
    moves.every(a => a.steps <= 2), true);
}

// ════════════════════════════════════════════════════════════════
// テスト 6: 2駒目入場後の合法行軍先（最大1ロケール）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: 2駒目の道路行軍深さ（最大1ステップ先） ═══');
{
  let state = baseState([mk('AU1'), mk('AU2')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));

  const moves = getLegalRoadMoves(state.pieces['AU2'], state);
  expect('2駒目: 道路行軍が存在する', moves.length > 0, true);
  expect('2駒目: ステップ2以上の行軍先なし', moves.every(a => a.steps <= 1), true);
}

// ════════════════════════════════════════════════════════════════
// テスト 7: 1駒目の道路行軍完了後 → actedPieceIds に追加・enteredThisTurn から削除
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 7: 道路行軍完了後は acted 扱い ═══');
{
  let state = baseState([mk('AU1')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));

  // 合法な道路行軍アクションを取得して最初の目的地へ移動
  const moves = getLegalRoadMoves(state.pieces['AU1'], state);
  expect('行軍前: 合法な道路行軍あり', moves.length > 0, true);

  if (moves.length > 0) {
    const marchAction = moves[0];
    ({ newState: state } = executeAction(marchAction, state));

    expect('行軍後: actedPieceIds に追加される', state.actedPieceIds.has('AU1'), true);
    expect('行軍後: enteredThisTurn から削除される', state.enteredThisTurn['AU1'], undefined);

    // 再度行軍不可
    const movesAfter = getLegalRoadMoves(state.pieces['AU1'], state);
    expect('行軍後: 再行軍不可', movesAfter.length, 0);
  }
}

// ════════════════════════════════════════════════════════════════
// テスト 8: 入場直後の駒は悪路行軍・急襲・突撃・砲撃不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 8: 入場直後は道路行軍以外のアクション禁止 ═══');
{
  const { getLegalCrossCountryMoves, getLegalRaids, getLegalAssaults, getLegalBombardments } = require('../server/engine/MoveValidator');

  let state = baseState([mk('AU1'), mk('AU-ART', 'artillery')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU-ART' }, state));

  const ccMoves = getLegalCrossCountryMoves(state.pieces['AU1'], state);
  expect('1駒目: 悪路行軍なし', ccMoves.length, 0);

  const raids = getLegalRaids(state.pieces['AU1'], state);
  expect('1駒目: 急襲なし', raids.length, 0);

  const assaults = getLegalAssaults(state.pieces['AU1'], state);
  expect('1駒目: 突撃なし', assaults.length, 0);

  const bombards = getLegalBombardments(state.pieces['AU-ART'], state);
  expect('入場直後の砲兵: 砲撃なし', bombards.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 9: ターンリセット後 enteredThisTurn がクリアされる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 9: ターンリセット後 enteredThisTurn がクリアされる ═══');
{
  const { resetCommandPoints } = require('../server/engine/GameState');

  let state = baseState([mk('AU1')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  expect('リセット前: enteredThisTurn にあり', state.enteredThisTurn['AU1'], 2);

  const reset = resetCommandPoints(state);
  expect('リセット後: enteredThisTurn が空', Object.keys(reset.enteredThisTurn).length, 0);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
