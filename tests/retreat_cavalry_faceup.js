'use strict';
/**
 * retreat_cavalry_faceup.js
 * 退却時の騎兵 faceUp 表示テスト
 *
 * 実行: node tests/retreat_cavalry_faceup.js
 *
 * 仕様:
 *  - リザーブの騎兵が退却する場合、退却先到着時に faceUp=true にする
 *  - アプローチにいた騎兵は対象外（リザーブのみ）
 *  - 歩兵・砲兵は対象外（騎兵のみ）
 *  - 次のアクション開始時に faceUp=false にリセットされる
 *  - 砲撃宣言中の砲兵は _clearTransientFaceUp でリセットされない
 *
 * マップ:
 *  ATK_LOCALE=3 → DEF_LOCALE=5: DEF_EDGE=4, narrow
 *  退却先: locale3（攻撃側ロケールへ）
 */

const TurnManager = require('../server/engine/TurnManager');
const combat = require('../server/engine/CombatResolver');
const { createInitialState, INTERRUPTION, cloneState } = require('../server/engine/GameState');
const map = require('../server/engine/MapGraph');

const ATK_LOCALE  = 3;
const DEF_LOCALE  = 5;
const DEF_EDGE    = 4;

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
    localeId: locale, position: pos, actedThisTurn: false,
  };
}

function baseState(pieces, opts = {}) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.round         = opts.round  ?? 2;
  s.activePlayer  = opts.active ?? 'austria';
  s.controlToken  = { holder: s.activePlayer, reason: 'active_player' };
  s.commandPoints = opts.cp ?? 6;
  s.morale.austria.uncommitted = 5;
  s.morale.france.uncommitted  = 5;
  s.morale.austria.total = 12;
  s.morale.france.total  = 12;
  s.moraleTokens = [];
  return s;
}

/** 急襲を開始し防御応答なしで解決する（攻撃側勝利） */
function raidAndResolve(state, atkId, defLocale, defEdge) {
  let r = TurnManager.executeAction({
    type: 'raid', pieceId: atkId,
    fromLocaleId: state.pieces[atkId].localeId, fromPosition: 'reserve',
    targetLocaleId: defLocale, defenseEdgeIdx: defEdge, commandCost: 3,
  }, state);
  // 防御応答なし
  r = TurnManager.processInterruption({ pieceIds: [] }, r.newState);
  return r;
}

