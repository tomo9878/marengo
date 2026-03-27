'use strict';
/**
 * france_round1_no_block.js
 * チェックリスト #5: フランス軍の混乱（6:00AMラウンド）
 *
 * 実行: node tests/france_round1_no_block.js
 *
 * ルール: ラウンド1のみ、フランス軍はいかなる場合もアプローチをブロックできない。
 *   - 悪路行軍/防御行軍でのアプローチ移動不可
 *   - 急襲の DEFENSE_RESPONSE でのブロック不可（availableDefenders = []）
 *   - ラウンド2以降は通常通り可能
 */

const TurnManager = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');
const { getLegalCrossCountryMoves, canFranceBlock } = require('../server/engine/MoveValidator');

const ATK_LOCALE = 3;
const ATK_EDGE   = 2;
const DEF_LOCALE = 5;
const DEF_EDGE   = 4;

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

function piece(id, side, type, str, pos, locale, disordered = false) {
  return {
    id, side, type,
    strength: str, maxStrength: str,
    disordered, faceUp: false,
    localeId: locale,
    position: pos,
    actedThisTurn: false,
  };
}

function baseState(pieces, round = 1) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.activePlayer  = 'austria';
  s.controlToken  = { holder: 'austria', reason: 'active_player' };
  s.commandPoints = 3;
  s.round = round;
  return s;
}

// ════════════════════════════════════════════════════════════════
// テスト 1: canFranceBlock - ラウンド1は false、ラウンド2以降は true
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: canFranceBlock ユニットテスト ═══');
{
  expect('ラウンド1: canFranceBlock = false', canFranceBlock({ round: 1 }), false);
  expect('ラウンド2: canFranceBlock = true',  canFranceBlock({ round: 2 }), true);
  expect('ラウンド8: canFranceBlock = true',  canFranceBlock({ round: 8 }), true);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: ラウンド1 → フランス駒はアプローチへの悪路行軍が不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: ラウンド1 → フランス駒のアプローチへの行軍不可 ═══');
{
  // フランス駒（非混乱）がラウンド1にアプローチへ移動しようとする
  const state = baseState([
    piece('FR-INF-1', 'france', 'infantry', 2, 'reserve', DEF_LOCALE, false), // 非混乱
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
  ], 1);
  state.activePlayer  = 'france';
  state.controlToken  = { holder: 'france', reason: 'active_player' };

  const moves = getLegalCrossCountryMoves(state.pieces['FR-INF-1'], state);
  const approachMoves = moves.filter(m => m.to.position.startsWith('approach_'));
  expect('ラウンド1: フランス非混乱駒のアプローチ移動は不可',
    approachMoves.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: ラウンド2以降 → フランス非混乱駒はアプローチへ移動可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: ラウンド2 → フランス非混乱駒のアプローチ移動可能 ═══');
{
  const state = baseState([
    piece('FR-INF-1', 'france', 'infantry', 2, 'reserve', DEF_LOCALE, false),
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
  ], 2);
  state.activePlayer  = 'france';
  state.controlToken  = { holder: 'france', reason: 'active_player' };

  const moves = getLegalCrossCountryMoves(state.pieces['FR-INF-1'], state);
  const approachMoves = moves.filter(m => m.to.position.startsWith('approach_'));
  expect('ラウンド2: フランス非混乱駒のアプローチ移動は可能',
    approachMoves.length > 0, true);
}

// ════════════════════════════════════════════════════════════════
// テスト 4: ラウンド1 → 急襲の DEFENSE_RESPONSE で availableDefenders = []
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: ラウンド1 → 急襲に対してフランスは防御応答不可 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE, true), // 混乱
    piece('FR-INF-2', 'france',  'infantry', 2, 'reserve', DEF_LOCALE, false), // 非混乱でも
  ], 1);

  const r = TurnManager.executeAction({
    type:           'raid',
    pieceId:        'AU-INF-1',
    fromLocaleId:   ATK_LOCALE,
    fromPosition:   'reserve',
    targetLocaleId: DEF_LOCALE,
    defenseEdgeIdx: DEF_EDGE,
    commandCost:    3,
  }, state);

  expect('ラウンド1急襲: DEFENSE_RESPONSE の availableDefenders が空',
    r.newState.pendingInterruption?.context?.availableDefenders, []);
}

// ════════════════════════════════════════════════════════════════
// テスト 5: ラウンド2 → 急襲に対してフランスは防御応答可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: ラウンド2 → 急襲に対してフランスは防御応答可能 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE, false),
  ], 2);

  const r = TurnManager.executeAction({
    type:           'raid',
    pieceId:        'AU-INF-1',
    fromLocaleId:   ATK_LOCALE,
    fromPosition:   'reserve',
    targetLocaleId: DEF_LOCALE,
    defenseEdgeIdx: DEF_EDGE,
    commandCost:    3,
  }, state);

  expect('ラウンド2急襲: DEFENSE_RESPONSE の availableDefenders に FR-INF-1 が含まれる',
    r.newState.pendingInterruption?.context?.availableDefenders?.includes('FR-INF-1'), true);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
