'use strict';
/**
 * road_march_raid.js
 * 道路行軍急襲（セクション8）の検証
 *
 * 実行: node tests/road_march_raid.js
 *
 * ルール:
 *   騎兵のみ、道路行軍中に敵占拠ロケールへ急襲できる。
 *   急襲CPは消費しない（道路行軍CPのみ）。
 *   勝利 → 駒を敵ロケールへ移動、faceUp=true、actedPieceIds未追加（継続行軍可）
 *   敗北 → 駒は元ロケールに留まる、faceUp=true、actedPieceIds追加（行軍終了）
 *   同一横断は1ターン1回まで道路行軍急襲に使用可能。
 *
 * テスト用エッジ:
 *   locale2 → locale4、防御辺 e4-3（thick road、inf_obstacleのみ）
 *   locale4 → locale5、防御辺 e5-0（thick road、inf_obstacleのみ）
 */

const TurnManager  = require('../server/engine/TurnManager');
const validator    = require('../server/engine/MoveValidator');
const { createInitialState, PIECE_TYPES } = require('../server/engine/GameState');

// locale2 -> locale4: canonicalId='e2-2', defenseEdge=3
const ATK_LOCALE    = 2;
const DEF_LOCALE    = 4;
const DEF_EDGE      = 3;   // e4-3 on locale4 side

// locale4 -> locale5: for continuation test
const DEF2_LOCALE   = 5;

let passed = 0;
let failed = 0;

function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

function piece(id, side, type, str, pos, locale) {
  return { id, side, type, strength: str, maxStrength: str,
    disordered: false, faceUp: false, localeId: locale,
    position: pos, actedThisTurn: false };
}

function baseState(pieces, activePlayer = 'austria') {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.activePlayer = activePlayer;
  s.controlToken = { holder: activePlayer, reason: 'active_player' };
  s.commandPoints = 6;
  return s;
}

// ════════════════════════════════════════════════════════════════
// Test 1: 騎兵の道路行軍アクションに raidTargetLocaleId が含まれる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 騎兵はroadMarchに急襲オプションが生成される ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const cav = state.pieces['AU-CAV-1'];
  const moves = validator.getLegalRoadMoves(cav, state);
  const raidMoves = moves.filter(m => m.raidTargetLocaleId === DEF_LOCALE);
  expect('騎兵は locale4 への道路行軍急襲アクションを持つ', raidMoves.length >= 1, true);
  if (raidMoves.length > 0) {
    expect('raidDefenseEdgeIdx が正しい', raidMoves[0].raidDefenseEdgeIdx, DEF_EDGE);
    expect('raidCrossingId が設定されている', typeof raidMoves[0].raidCrossingId, 'string');
    expect('CPコストは道路行軍分のみ（0 or 1）', raidMoves[0].commandCost <= 1, true);
  }
}

// ════════════════════════════════════════════════════════════════
// Test 2: 歩兵は道路行軍急襲アクションを持たない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 歩兵は道路行軍急襲を生成しない ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const inf = state.pieces['AU-INF-1'];
  const moves = validator.getLegalRoadMoves(inf, state);
  const raidMoves = moves.filter(m => m.raidTargetLocaleId === DEF_LOCALE);
  expect('歩兵は locale4 への道路行軍急襲なし', raidMoves.length, 0);
}

// ════════════════════════════════════════════════════════════════
// Helper: 道路行軍急襲を実行し、防御応答後に解決する
// ════════════════════════════════════════════════════════════════
function runMarchRaid(state, atkLocale, defLocale, defEdge, defResponseIds = []) {
  const cav = Object.values(state.pieces).find(p => p.side === 'austria' && p.type === 'cavalry');
  const moves = validator.getLegalRoadMoves(cav, state);
  const raidAction = moves.find(m => m.raidTargetLocaleId === defLocale);
  if (!raidAction) throw new Error('Road march raid action not found');

  // 道路行軍急襲を開始
  let r = TurnManager.executeAction(raidAction, state);

  // 防御応答
  r = TurnManager.processInterruption({ pieceIds: defResponseIds }, r.newState);
  return r;
}

// ════════════════════════════════════════════════════════════════
// Test 3: 急襲勝利 → 騎兵がlocale4へ移動、faceUp=true
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 道路行軍急襲 勝利 → 騎兵がlocale4へ移動 ═══');
console.log('  AU-CAV(str=3) vs FR-INF(reserve, no response) → ブロックなし → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  // 防御応答なし → ブロックなし → 攻撃側勝利
  const r = runMarchRaid(state, ATK_LOCALE, DEF_LOCALE, DEF_EDGE, []);
  // 攻撃側勝利 → 退却インタラプションが発生
  expect('勝利 → retreat_destination interruption', r.interruption?.type, 'retreat_destination');
  const cav = r.newState.pieces['AU-CAV-1'];
  expect('騎兵がlocale4へ移動', cav.localeId, DEF_LOCALE);
  expect('騎兵がfaceUp=true', cav.faceUp, true);
  expect('actedPieceIdsに追加されていない（継続行軍可能）',
    r.newState.actedPieceIds.has('AU-CAV-1'), false);
}