// ════════════════════════════════════════════════════════════════════════════
// Test 1: リザーブの騎兵が退却 → faceUp=true
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: リザーブの騎兵退却 → faceUp=true ═══');
{
  const pieces = [
    piece('AU-INF-1',  'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-CAV-1',  'france',  'cavalry',  2, 'reserve', DEF_LOCALE),
  ];
  let state = baseState(pieces);

  // 急襲（攻撃側勝利）→ RETREAT_DESTINATION
  let r = raidAndResolve(state, 'AU-INF-1', DEF_LOCALE, DEF_EDGE);
  expect('Test1: RETREAT_DESTINATION 生成', r.interruption?.type, INTERRUPTION.RETREAT_DESTINATION);

  // 退却先を選択
  const validDests = combat.getValidRetreatDestinations('FR-CAV-1', DEF_LOCALE, { attackLocaleId: ATK_LOCALE }, r.newState);
  const dest = validDests[0];
  r = TurnManager.processInterruption({
    destinations: { 'FR-CAV-1': dest },
  }, r.newState);

  // 騎兵は退却先で faceUp=true
  expect('Test1: FR-CAV-1 退却後 faceUp=true',
    r.newState.pieces['FR-CAV-1'].faceUp, true);
  expect('Test1: FR-CAV-1 退却先に移動済み',
    r.newState.pieces['FR-CAV-1'].localeId, dest);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 2: 歩兵が退却 → faceUp は変わらない（false のまま）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 歩兵退却 → faceUp=false のまま ═══');
{
  const pieces = [
    piece('AU-INF-1',  'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1',  'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ];
  let state = baseState(pieces);

  let r = raidAndResolve(state, 'AU-INF-1', DEF_LOCALE, DEF_EDGE);
  const validDests = combat.getValidRetreatDestinations('FR-CAV-1', DEF_LOCALE, { attackLocaleId: ATK_LOCALE }, r.newState);
  const dest = validDests[0];
  r = TurnManager.processInterruption({
    destinations: { 'FR-INF-1': dest },
  }, r.newState);

  expect('Test2: FR-INF-1 退却後 faceUp=false（歩兵は対象外）',
    r.newState.pieces['FR-INF-1'].faceUp, false);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 3: アプローチにいた騎兵が退却 → faceUp は変わらない
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: アプローチの騎兵退却 → faceUp=false のまま ═══');
{
  const pieces = [
    piece('AU-INF-1',  'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-CAV-1',  'france',  'cavalry',  2, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ];
  let state = baseState(pieces);

  // resolveRetreat を直接呼んでアプローチ駒の退却をテスト
  let testState = cloneState(state);
  // FR-CAV-1 を位置変更してリザーブに移さずアプローチのまま退却
  const result = combat.resolveRetreat({
    losingLocaleId: DEF_LOCALE,
    attackInfo: {},
    reductionChoices: [],
    destinations: { 'FR-CAV-1': ATK_LOCALE },
  }, testState);

  expect('Test3: アプローチの騎兵退却は faceUp=false（対象外）',
    result.newState.pieces['FR-CAV-1'].faceUp, false);
  expect('Test3: revealedCavalryIds は空',
    result.revealedCavalryIds.length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 4: faceUp=true のリセット — 次の executeAction 呼び出し時
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 次のアクション開始時に faceUp リセット ═══');
{
  const pieces = [
    piece('AU-INF-1',  'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('AU-INF-2',  'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-CAV-1',  'france',  'cavalry',  2, 'reserve', DEF_LOCALE),
  ];
  let state = baseState(pieces, { cp: 9 });

  // 急襲 → 退却処理（FR-CAV-1 faceUp=true の状態）
  let r = raidAndResolve(state, 'AU-INF-1', DEF_LOCALE, DEF_EDGE);
  const validDests = combat.getValidRetreatDestinations('FR-CAV-1', DEF_LOCALE, { attackLocaleId: ATK_LOCALE }, r.newState);
  const dest = validDests[0];
  r = TurnManager.processInterruption({
    destinations: { 'FR-CAV-1': dest },
  }, r.newState);

  expect('Test4前: FR-CAV-1 は faceUp=true',
    r.newState.pieces['FR-CAV-1'].faceUp, true);

  // 次のアクション（AU-INF-2 で行軍）を実行
  r = TurnManager.executeAction({
    type: 'cross_country_march', pieceIds: ['AU-INF-2'],
    from: { localeId: ATK_LOCALE, position: 'reserve' },
    to:   { localeId: ATK_LOCALE, position: 'reserve' }, // 同ロケール（テスト用）
    commandCost: 1,
  }, r.newState);

  // executeAction の先頭で _clearTransientFaceUp が走り faceUp=false になる
  expect('Test4後: FR-CAV-1 は faceUp=false（リセット済み）',
    r.newState.pieces['FR-CAV-1'].faceUp, false);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 5: 砲撃宣言中の砲兵は _clearTransientFaceUp でリセットされない
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 砲撃宣言中の砲兵は faceUp を維持 ═══');
{
  // 砲撃宣言 → 砲兵 faceUp=true → 次のアクションでもリセットされないことを確認
  const WIDE_ATK = 8;
  const WIDE_DEF = 9;
  const ART_EDGE = 1; // locale8 から locale9 へのエッジ

  const pieces = [
    piece('AU-ART-1',  'austria', 'artillery', 2, `approach_${ART_EDGE}`, WIDE_ATK),
    piece('AU-INF-1',  'austria', 'infantry',  2, 'reserve', WIDE_ATK),
    piece('FR-INF-1',  'france',  'infantry',  2, 'reserve', WIDE_DEF),
  ];
  let state = baseState(pieces, { cp: 6 });

  // 砲撃宣言
  let r = TurnManager.executeAction({
    type: 'bombardment_declare',
    pieceId: 'AU-ART-1',
    targetLocaleId: WIDE_DEF,
    fromEdgeIdx: ART_EDGE,
    commandCost: 0,
  }, state);

  expect('Test5: 砲兵宣言後 faceUp=true', r.newState.pieces['AU-ART-1'].faceUp, true);

  // 別の駒でアクション → _clearTransientFaceUp が走るが砲兵は除外
  r = TurnManager.executeAction({
    type: 'cross_country_march', pieceIds: ['AU-INF-1'],
    from: { localeId: WIDE_ATK, position: 'reserve' },
    to:   { localeId: WIDE_ATK, position: 'reserve' },
    commandCost: 1,
  }, r.newState);

  expect('Test5: 砲兵は次のアクション後も faceUp=true のまま',
    r.newState.pieces['AU-ART-1'].faceUp, true);
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
