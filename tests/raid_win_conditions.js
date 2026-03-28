'use strict';
/**
 * raid_win_conditions.js
 * 急襲の新勝利条件テスト
 *
 * 実行: node tests/raid_win_conditions.js
 *
 * ─── テスト一覧 ───────────────────────────────────────────────────────────────
 *  Test 1: 広いアプローチ + 1攻撃駒 + 1防御応答 → 部分ブロック → 防御側勝利（最初の急襲）
 *  Test 2: 広いアプローチ + 1攻撃駒 + 1防御応答 → 部分ブロック → 攻撃側勝利（2回目の急襲）
 *  Test 3: アプローチから攻撃 → DEFENSE_RESPONSE なし → 即時解決（防御なし→攻撃側勝利）
 *  Test 4: アプローチから攻撃 → 防御駒が既にアプローチ → 即時解決（完全ブロック→防御側勝利）
 *  Test 5: 部分ブロック防御側勝利 → ATTACKER_APPROACH インタラプション生成
 *  Test 6: 部分ブロック防御側勝利 → 士気投入1個（2攻撃駒でも wide の partial block は1）
 *
 * ─── マップ参考 ──────────────────────────────────────────────────────────────
 *  ATK_LOCALE=8  → DEF_LOCALE=9: locale9 edge4 = wide（WIDE_EDGE=4）
 *    locale8 edge1 ↔ locale9 edge4
 *  ATK_LOCALE=3  → DEF_LOCALE=5: DEF_EDGE=4, narrow
 */

const TurnManager = require('../server/engine/TurnManager');
const { createInitialState, INTERRUPTION } = require('../server/engine/GameState');

// ─── マップ定数 ──────────────────────────────────────────────────────────────
const WIDE_ATK  = 8;
const WIDE_DEF  = 9;
const WIDE_EDGE = 4;   // locale9 edge4 = wide
const ATK_EDGE  = 1;   // locale8 の locale9 側エッジ

const NARROW_ATK  = 3;
const NARROW_DEF  = 5;
const NARROW_EDGE = 4;

// ─── ヘルパー ─────────────────────────────────────────────────────────────────
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
  s.round         = opts.round  ?? 2;  // round > 1 so France can respond (round-1 restriction)
  s.activePlayer  = opts.active ?? 'austria';
  s.controlToken  = { holder: s.activePlayer, reason: 'active_player' };
  s.commandPoints = opts.cp ?? 9;
  s.morale.austria.uncommitted = opts.auUncomm ?? 5;
  s.morale.france.uncommitted  = opts.frUncomm ?? 5;
  s.morale.austria.total = 12;
  s.morale.france.total  = 12;
  s.moraleTokens = [];
  return s;
}

// ════════════════════════════════════════════════════════════════════════════
// Test 1: 広いアプローチ + 1攻撃駒 + 1防御応答 → 部分ブロック → 防御側勝利（最初の急襲）
// ════════════════════════════════════════════════════════════════════════════
// wide アプローチは完全ブロックに2駒必要。1駒応答 = 部分ブロック。
// 1攻撃駒 + 最初の急襲 → 防御側勝利ルール適用
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 広いアプローチ 部分ブロック → 防御側勝利（最初の急襲） ═══');
{
  const pieces = [
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', WIDE_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', WIDE_DEF),
  ];
  let state = baseState(pieces);

  // 急襲開始（リザーブから）
  let r = TurnManager.executeAction({
    type: 'raid', pieceId: 'AU-INF-1',
    fromLocaleId: WIDE_ATK, fromPosition: 'reserve',
    targetLocaleId: WIDE_DEF, defenseEdgeIdx: WIDE_EDGE, commandCost: 3,
  }, state);

  expect('Test1: DEFENSE_RESPONSE 生成', r.interruption?.type, INTERRUPTION.DEFENSE_RESPONSE);
  expect('Test1: 防御側が応答を待つ', r.interruption?.waitingFor, 'france');
  expect('Test1: availableDefenders に FR-INF-1 あり',
    r.interruption?.context?.availableDefenders?.includes('FR-INF-1'), true);

  // 防御側: 1駒応答（部分ブロック）
  r = TurnManager.processInterruption({ pieceIds: ['FR-INF-1'] }, r.newState);

  // 部分ブロック + 1攻撃駒 + 最初の急襲 → 防御側勝利
  // ATTACKER_APPROACH インタラプション生成を期待
  expect('Test1: 防御側勝利 → ATTACKER_APPROACH 生成',
    r.interruption?.type, INTERRUPTION.ATTACKER_APPROACH);
  expect('Test1: FR-INF-1 はアプローチ位置のまま',
    r.newState.pieces['FR-INF-1'].position, `approach_${WIDE_EDGE}`);
  // オーストリア攻撃駒はリザーブのまま（防御側勝利なのでターゲットに入らない）
  expect('Test1: AU-INF-1 は WIDE_ATK のリザーブのまま',
    r.newState.pieces['AU-INF-1'].localeId, WIDE_ATK);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 2: 同じアプローチへの2回目の急襲 → 部分ブロックでも攻撃側勝利
