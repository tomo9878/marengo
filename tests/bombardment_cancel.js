'use strict';
/**
 * bombardment_cancel.js
 * チェックリスト #11: 砲撃宣言の取り消し
 *
 * 実行: node tests/bombardment_cancel.js
 *
 * ルール: 完遂前であればコスト・ペナルティなしで宣言を取り消せる。
 *         砲兵が宣言したアプローチを離れた場合は自動取り消し。
 */

const { executeAction } = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');
const { getLegalBombardments } = require('../server/engine/MoveValidator');

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

function piece(id, side, type, str, locale, position) {
  return {
    id, side, type,
    strength: str, maxStrength: str,
    disordered: false, faceUp: false,
    localeId: locale,
    position,
    actedThisTurn: false,
  };
}

function baseState(pieces) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.round = 5;
  s.activePlayer = 'france';
  s.controlToken = { holder: 'france', reason: 'active_player' };
  s.commandPoints = 6;
  return s;
}

// ════════════════════════════════════════════════════════════════
// テスト 1: 砲撃宣言の手動取り消し
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 砲撃宣言の手動取り消し ═══');
{
  // マップ上のロケールで砲兵がアプローチにいる状態を作る
  // （実際のマップの隣接関係を使わずに直接 pendingBombardment をセット）
  const state = baseState([
    piece('FR-ART-1', 'france', 'artillery', 2, 5, 'approach_0'),
    piece('AU-INF-1', 'austria', 'infantry', 2, 6, 'reserve'),
  ]);
  state.pendingBombardment = {
    artilleryId: 'FR-ART-1',
    targetLocaleId: 6,
    defenseApproachIdx: 0,
    declaredRound: 5,
  };
  state.pieces['FR-ART-1'] = { ...state.pieces['FR-ART-1'], faceUp: true };

  // 宣言済みの砲兵に getLegalBombardments は取り消しアクションを返す
  const bombActions = getLegalBombardments(state.pieces['FR-ART-1'], state);
  expect('砲撃宣言済み砲兵: 取り消しアクションが返る', bombActions.length > 0, true);
  if (bombActions.length > 0) {
    expect('アクションタイプ: bombardment_cancel', bombActions[0].type, 'bombardment_cancel');
    expect('コストゼロ', bombActions[0].commandCost, 0);
  }

  // 取り消しを実行
  const { newState } = executeAction({ type: 'bombardment_cancel', pieceId: 'FR-ART-1' }, state);
  expect('取り消し後: pendingBombardment が null', newState.pendingBombardment, null);
  expect('取り消し後: 砲兵が裏向きに戻る', newState.pieces['FR-ART-1'].faceUp, false);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: 砲撃取り消しはコストなし
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 砲撃取り消しはコストなし ═══');
{
  const state = baseState([
    piece('FR-ART-1', 'france', 'artillery', 2, 5, 'approach_0'),
  ]);
  state.commandPoints = 1; // CPが少ない状態
  state.pendingBombardment = {
    artilleryId: 'FR-ART-1',
    targetLocaleId: 6,
    defenseApproachIdx: 0,
    declaredRound: 5,
  };

  const { newState } = executeAction({ type: 'bombardment_cancel', pieceId: 'FR-ART-1' }, state);
  expect('取り消し後: CPは変化しない', newState.commandPoints, 1);
  expect('取り消し後: pendingBombardment が null', newState.pendingBombardment, null);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: 自動取り消し — 砲兵がアプローチから離れた場合
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 自動取り消し — 砲兵がアプローチから離れると自動取り消し ═══');
{
  const state = baseState([
    piece('FR-ART-1', 'france', 'artillery', 2, 5, 'approach_0'),
  ]);
  state.pendingBombardment = {
    artilleryId: 'FR-ART-1',
    targetLocaleId: 6,
    defenseApproachIdx: 0,
    declaredRound: 5,
  };
  state.pieces['FR-ART-1'] = { ...state.pieces['FR-ART-1'], faceUp: true };

  // 砲兵をリザーブへ移動（cross_country_march: アプローチ→リザーブ）
  const marchAction = {
    type: 'cross_country_march',
    pieceId: 'FR-ART-1',
    from: { localeId: 5, position: 'approach_0' },
    to:   { localeId: 5, position: 'reserve' },
    commandCost: 1,
  };
  const { newState } = executeAction(marchAction, state);
  expect('アプローチを離れた後: pendingBombardment が自動取り消し', newState.pendingBombardment, null);
  expect('アプローチを離れた後: 砲兵が裏向きに戻る', newState.pieces['FR-ART-1'].faceUp, false);
}

// ════════════════════════════════════════════════════════════════
// テスト 4: 別の駒が移動しても取り消されない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 別の駒の移動は砲撃宣言に影響しない ═══');
{
  const state = baseState([
    piece('FR-ART-1', 'france', 'artillery', 2, 5, 'approach_0'),
    piece('FR-INF-1', 'france', 'infantry', 2, 5, 'reserve'),
  ]);
  state.pendingBombardment = {
    artilleryId: 'FR-ART-1',
    targetLocaleId: 6,
    defenseApproachIdx: 0,
    declaredRound: 5,
  };
  state.pieces['FR-ART-1'] = { ...state.pieces['FR-ART-1'], faceUp: true };

  // 別の駒を移動
  const marchAction = {
    type: 'cross_country_march',
    pieceId: 'FR-INF-1',
    from: { localeId: 5, position: 'reserve' },
    to:   { localeId: 5, position: 'approach_1' },
    commandCost: 1,
  };
  const { newState } = executeAction(marchAction, state);
  expect('別の駒が移動: pendingBombardment は維持される', newState.pendingBombardment?.artilleryId, 'FR-ART-1');
}

// ════════════════════════════════════════════════════════════════
// テスト 5: 宣言のない砲兵に取り消しアクションは返らない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 宣言のない砲兵に取り消しアクションは返らない ═══');
{
  const state = baseState([
    piece('FR-ART-1', 'france', 'artillery', 2, 5, 'approach_0'),
    piece('AU-INF-1', 'austria', 'infantry', 2, 6, 'reserve'),
  ]);
  // pendingBombardment なし（または別の砲兵の宣言）
  state.pendingBombardment = null;

  // アプローチ側の砲兵が砲撃宣言アクションを返す（通常の砲撃または宣言、テスト環境では地形次第）
  // ここではアクション一覧に bombardment_cancel が含まれないことを確認
  const bombActions = getLegalBombardments(state.pieces['FR-ART-1'], state);
  const cancelActions = bombActions.filter(a => a.type === 'bombardment_cancel');
  expect('宣言なし: 取り消しアクションが返らない', cancelActions.length, 0);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
