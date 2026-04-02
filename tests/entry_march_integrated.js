'use strict';
/**
 * entry_march_integrated.js
 * 増援進入と道路行軍の一体化テスト
 *
 * 仕様:
 *   入場時: 全駒 enteredThisTurn = 2 で入場
 *   最初に道路行軍した駒 → 2ステップまで行軍可
 *   2番目に道路行軍した駒 → 1ステップまで行軍可
 *   3番目以降 → 行軍不可（getLegalRoadMoves が空を返す）
 *   ステップ制限は入場順でなく道路行軍実行順で決まる
 *
 * 実行: node tests/entry_march_integrated.js
 */

const { executeAction } = require('../server/engine/TurnManager');
const { createInitialState, resetCommandPoints } = require('../server/engine/GameState');
const {
  getAllLegalActions,
  getLegalRoadMoves,
  getLegalCrossCountryMoves,
  getLegalRaids,
  getLegalAssaults,
  getLegalBombardments,
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
// テスト 2: 2駒目入場後 → actedPieceIds に追加されない・enteredThisTurn = 2
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 2駒目入場後は actedPieceIds に入らない（enteredThisTurn = 2） ═══');
{
  let state = baseState([mk('AU1'), mk('AU2')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));

  expect('2駒目: actedPieceIds に入らない', state.actedPieceIds.has('AU2'), false);
  expect('2駒目: enteredThisTurn[AU2] = 2', state.enteredThisTurn['AU2'], 2);
  expect('2駒目: roadMarchUsedCount = 0（まだ誰も行軍していない）', state.roadMarchUsedCount, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: 3駒目入場後 → 全駒 enteredThisTurn = 2 で入場
//           2駒が道路行軍した後は3駒目の道路行軍が不可になる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 3駒目は入場時 enteredThisTurn=2、2駒行軍後は道路行軍不可 ═══');
{
  let state = baseState([mk('AU1'), mk('AU2'), mk('AU3')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU3' }, state));

  // 入場時点では全員 enteredThisTurn = 2、actedPieceIds には入らない
  expect('3駒目: 入場直後 actedPieceIds に入らない', state.actedPieceIds.has('AU3'), false);
  expect('3駒目: enteredThisTurn[AU3] = 2', state.enteredThisTurn['AU3'], 2);

  // AU1 が道路行軍 → roadMarchUsedCount = 1
  const au1Moves = getLegalRoadMoves(state.pieces['AU1'], state);
  expect('AU1: 入場直後 道路行軍あり', au1Moves.length > 0, true);
  ({ newState: state } = executeAction(au1Moves[0], state));
  expect('AU1 行軍後: roadMarchUsedCount = 1', state.roadMarchUsedCount, 1);

  // AU2 が道路行軍 → roadMarchUsedCount = 2
  const au2Moves = getLegalRoadMoves(state.pieces['AU2'], state);
  expect('AU2: 1回使用後 道路行軍あり', au2Moves.length > 0, true);
  ({ newState: state } = executeAction(au2Moves[0], state));
  expect('AU2 行軍後: roadMarchUsedCount = 2', state.roadMarchUsedCount, 2);

  // AU3: roadMarchUsedCount = 2 なので道路行軍不可
  const au3Moves = getLegalRoadMoves(state.pieces['AU3'], state);
  expect('AU3: 2回使用後 道路行軍なし', au3Moves.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 4: 4駒目（舟橋）入場後も enteredThisTurn = 2 で入場
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 4駒目（舟橋）入場後も enteredThisTurn=2、道路行軍済み後は不可 ═══');
{
  let state = baseState([mk('AU1'), mk('AU2'), mk('AU3'), mk('AU4')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU3' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU4' }, state));

  expect('4駒目: 入場直後 actedPieceIds に入らない', state.actedPieceIds.has('AU4'), false);
  expect('4駒目: enteredThisTurn[AU4] = 2', state.enteredThisTurn['AU4'], 2);

  // AU1・AU2 が道路行軍した後 AU4 は行軍不可
  const au1Moves = getLegalRoadMoves(state.pieces['AU1'], state);
  ({ newState: state } = executeAction(au1Moves[0], state));
  const au2Moves = getLegalRoadMoves(state.pieces['AU2'], state);
  ({ newState: state } = executeAction(au2Moves[0], state));

  const au4Moves = getLegalRoadMoves(state.pieces['AU4'], state);
  expect('4駒目: 2回使用後 道路行軍なし', au4Moves.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 5: 1駒目入場後の合法行軍先（最大2ロケール）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 1駒目の道路行軍深さ（最大2ステップ先） ═══');
{
  let state = baseState([mk('AU1')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));

  const moves = getLegalRoadMoves(state.pieces['AU1'], state);
  const maxStep = moves.reduce((m, a) => Math.max(m, a.steps), 0);
  expect('1駒目: 道路行軍が存在する', moves.length > 0, true);
  expect('1駒目: 最大ステップ数 ≤ 2', maxStep <= 2, true);
  expect('1駒目: ステップ3以上の行軍先なし',
    moves.every(a => a.steps <= 2), true);
}

// ════════════════════════════════════════════════════════════════
// テスト 6: 1駒目が道路行軍後、2駒目は最大1ステップ先のみ
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: 2駒目の道路行軍深さ（1駒目行軍後は最大1ステップ） ═══');
{
  let state = baseState([mk('AU1'), mk('AU2')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));

  // AU1 が先に道路行軍（roadMarchUsedCount = 1）
  const au1Moves = getLegalRoadMoves(state.pieces['AU1'], state);
  expect('AU1: 行軍前 合法行軍あり', au1Moves.length > 0, true);
  ({ newState: state } = executeAction(au1Moves[0], state));

  // AU2 は1ホップのみ（steps は交通ステップ番号なので path.length で確認）
  const au2Moves = getLegalRoadMoves(state.pieces['AU2'], state);
  expect('2駒目: 道路行軍が存在する', au2Moves.length > 0, true);
  expect('2駒目: 2ホップ以上の行軍先なし', au2Moves.every(a => a.path.length <= 2), true);
}

// ════════════════════════════════════════════════════════════════
// テスト 7: 1駒目の道路行軍完了後 → actedPieceIds に追加・enteredThisTurn から削除
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 7: 道路行軍完了後は acted 扱い ═══');
{
  let state = baseState([mk('AU1')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));

  const moves = getLegalRoadMoves(state.pieces['AU1'], state);
  expect('行軍前: 合法な道路行軍あり', moves.length > 0, true);

  if (moves.length > 0) {
    const marchAction = moves[0];
    ({ newState: state } = executeAction(marchAction, state));

    expect('行軍後: actedPieceIds に追加される', state.actedPieceIds.has('AU1'), true);
    expect('行軍後: enteredThisTurn から削除される', state.enteredThisTurn['AU1'], undefined);
    expect('行軍後: roadMarchUsedCount = 1', state.roadMarchUsedCount, 1);

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
// テスト 9: ターンリセット後 enteredThisTurn・roadMarchUsedCount がクリアされる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 9: ターンリセット後 enteredThisTurn・roadMarchUsedCount がクリアされる ═══');
{
  let state = baseState([mk('AU1')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  expect('リセット前: enteredThisTurn にあり', state.enteredThisTurn['AU1'], 2);

  // 道路行軍でカウントを増やす
  const moves = getLegalRoadMoves(state.pieces['AU1'], state);
  ({ newState: state } = executeAction(moves[0], state));
  expect('リセット前: roadMarchUsedCount = 1', state.roadMarchUsedCount, 1);

  const reset = resetCommandPoints(state);
  expect('リセット後: enteredThisTurn が空', Object.keys(reset.enteredThisTurn).length, 0);
  expect('リセット後: roadMarchUsedCount = 0', reset.roadMarchUsedCount, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 10: 入場順と異なる順で行軍しても正しくステップが決まる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 10: 入場3番目の駒が最初に道路行軍→2ステップ使える ═══');
{
  let state = baseState([mk('AU1'), mk('AU2'), mk('AU3')]);
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU1' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU2' }, state));
  ({ newState: state } = executeAction({ type: 'ENTER_MAP', pieceId: 'AU3' }, state));

  // AU3（入場3番目）が最初に行軍 → 2ステップ使える
  const au3Moves = getLegalRoadMoves(state.pieces['AU3'], state);
  expect('AU3（3番目入場）が最初に行軍: 道路行軍あり', au3Moves.length > 0, true);
  expect('AU3: 最大2ステップ', au3Moves.every(a => a.steps <= 2), true);
  ({ newState: state } = executeAction(au3Moves[0], state));
  expect('AU3 行軍後: roadMarchUsedCount = 1', state.roadMarchUsedCount, 1);

  // AU1（入場1番目）が2番目に行軍 → 1ステップのみ
  const au1Moves = getLegalRoadMoves(state.pieces['AU1'], state);
  expect('AU1（1番目入場）が2番目に行軍: 道路行軍あり', au1Moves.length > 0, true);
  expect('AU1: 最大1ホップ', au1Moves.every(a => a.path.length <= 2), true);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
