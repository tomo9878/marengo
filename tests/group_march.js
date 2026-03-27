'use strict';
/**
 * group_march.js
 * セクション7: 悪路行軍グループ移動テスト
 *
 * 同じロケール・同じポジションにいる複数駒（最大3）を
 * 1アクション・1CPでまとめて移動できることを確認する。
 *
 * 実行: node tests/group_march.js
 */

const { executeAction } = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');
const {
  getAllLegalActions,
  findGroupCandidates,
  getLegalCrossCountryMoves,
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

function expectTrue(label, val) { expect(label, !!val, true); }
function expectFalse(label, val) { expect(label, !!val, false); }

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function piece(id, localeId, position = 'reserve', type = 'infantry', strength = 2) {
  return {
    id, side: 'austria', type,
    strength, maxStrength: strength,
    disordered: false, faceUp: true,
    localeId, position,
    actedThisTurn: false,
  };
}

function baseState(pieces, cp = 10) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.activePlayer = 'austria';
  s.controlToken = { holder: 'austria', reason: 'active_player' };
  s.commandPoints = cp;
  s.round = 3;
  return s;
}

// ---------------------------------------------------------------------------
// テスト 1: findGroupCandidates — 同ポジション2駒がお互いを候補に返す
// ---------------------------------------------------------------------------
console.log('\n═══ Test 1: findGroupCandidates — 同ポジション2駒 ═══');
{
  // locale3 → locale5 は合法な悪路行軍の目的地（テスト頻用ロケール）
  // ここでは locale2 → locale3 を使う（単純な隣接）
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 2, 'reserve'),
  ]);

  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  // アプローチ移動（defensive_march）を除いた cross_country_march を対象にする
  const ccMovesA = movesA.filter(m => m.type === 'cross_country_march');
  expectTrue('AU-A に cross_country_march アクションが存在する', ccMovesA.length > 0);

  if (ccMovesA.length > 0) {
    const firstMove = ccMovesA[0];
    const candidates = findGroupCandidates(firstMove, state);
    expectTrue('AU-A の move の候補に AU-B が含まれる', candidates.includes('AU-B'));
    expectFalse('AU-A の move の候補に AU-A 自身は含まれない', candidates.includes('AU-A'));
  }
}

// ---------------------------------------------------------------------------
// テスト 2: getAllLegalActions — cross_country_march に groupCandidates が付与される
// ---------------------------------------------------------------------------
console.log('\n═══ Test 2: getAllLegalActions — groupCandidates 付与 ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 2, 'reserve'),
  ]);

  const actions = getAllLegalActions(state);
  const ccActions = actions.filter(a => a.type === 'cross_country_march' && a.pieceId === 'AU-A');
  expectTrue('AU-A の cross_country_march アクションが存在する', ccActions.length > 0);

  // 少なくとも1つのアクションに groupCandidates が付いている
  const withCandidates = ccActions.filter(a => a.groupCandidates && a.groupCandidates.length > 0);
  expectTrue('AU-A の移動先に groupCandidates が付与された', withCandidates.length > 0);
  if (withCandidates.length > 0) {
    expectTrue('groupCandidates に AU-B が含まれる', withCandidates[0].groupCandidates.includes('AU-B'));
  }
}

