'use strict';
/**
 * cav_obstacle_leaders.js
 * cav_obstacle がある防御側アプローチで
 * 騎兵を防御先導駒・カウンター駒に選択できないことを検証
 *
 * 実行: node tests/cav_obstacle_leaders.js
 *
 * ルール:
 *   防御側アプローチに cav_obstacle がある場合:
 *   - 防御先導駒（ASSAULT_DEF_LEADERS）に騎兵を選択不可 → フィルタで除去
 *   - カウンター駒（ASSAULT_COUNTER）に騎兵を選択不可 → フィルタで除去
 *   - 攻撃先導駒（ASSAULT_ATK_LEADERS）は選択可（ただし calculateAssaultResult でペナルティ）
 *
 * テスト用エッジ:
 *   area3(atk) edge1 → area2(def) edge3: cav_obstacle + inf_obstacle, wide
 *   ATK_LOCALE=3, ATK_EDGE=1, DEF_LOCALE=2, DEF_EDGE=3
 */

const TurnManager = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');

const ATK_LOCALE = 3;
const ATK_EDGE   = 1;
const DEF_LOCALE = 2;
const DEF_EDGE   = 3;

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

function baseState(pieces, active = 'austria') {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.activePlayer = active;
  s.controlToken = { holder: active, reason: 'active_player' };
  s.commandPoints = 6;
  return s;
}

function startAssault(state) {
  return TurnManager.executeAction({
    type: 'assault',
    pieceId: Object.values(state.pieces).find(p => p.side === 'austria').id,
    attackLocaleId:  ATK_LOCALE,
    attackEdgeIdx:   ATK_EDGE,
    defenseLocaleId: DEF_LOCALE,
    defenseEdgeIdx:  DEF_EDGE,
  }, state);
}

// ════════════════════════════════════════════════════════════════
// Test 1: 防御先導駒に騎兵を選択 → cav_obstacle でフィルタ
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 騎兵防御先導 → cav_obstacleでフィルタ → 先導なし → 攻撃側勝利 ═══');
console.log('  ATK: AU-INF-1(str=4) at approach_1 of locale3');
console.log('  DEF: FR-CAV-1(str=3) at approach_3 of locale2 → 先導提出 → フィルタされる');
console.log('  DEF_EDGE=3 に cav_obstacle → 防御先導フィルタ → defTotal=0');
console.log('  DEF_EDGE=3 に inf_obstacle → atkPenalty=-1、result=4-1-0=3 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry',  3, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  let r = startAssault(state);
  expect('突撃開始 → ASSAULT_DEF_LEADERS', r.interruption?.type, 'assault_def_leaders');

  // 防御騎兵を先導として提出
  r = TurnManager.processInterruption({ leaderIds: ['FR-CAV-1'] }, r.newState);
  expect('ASSAULT_ATK_LEADERS へ進む', r.interruption?.type, 'assault_atk_leaders');

  r = TurnManager.processInterruption({ leaderIds: ['AU-INF-1'] }, r.newState);
  if (r.interruption?.type === 'assault_def_artillery') {
    r = TurnManager.processInterruption({ fire: false }, r.newState);
  }
  r = TurnManager.processInterruption({ counterIds: [] }, r.newState);
  r = TurnManager.processInterruption({ atkApproachChoice: [] }, r.newState);

  // 騎兵先導がフィルタされ defTotal=0 → result=4-1=3 → 攻撃側勝利
  expect('防御騎兵先導フィルタ → 攻撃側勝利（retreat_destination）', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 2: 防御先導駒に歩兵を選択 → フィルタされない → 防御側勝利
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 歩兵防御先導 → フィルタされない → 防御側勝利 ═══');
console.log('  ATK: AU-INF-1(str=4) at approach_1 of locale3');
console.log('  DEF: FR-INF-1(str=4) at approach_3 of locale2 → 先導提出');
console.log('  DEF_EDGE=3 に inf_obstacle → atkPenalty=-1、result=4-1-4=-1 → 防御側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 4, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  let r = startAssault(state);
  r = TurnManager.processInterruption({ leaderIds: ['FR-INF-1'] }, r.newState);
  r = TurnManager.processInterruption({ leaderIds: ['AU-INF-1'] }, r.newState);
  if (r.interruption?.type === 'assault_def_artillery') {
    r = TurnManager.processInterruption({ fire: false }, r.newState);
  }
  r = TurnManager.processInterruption({ counterIds: [] }, r.newState);
  r = TurnManager.processInterruption({ atkApproachChoice: [] }, r.newState);

  expect('歩兵防御先導はフィルタされない → 防御側勝利（interruption=null）', r.interruption, null);
}

// ════════════════════════════════════════════════════════════════
// Test 3: カウンター駒に騎兵を選択 → cav_obstacle でフィルタ
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 騎兵カウンター → cav_obstacleでフィルタ → カウンターなし ═══');
console.log('  ATK: AU-INF-1(str=4) 先導、DEF: FR-CAV-1(str=4) をカウンターに提出');
console.log('  DEF_EDGE=3 に inf_obstacle → atkPenalty=-1');
console.log('  騎兵カウンターフィルタ → counterTotal=0');
console.log('  result = 4-1-0 = 3 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, `approach_${DEF_EDGE}`, DEF_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry',  4, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  let r = startAssault(state);
  // FR-INF-1を防御先導、FR-CAV-1をカウンターに提出
  r = TurnManager.processInterruption({ leaderIds: ['FR-INF-1'] }, r.newState);
  r = TurnManager.processInterruption({ leaderIds: ['AU-INF-1'] }, r.newState);
  if (r.interruption?.type === 'assault_def_artillery') {
    r = TurnManager.processInterruption({ fire: false }, r.newState);
  }
  r = TurnManager.processInterruption({ counterIds: ['FR-CAV-1'] }, r.newState);
  r = TurnManager.processInterruption({ atkApproachChoice: [] }, r.newState);

  // 騎兵カウンターフィルタ → counterTotal=0 → result=4-1-1=2 → 攻撃側勝利
  expect('騎兵カウンターフィルタ → 攻撃側勝利（retreat_destination）', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 4: 攻撃先導駒に騎兵を選択 → cav_obstacle はフィルタしない（ペナルティのみ）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 騎兵攻撃先導 → cav_obstacleはフィルタしない（ペナルティ付きで続行） ═══');
console.log('  ATK: AU-CAV-1(str=4) 先導');
console.log('  DEF_EDGE=3 に cav_obstacle → atkPenalty=-1（さらに inf_obstacleで-1 計-2）');
console.log('  result = 4-2-0 = 2 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 4, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, 'reserve', DEF_LOCALE),
  ]);
  let r = startAssault(state);
  r = TurnManager.processInterruption({ leaderIds: [] }, r.newState);
  // 騎兵を攻撃先導として提出（フィルタされないはず）
  r = TurnManager.processInterruption({ leaderIds: ['AU-CAV-1'] }, r.newState);
  if (r.interruption?.type === 'assault_def_artillery') {
    r = TurnManager.processInterruption({ fire: false }, r.newState);
  }
  r = TurnManager.processInterruption({ counterIds: [] }, r.newState);
  r = TurnManager.processInterruption({ atkApproachChoice: [] }, r.newState);

  // 騎兵攻撃先導がフィルタされない → ペナルティ-2 → result=4-2=2 → 攻撃側勝利
  expect('騎兵攻撃先導はフィルタされない → 攻撃側勝利（retreat_destination）', r.interruption?.type, 'retreat_destination');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
