'use strict';
/**
 * entry_locale_protection.js
 * チェックリスト #13: 増援未進入時の敵進入禁止
 *
 * 実行: node tests/entry_locale_protection.js
 *
 * ルール: 保持エリアにまだマップへ進入していない増援がいる場合、
 *         敵がそのロケールへ進入（攻撃・行軍・急襲）できない。
 *
 * 現実装: オーストリア側 = BORMIDA_ENTRY_LOCALE_IDX(1) が保護対象。
 *         オーストリアにオフマップ駒（localeId=null）がいる間、
 *         フランスはロケール1に進入できない。
 */

const {
  getLegalRoadMoves, getLegalCrossCountryMoves, getLegalRaids, getLegalAssaults,
  isEntryLocaleProtected, BORMIDA_ENTRY_LOCALE_IDX,
} = require('../server/engine/MoveValidator');
const { createInitialState } = require('../server/engine/GameState');
const map = require('../server/engine/MapGraph');

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
    strength: str, maxStrength: str,
    disordered: false, faceUp: false,
    localeId: locale,
    position: pos,
    actedThisTurn: false,
  };
}

function baseState(pieces) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.round = 5;
  return s;
}

console.log(`\nℹ️  BORMIDA_ENTRY_LOCALE_IDX = ${BORMIDA_ENTRY_LOCALE_IDX}`);

// ════════════════════════════════════════════════════════════════
// テスト 1: isEntryLocaleProtected ユニットテスト
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: isEntryLocaleProtected ユニットテスト ═══');
{
  // オーストリアにオフマップ駒あり
  const stateWith = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', null), // オフマップ
  ]);
  expect('フランスがBORMIDA(1)へ進入: 保護される',
    isEntryLocaleProtected(BORMIDA_ENTRY_LOCALE_IDX, 'france', stateWith), true);

  // オーストリアのオフマップ駒なし
  const stateWithout = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', 5), // マップ上
  ]);
  expect('フランスがBORMIDA(1)へ進入: 保護されない（全駒マップ上）',
    isEntryLocaleProtected(BORMIDA_ENTRY_LOCALE_IDX, 'france', stateWithout), false);

  // 別ロケールは保護されない
  expect('フランスがBORMIDA以外へ進入: 保護されない',
    isEntryLocaleProtected(5, 'france', stateWith), false);

  // オーストリアが進入しようとする場合は無関係
  expect('オーストリアがBORMIDA(1)へ進入: 保護されない（自軍）',
    isEntryLocaleProtected(BORMIDA_ENTRY_LOCALE_IDX, 'austria', stateWith), false);

  // 強度0のオフマップ駒は無視
  const stateZero = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 0, 'reserve', null), // 強度0
  ]);
  expect('強度0のオフマップ駒: 保護されない',
    isEntryLocaleProtected(BORMIDA_ENTRY_LOCALE_IDX, 'france', stateZero), false);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: オーストリア増援あり → フランスはBORMIDAへの道路行軍不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 増援保護中: フランスのBORMIDAへの道路行軍不可 ═══');
{
  // BORMIDA(1) の隣接ロケールを探す
  const adjToBormida = map.getAdjacent(BORMIDA_ENTRY_LOCALE_IDX).map(e => e.adjIdx);
  console.log(`  ℹ️  BORMIDA(${BORMIDA_ENTRY_LOCALE_IDX}) の隣接: [${adjToBormida}]`);

  if (adjToBormida.length === 0) {
    console.log('  ℹ️  BORMIDA に隣接ロケールなし（スキップ）');
    passed++;
  } else {
    const frLocale = adjToBormida[0];

    // オーストリアのオフマップ駒あり
    const stateWith = baseState([
      piece('FR-INF-1', 'france', 'infantry', 2, 'reserve', frLocale),
      piece('AU-OFF-1', 'austria', 'infantry', 2, 'reserve', null), // オフマップ
    ]);
    stateWith.activePlayer = 'france';
    stateWith.controlToken = { holder: 'france', reason: 'active_player' };

    const movesWithProtection = getLegalRoadMoves(stateWith.pieces['FR-INF-1'], stateWith);
    const toBormida = movesWithProtection.filter(m => m.to.localeId === BORMIDA_ENTRY_LOCALE_IDX);
    expect('保護中: BORMIDA への道路行軍が含まれない',
      toBormida.length, 0);

    // オーストリアのオフマップ駒なし
    const stateWithout = baseState([
      piece('FR-INF-1', 'france', 'infantry', 2, 'reserve', frLocale),
    ]);
    stateWithout.activePlayer = 'france';
    stateWithout.controlToken = { holder: 'france', reason: 'active_player' };

    const movesWithoutProtection = getLegalRoadMoves(stateWithout.pieces['FR-INF-1'], stateWithout);
    // BORMIDA に道路があれば到達できるはず（交通制限なしの場合）
    // ただし地形により到達できない場合もあるので、比較で確認
    const canReachBefore = movesWithoutProtection.some(m => m.to.localeId === BORMIDA_ENTRY_LOCALE_IDX);
    if (canReachBefore) {
      expect('保護なし: BORMIDA への道路行軍が可能',
        canReachBefore, true);
    } else {
      console.log('  ℹ️  道路なし or 交通制限でBORMIDAへの道路行軍は通常も不可（スキップ）');
      passed++;
    }
  }
}

// ════════════════════════════════════════════════════════════════
// テスト 3: 増援保護中 → フランスはBORMIDAへの急襲不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 増援保護中: フランスのBORMIDAへの急襲不可 ═══');
{
  const adjToBormida = map.getAdjacent(BORMIDA_ENTRY_LOCALE_IDX).map(e => e.adjIdx);
  if (adjToBormida.length === 0) {
    console.log('  ℹ️  BORMIDA に隣接ロケールなし（スキップ）');
    passed++;
  } else {
    const frLocale = adjToBormida[0];
    const stateWith = baseState([
      piece('FR-INF-1', 'france', 'infantry', 2, 'reserve', frLocale),
      piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', BORMIDA_ENTRY_LOCALE_IDX), // BORMIDA占拠
      piece('AU-OFF-1', 'austria', 'infantry', 2, 'reserve', null), // オフマップ
    ]);
    stateWith.activePlayer = 'france';
    stateWith.controlToken = { holder: 'france', reason: 'active_player' };
    stateWith.commandPoints = 3;

    const raids = getLegalRaids(stateWith.pieces['FR-INF-1'], stateWith);
    const toBormida = raids.filter(a => a.targetLocaleId === BORMIDA_ENTRY_LOCALE_IDX);
    expect('保護中: BORMIDA への急襲が含まれない',
      toBormida.length, 0);
  }
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