// ---------------------------------------------------------------------------
// テスト 3: グループ移動実行（2駒）— 両駒が移動・1CP消費・両方 actedPieceIds
// ---------------------------------------------------------------------------
console.log('\n═══ Test 3: グループ移動実行（2駒） ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 2, 'reserve'),
    piece('AU-C', 4, 'reserve'), // locale4 にいる別駒（移動先）
  ]);
  // locale2 → locale3 の悪路行軍で 2駒まとめて移動
  // 合法な移動先を確認してからアクション構築
  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  const sharedMoves = movesA.filter(m => {
    const movesB = getLegalCrossCountryMoves(state.pieces['AU-B'], state);
    return movesB.some(mb => mb.to.localeId === m.to.localeId && mb.to.position === m.to.position);
  });
  expectTrue('AU-A と AU-B の共通移動先がある', sharedMoves.length > 0);

  if (sharedMoves.length > 0) {
    const target = sharedMoves[0];
    const groupAction = {
      type: 'cross_country_march',
      pieceIds: ['AU-A', 'AU-B'],
      from: { localeId: 2, position: 'reserve' },
      to: target.to,
      commandCost: 1,
    };
    const { newState } = executeAction(groupAction, state);

    expect('AU-A が目的地に移動した', newState.pieces['AU-A'].localeId, target.to.localeId);
    expect('AU-B が目的地に移動した', newState.pieces['AU-B'].localeId, target.to.localeId);
    expect('CP が1消費された', newState.commandPoints, 9);
    expectTrue('AU-A が actedPieceIds に追加された', newState.actedPieceIds.has('AU-A'));
    expectTrue('AU-B が actedPieceIds に追加された', newState.actedPieceIds.has('AU-B'));
    expectFalse('AU-C は actedPieceIds に追加されていない', newState.actedPieceIds.has('AU-C'));
  }
}

// ---------------------------------------------------------------------------
// テスト 4: グループ移動実行（3駒）
// ---------------------------------------------------------------------------
console.log('\n═══ Test 4: グループ移動実行（3駒） ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 2, 'reserve'),
    piece('AU-C', 2, 'reserve'),
  ]);
  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  const reserveMoves = movesA.filter(m => m.to.position === 'reserve' && m.to.localeId !== 2);
  expectTrue('locale2 から隣接ロケールへの悪路行軍がある', reserveMoves.length > 0);

  if (reserveMoves.length > 0) {
    const target = reserveMoves[0];
    const groupAction = {
      type: 'cross_country_march',
      pieceIds: ['AU-A', 'AU-B', 'AU-C'],
      from: { localeId: 2, position: 'reserve' },
      to: target.to,
      commandCost: 1,
    };
    const { newState } = executeAction(groupAction, state);

    expect('AU-A が目的地に移動した', newState.pieces['AU-A'].localeId, target.to.localeId);
    expect('AU-B が目的地に移動した', newState.pieces['AU-B'].localeId, target.to.localeId);
    expect('AU-C が目的地に移動した', newState.pieces['AU-C'].localeId, target.to.localeId);
    expect('CP が1消費された（3駒でも1CP）', newState.commandPoints, 9);
    expectTrue('AU-A が actedPieceIds に追加', newState.actedPieceIds.has('AU-A'));
    expectTrue('AU-B が actedPieceIds に追加', newState.actedPieceIds.has('AU-B'));
    expectTrue('AU-C が actedPieceIds に追加', newState.actedPieceIds.has('AU-C'));
  }
}

// ---------------------------------------------------------------------------
// テスト 5: バリデーション — 4駒以上は拒否
// ---------------------------------------------------------------------------
console.log('\n═══ Test 5: バリデーション — 4駒以上は拒否 ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 2, 'reserve'),
    piece('AU-C', 2, 'reserve'),
    piece('AU-D', 2, 'reserve'),
  ]);
  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  const reserveMoves = movesA.filter(m => m.to.position === 'reserve' && m.to.localeId !== 2);
  if (reserveMoves.length > 0) {
    const groupAction = {
      type: 'cross_country_march',
      pieceIds: ['AU-A', 'AU-B', 'AU-C', 'AU-D'],
      from: { localeId: 2, position: 'reserve' },
      to: reserveMoves[0].to,
      commandCost: 1,
    };
    let threw = false;
    try { executeAction(groupAction, state); } catch { threw = true; }
    expectTrue('4駒グループは例外を投げる', threw);
  }
}