// ════════════════════════════════════════════════════════════════════════════
// raidHistoryThisTurn に事前登録して「2回目」を再現。
// 防御駒はアプローチにいない（クリーンな状態）ので、1駒応答でも partial block のまま。
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 広いアプローチ 部分ブロック → 攻撃側勝利（2回目の急襲） ═══');
{
  const pieces = [
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', WIDE_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', WIDE_DEF),
  ];
  let state = baseState(pieces);
  // 同じアプローチへの2回目の急襲を再現（raidHistory に事前登録）
  state.raidHistoryThisTurn = [{ localeId: WIDE_DEF, edgeIdx: WIDE_EDGE }];

  expect('2回目前: raidHistoryThisTurn に記録あり', state.raidHistoryThisTurn.length, 1);

  // 2回目の急襲（isFirstRaidThroughApproach = false）
  let r = TurnManager.executeAction({
    type: 'raid', pieceId: 'AU-INF-1',
    fromLocaleId: WIDE_ATK, fromPosition: 'reserve',
    targetLocaleId: WIDE_DEF, defenseEdgeIdx: WIDE_EDGE, commandCost: 3,
  }, state);
  expect('Test2: DEFENSE_RESPONSE 生成', r.interruption?.type, INTERRUPTION.DEFENSE_RESPONSE);

  // 防御側: 1駒応答（部分ブロック、しかし2回目）
  r = TurnManager.processInterruption({ pieceIds: ['FR-INF-1'] }, r.newState);

  // 部分ブロック + 2回目 → 攻撃側勝利 → RETREAT_DESTINATION
  expect('Test2: 攻撃側勝利 → RETREAT_DESTINATION 生成',
    r.interruption?.type, INTERRUPTION.RETREAT_DESTINATION);
  expect('Test2: 退却待ち = france', r.interruption?.waitingFor, 'france');
  // 攻撃側駒がターゲットロケールへ移動済み
  expect('Test2: AU-INF-1 が WIDE_DEF に移動',
    r.newState.pieces['AU-INF-1'].localeId, WIDE_DEF);
  expect('Test2: AU-INF-1 のポジションはリザーブ',
    r.newState.pieces['AU-INF-1'].position, 'reserve');
}

