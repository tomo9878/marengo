'use strict';
/**
 * obstacle_penalty.js
 * 障害物ペナルティ（inf_obstacle / cav_obstacle）の検証
 *
 * 実行: node tests/obstacle_penalty.js
 *
 * ルール:
 *   防御側アプローチのシンボルと攻撃側先導駒の兵種が一致するごとに
 *   攻撃側合計戦力から -1 される。
 *   inf_obstacle → 先導駒に歩兵がいれば一致
 *   cav_obstacle → 先導駒に騎兵がいれば一致
 */

const TurnManager = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');

// e5-4: inf_obstacle×1 (既存マップデータ)
// e3-3: cav_obstacle×2 + inf_obstacle×2 (既存マップデータ)
const INF1_ATK_LOCALE = 3;  // locale3 → locale5
const INF1_ATK_EDGE   = 2;
const INF1_DEF_LOCALE = 5;  // e5-4: inf_obstacle×1
const INF1_DEF_EDGE   = 4;

// locale4 → locale3 で e3-3 を使う
// e3-3: cav_obstacle×2 + inf_obstacle×2
const MULTI_ATK_LOCALE = 4;
const MULTI_ATK_EDGE   = 3;  // locale4側 → locale3
const MULTI_DEF_LOCALE = 3;
const MULTI_DEF_EDGE   = 3;  // e3-3

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

function runAssault(state, atkLocale, atkEdge, defLocale, defEdge, responses) {
  let r = TurnManager.executeAction({
    type: 'assault',
    pieceId: Object.values(state.pieces).find(p => p.side === 'austria').id,
    attackLocaleId: atkLocale, attackEdgeIdx: atkEdge,
    defenseLocaleId: defLocale, defenseEdgeIdx: defEdge,
  }, state);
  r = TurnManager.processInterruption({ leaderIds: responses.defLeaders }, r.newState);
  r = TurnManager.processInterruption({ leaderIds: responses.atkLeaders }, r.newState);
  if (r.interruption?.type === 'assault_def_artillery') {
    r = TurnManager.processInterruption({ fire: false }, r.newState);
  }
  r = TurnManager.processInterruption({ counterIds: responses.counter ?? [] }, r.newState);
  r = TurnManager.processInterruption({ atkApproachChoice: responses.atkApproachChoice ?? [] }, r.newState);
  return r;
}

// ════════════════════════════════════════════════════════════════
// Test 1: inf_obstacle×1、歩兵先導 → -1
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: inf_obstacle×1、歩兵先導 → atkPenalties=1 ═══');
console.log('  e5-4: inf_obstacle×1');
console.log('  AU-INF(str=3) vs FR-INF(str=2): result = 3-1-2 = 0 → 防御側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${INF1_ATK_EDGE}`, INF1_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, `approach_${INF1_DEF_EDGE}`, INF1_DEF_LOCALE),
  ]);
  const r = runAssault(state, INF1_ATK_LOCALE, INF1_ATK_EDGE, INF1_DEF_LOCALE, INF1_DEF_EDGE, {
    defLeaders: ['FR-INF-1'], atkLeaders: ['AU-INF-1'], counter: [],
  });
  expect('ペナルティ適用で防御側勝利（interruption なし）', r.interruption, null);
}