// ---------------------------------------------------------------------------
// テスト 6: バリデーション — 異なるポジションの駒は拒否
// ---------------------------------------------------------------------------
console.log('\n═══ Test 6: バリデーション — 異なるポジションの駒は拒否 ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 2, 'approach_0'), // 別ポジション
  ]);
  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  const reserveMoves = movesA.filter(m => m.to.position === 'reserve' && m.to.localeId !== 2);
  if (reserveMoves.length > 0) {
    const groupAction = {
      type: 'cross_country_march',
      pieceIds: ['AU-A', 'AU-B'],
      from: { localeId: 2, position: 'reserve' },
      to: reserveMoves[0].to,
      commandCost: 1,
    };
    let threw = false;
    try { executeAction(groupAction, state); } catch { threw = true; }
    expectTrue('異なるポジションの駒グループは例外を投げる', threw);
  }
}

// ---------------------------------------------------------------------------
// テスト 7: バリデーション — 既に行動済みの駒は拒否
// ---------------------------------------------------------------------------
console.log('\n═══ Test 7: バリデーション — 既に行動済みの駒は拒否 ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 2, 'reserve'),
  ]);
  // AU-B を先に行動済みにする
  state.actedPieceIds.add('AU-B');

  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  const reserveMoves = movesA.filter(m => m.to.position === 'reserve' && m.to.localeId !== 2);
  if (reserveMoves.length > 0) {
    const groupAction = {
      type: 'cross_country_march',
      pieceIds: ['AU-A', 'AU-B'],
      from: { localeId: 2, position: 'reserve' },
      to: reserveMoves[0].to,
      commandCost: 1,
    };
    let threw = false;
    try { executeAction(groupAction, state); } catch { threw = true; }
    expectTrue('行動済みの駒を含むグループは例外を投げる', threw);
  }
}

// ---------------------------------------------------------------------------
// テスト 8: findGroupCandidates — 異なるロケールの駒は候補に含まれない
// ---------------------------------------------------------------------------
console.log('\n═══ Test 8: findGroupCandidates — 異なるロケールは候補外 ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    piece('AU-B', 3, 'reserve'), // 別のロケール
  ]);

  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  if (movesA.length > 0) {
    const candidates = findGroupCandidates(movesA[0], state);
    expectFalse('別ロケールの AU-B は候補に含まれない', candidates.includes('AU-B'));
  }
}

// ---------------------------------------------------------------------------
// テスト 9: findGroupCandidates — 混乱中の駒は候補に含まれない
// ---------------------------------------------------------------------------
console.log('\n═══ Test 9: findGroupCandidates — 混乱駒は候補外 ═══');
{
  const state = baseState([
    piece('AU-A', 2, 'reserve'),
    { ...piece('AU-B', 2, 'reserve'), disordered: true }, // 混乱中
  ]);

  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  if (movesA.length > 0) {
    const candidates = findGroupCandidates(movesA[0], state);
    expectFalse('混乱中の AU-B は候補に含まれない', candidates.includes('AU-B'));
  }
}

// ---------------------------------------------------------------------------
// テスト 10: 単体アクション（pieceId）は引き続き動作する（後退互換）
// ---------------------------------------------------------------------------
console.log('\n═══ Test 10: 後退互換 — 単体 pieceId アクションが動作する ═══');
{
  const state = baseState([piece('AU-A', 2, 'reserve')]);
  const movesA = getLegalCrossCountryMoves(state.pieces['AU-A'], state);
  const reserveMoves = movesA.filter(m => m.to.position === 'reserve' && m.to.localeId !== 2);
  if (reserveMoves.length > 0) {
    const { newState } = executeAction(reserveMoves[0], state);
    expect('単体アクション: AU-A が移動した', newState.pieces['AU-A'].localeId, reserveMoves[0].to.localeId);
    expect('単体アクション: CP が1消費', newState.commandPoints, 9);
    expectTrue('単体アクション: actedPieceIds に追加', newState.actedPieceIds.has('AU-A'));
  }
}

// ---------------------------------------------------------------------------
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