// ════════════════════════════════════════════════════════════════
// Test 4: 急襲敗北 → 騎兵はATK_LOCALEに留まる、faceUp=true、actedPieceIds追加
// 使用エッジ: locale4 → locale5（narrow approach e5-0、1体でブロック可能）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 道路行軍急襲 敗北 → 騎兵は元ロケールに留まる ═══');
console.log('  AU-CAV(loc=4) → loc5(narrow e5-0) FR-INF-1応答 → 1体でブロック → 防御側勝利');
{
  const LOSS_ATK = 4;
  const LOSS_DEF = 5;
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', LOSS_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', LOSS_DEF),
  ]);
  const r = runMarchRaid(state, LOSS_ATK, LOSS_DEF, 0 /* e5-0 */, ['FR-INF-1']);
  expect('敗北 → interruption なし（ブロック成功）', r.interruption, null);
  const cav = r.newState.pieces['AU-CAV-1'];
  expect('騎兵はLOSS_ATKに留まる', cav.localeId, LOSS_ATK);
  expect('騎兵がfaceUp=true', cav.faceUp, true);
  expect('actedPieceIdsに追加される（行軍終了）',
    r.newState.actedPieceIds.has('AU-CAV-1'), true);
}

// ════════════════════════════════════════════════════════════════
// Test 5: 急襲勝利後に継続行軍が可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 急襲勝利後の継続行軍 ═══');
console.log('  勝利後、騎兵はlocale4からlocale5への道路行軍が可能');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const r = runMarchRaid(state, ATK_LOCALE, DEF_LOCALE, DEF_EDGE, []);
  // 退却処理（防御側を退却させる）
  const retreatState = r.newState;
  // FR-INF-1が退却する
  const validDests = Object.values(retreatState.pieces)
    .filter(p => p.localeId === DEF_LOCALE && p.side === 'france' && p.strength > 0);
  // 退却先を自動選択して処理を進める
  const destinations = {};
  for (const p of validDests) destinations[p.id] = ATK_LOCALE; // locale2へ退却
  const r2 = TurnManager.processInterruption({ destinations }, retreatState);

  // 勝利後の状態で継続行軍チェック
  const cav = r2.newState.pieces['AU-CAV-1'];
  expect('騎兵はlocale4にいる', cav.localeId, DEF_LOCALE);
  const continuationMoves = validator.getLegalRoadMoves(cav, r2.newState);
  expect('継続行軍アクションが存在する（actedPieceIds未追加）',
    continuationMoves.length > 0, true);
}

// ════════════════════════════════════════════════════════════════
// Test 6: 同一横断を2回目の道路行軍急襲に使用不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: 同一横断の道路行軍急襲は1ターン1回まで ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
    piece('AU-CAV-2', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
  ]);
  // AU-CAV-1が同横断を使用済みとしてマーク
  const cav1moves = validator.getLegalRoadMoves(state.pieces['AU-CAV-1'], state);
  const raidMove = cav1moves.find(m => m.raidTargetLocaleId === DEF_LOCALE);
  const stateAfterFirst = { ...state,
    roadMarchRaidCrossings: [...(state.roadMarchRaidCrossings ?? []), raidMove.raidCrossingId]
  };

  // AU-CAV-2が同じ横断を使おうとすると除外される
  const cav2moves = validator.getLegalRoadMoves(stateAfterFirst.pieces['AU-CAV-2'], stateAfterFirst);
  const blockedRaids = cav2moves.filter(m => m.raidTargetLocaleId === DEF_LOCALE);
  expect('同一横断は2回目使用不可（急襲アクションなし）', blockedRaids.length, 0);
}

// ════════════════════════════════════════════════════════════════
// Test 7: 歩兵占拠ロケールへの道路行軍は生成されない（通常のスキップ確認）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 7: 歩兵は敵ロケールへの道路行軍アクションを持たない ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const inf = state.pieces['AU-INF-1'];
  const moves = validator.getLegalRoadMoves(inf, state);
  const toEnemyLocale = moves.filter(m => m.to?.localeId === DEF_LOCALE);
  expect('歩兵は敵ロケールへの通常/急襲行軍なし', toEnemyLocale.length, 0);
}

// ════════════════════════════════════════════════════════════════
// Test 8: CPは道路行軍分のみ消費（急襲CP3は消費しない）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 8: 道路行軍急襲はCP3を消費しない ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const initialCP = state.commandPoints; // 6
  const cav = state.pieces['AU-CAV-1'];
  const moves = validator.getLegalRoadMoves(cav, state);
  const raidAction = moves.find(m => m.raidTargetLocaleId === DEF_LOCALE);

  let r = TurnManager.executeAction(raidAction, state);
  // 防御応答前の状態でCPチェック
  const cpAfterMarch = r.newState.commandPoints;
  const expectedCP = initialCP - raidAction.commandCost; // 道路行軍分のみ消費
  expect(`CP消費は道路行軍分のみ（${initialCP} - ${raidAction.commandCost} = ${expectedCP})`,
    cpAfterMarch, expectedCP);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