// ════════════════════════════════════════════════════════════════
// Test 2: inf_obstacle×1、歩兵先導 str=4 → result=1 → 攻撃側勝利
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: inf_obstacle×1、歩兵先導str=4 → atkPenalties=1、攻撃側勝利 ═══');
console.log('  result = 4 - 1(地形) - 2 = 1 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${INF1_ATK_EDGE}`, INF1_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, `approach_${INF1_DEF_EDGE}`, INF1_DEF_LOCALE),
  ]);
  const r = runAssault(state, INF1_ATK_LOCALE, INF1_ATK_EDGE, INF1_DEF_LOCALE, INF1_DEF_EDGE, {
    defLeaders: ['FR-INF-1'], atkLeaders: ['AU-INF-1'], counter: [],
  });
  expect('攻撃側勝利 → retreat_destination', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 3: inf_obstacle×1、騎兵先導 → ペナルティなし（兵種不一致）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: inf_obstacle×1、騎兵先導 → ペナルティなし ═══');
console.log('  result = 3 - 0(地形不一致) - 2 = 1 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, `approach_${INF1_ATK_EDGE}`, INF1_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, `approach_${INF1_DEF_EDGE}`, INF1_DEF_LOCALE),
  ]);
  const r = runAssault(state, INF1_ATK_LOCALE, INF1_ATK_EDGE, INF1_DEF_LOCALE, INF1_DEF_EDGE, {
    defLeaders: ['FR-INF-1'], atkLeaders: ['AU-CAV-1'], counter: [],
  });
  expect('騎兵先導はinf_obstacleペナルティなし → 攻撃側勝利', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 4: cav_obstacle×2 + inf_obstacle×2、騎兵先導 → -2
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: e3-3(cav×2+inf×2)、騎兵先導str=4 vs 防御なし → result=4-2=2 ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 4, `approach_${MULTI_ATK_EDGE}`, MULTI_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', MULTI_DEF_LOCALE),
  ]);
  const r = runAssault(state, MULTI_ATK_LOCALE, MULTI_ATK_EDGE, MULTI_DEF_LOCALE, MULTI_DEF_EDGE, {
    defLeaders: [], atkLeaders: ['AU-CAV-1'], counter: [],
  });
  expect('cav_obstacle×2、騎兵先導 → -2、攻撃側勝利', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 5: cav_obstacle×2 + inf_obstacle×2、歩兵先導 → -2
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: e3-3(cav×2+inf×2)、歩兵先導str=4 vs 防御なし → result=4-2=2 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${MULTI_ATK_EDGE}`, MULTI_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', MULTI_DEF_LOCALE),
  ]);
  const r = runAssault(state, MULTI_ATK_LOCALE, MULTI_ATK_EDGE, MULTI_DEF_LOCALE, MULTI_DEF_EDGE, {
    defLeaders: [], atkLeaders: ['AU-INF-1'], counter: [],
  });
  expect('inf_obstacle×2、歩兵先導 → -2、攻撃側勝利', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 6: cav_obstacle×2 + inf_obstacle×2、歩兵先導str=2 → result=0 → 防御側勝利
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: e3-3(cav×2+inf×2)、歩兵先導str=2 vs 防御なし → result=0 → 防御側勝利 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${MULTI_ATK_EDGE}`, MULTI_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', MULTI_DEF_LOCALE),
  ]);
  const r = runAssault(state, MULTI_ATK_LOCALE, MULTI_ATK_EDGE, MULTI_DEF_LOCALE, MULTI_DEF_EDGE, {
    defLeaders: [], atkLeaders: ['AU-INF-1'], counter: [],
  });
  expect('inf_obstacle×2でstr=2が相殺 → 防御側勝利（interruption なし）', r.interruption, null);
}

// ════════════════════════════════════════════════════════════════
// Test 7: 先導駒なし → ペナルティなし
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 7: 先導駒なし → ペナルティ計算なし ═══');
{
  // 先導駒を選ばない場合 atkLeaderIds=[] なので hasInfLeader=false, hasCavLeader=false
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${INF1_ATK_EDGE}`, INF1_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, 'reserve', INF1_DEF_LOCALE),
  ]);
  const r = runAssault(state, INF1_ATK_LOCALE, INF1_ATK_EDGE, INF1_DEF_LOCALE, INF1_DEF_EDGE, {
    defLeaders: [], atkLeaders: [], counter: [],
  });
  // 先導駒なし: result = 0 - 0 - 0 - 0 = 0 → 防御側勝利
  expect('先導駒なしでもペナルティなし（0-0=0 → 防御側勝利）', r.interruption, null);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