// ════════════════════════════════════════════════════════════════════════════
// Test 3: アプローチから攻撃 → DEFENSE_RESPONSE なし → 即時解決
// ════════════════════════════════════════════════════════════════════════════
// 攻撃駒が locale8 の approach_1 に配置（locale9 方向を向いている）
// 防御駒なし → 攻撃側勝利
console.log('\n═══ Test 3: アプローチから攻撃 → DEFENSE_RESPONSE なし ═══');
{
  const pieces = [
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, WIDE_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', WIDE_DEF),
  ];
  let state = baseState(pieces);

  const r = TurnManager.executeAction({
    type: 'raid', pieceId: 'AU-INF-1',
    fromLocaleId: WIDE_ATK, fromPosition: `approach_${ATK_EDGE}`,
    targetLocaleId: WIDE_DEF, defenseEdgeIdx: WIDE_EDGE, commandCost: 3,
  }, state);

  // DEFENSE_RESPONSE が発生せず即時 RETREAT_DESTINATION（防御なし = 攻撃側勝利）
  expect('Test3: DEFENSE_RESPONSE なし（即時解決）',
    r.interruption?.type !== INTERRUPTION.DEFENSE_RESPONSE, true);
  expect('Test3: RETREAT_DESTINATION 生成',
    r.interruption?.type, INTERRUPTION.RETREAT_DESTINATION);
  expect('Test3: 退却待ち = france', r.interruption?.waitingFor, 'france');
  // 攻撃側駒がターゲットへ移動済み
  expect('Test3: AU-INF-1 が WIDE_DEF に移動',
    r.newState.pieces['AU-INF-1'].localeId, WIDE_DEF);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 4: アプローチから攻撃 → 防御駒が既にアプローチ → 即時解決（完全ブロック）
// ════════════════════════════════════════════════════════════════════════════
// narrow アプローチ（1駒で完全ブロック）で、防御駒が既にアプローチに配置済み
// → DEFENSE_RESPONSE なし → 防御側勝利（完全ブロック）
console.log('\n═══ Test 4: アプローチから攻撃 → 既存防御駒でブロック（防御側勝利） ═══');
{
  const pieces = [
    piece('AU-INF-1', 'austria', 'infantry', 2, 'approach_2', NARROW_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, `approach_${NARROW_EDGE}`, NARROW_DEF),
  ];
  let state = baseState(pieces);

  const r = TurnManager.executeAction({
    type: 'raid', pieceId: 'AU-INF-1',
    fromLocaleId: NARROW_ATK, fromPosition: 'approach_2',
    targetLocaleId: NARROW_DEF, defenseEdgeIdx: NARROW_EDGE, commandCost: 3,
  }, state);

  // DEFENSE_RESPONSE が発生しない（アプローチから攻撃）
  expect('Test4: DEFENSE_RESPONSE なし', r.interruption?.type !== INTERRUPTION.DEFENSE_RESPONSE, true);
  // 防御側勝利 → ATTACKER_APPROACH（アプローチから攻撃の場合は ATTACKER_APPROACH も不要）
  // attackFromApproach=true → _applyRaidOutcome returns immediately without ATTACKER_APPROACH
  expect('Test4: 防御側勝利かつアプローチ攻撃 → インタラプションなし',
    r.interruption, null);
  // AU-INF-1 は元のロケールのまま（ターゲットに入れない）
  expect('Test4: AU-INF-1 は NARROW_ATK のまま',
    r.newState.pieces['AU-INF-1'].localeId, NARROW_ATK);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 5: 部分ブロック防御側勝利 → 士気投入1個（partial block は常に1）
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 部分ブロック防御側勝利 → 士気投入1個 ═══');
{
  const pieces = [
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', WIDE_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', WIDE_DEF),
  ];
  let state = baseState(pieces, { frUncomm: 5 });
  const frBefore = state.morale.france.uncommitted;

  let r = TurnManager.executeAction({
    type: 'raid', pieceId: 'AU-INF-1',
    fromLocaleId: WIDE_ATK, fromPosition: 'reserve',
    targetLocaleId: WIDE_DEF, defenseEdgeIdx: WIDE_EDGE, commandCost: 3,
  }, state);
  r = TurnManager.processInterruption({ pieceIds: ['FR-INF-1'] }, r.newState);

  // 部分ブロック: moraleInvestment=1（wide AND multiple attackers が両方満たされていないため）
  // isWide && multipleAttackers && isFirstRaid → 2個, それ以外 → 1個
  // ここでは attackerPieceIds.length=1 なので multipleAttackers=false → 1個
  expect('Test5: フランス uncommitted が 1 減少',
    r.newState.morale.france.uncommitted, frBefore - 1);
  expect('Test5: locale9 に france トークン1個',
    r.newState.moraleTokens.filter(t => t.side === 'france' && t.localeId === WIDE_DEF).length, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 6: 部分ブロック後の ATTACKER_APPROACH → 攻撃駒がアプローチへ移動
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: ATTACKER_APPROACH → 攻撃駒がアプローチへ移動 ═══');
{
  const pieces = [
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', WIDE_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', WIDE_DEF),
  ];
  let state = baseState(pieces);

  let r = TurnManager.executeAction({
    type: 'raid', pieceId: 'AU-INF-1',
    fromLocaleId: WIDE_ATK, fromPosition: 'reserve',
    targetLocaleId: WIDE_DEF, defenseEdgeIdx: WIDE_EDGE, commandCost: 3,
  }, state);
  r = TurnManager.processInterruption({ pieceIds: ['FR-INF-1'] }, r.newState);

  expect('Test6: ATTACKER_APPROACH 生成', r.interruption?.type, INTERRUPTION.ATTACKER_APPROACH);
  expect('Test6: 攻撃側が応答', r.interruption?.waitingFor, 'austria');

  const atkCtx = r.interruption?.context;
  expect('Test6: context に attackerPieceIds あり', atkCtx?.attackerPieceIds?.includes('AU-INF-1'), true);

  // 攻撃側がアプローチへ移動することを選択
  const approachEdge = atkCtx?.attackEdgeIdx;
  r = TurnManager.processInterruption({ pieceIds: ['AU-INF-1'] }, r.newState);

  expect('Test6: インタラプションなし（解決済み）', r.interruption, null);
  expect('Test6: AU-INF-1 はアプローチへ移動',
    r.newState.pieces['AU-INF-1'].position, `approach_${approachEdge}`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
