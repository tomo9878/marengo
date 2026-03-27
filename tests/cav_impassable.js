'use strict';
/**
 * cav_impassable.js
 * cav_impassableシンボルの挙動を検証するテスト
 *
 * 実行: node tests/cav_impassable.js
 *
 * ルール:
 *   防御側アプローチに cav_impassable シンボルがある場合：
 *   - 急襲（raid）: 攻撃駒が騎兵の場合は急襲不可（歩兵は可）
 *   - 突撃（assault）: 騎兵を攻撃先導駒・防御先導駒・カウンター駒に選択不可
 *
 * テスト用エッジ:
 *   locale5 → locale12, 防御辺 e12-2: symbols=[inf_obstacle, cav_impassable]
 *   locale19 → locale12, 防御辺 e12-1: symbols=[inf_obstacle, cav_impassable]
 *
 * 急襲テスト: locale5 → locale12 (e12-2 は cav_impassable のみ、cav_obstacle なし)
 * 突撃テスト: locale19 → locale12 (e12-1)
 */

const TurnManager   = require('../server/engine/TurnManager');
const validator     = require('../server/engine/MoveValidator');
const { createInitialState } = require('../server/engine/GameState');

// 急襲: locale5 → locale12 via e12-2 (cav_impassable, no cav_obstacle on defense side)
const RAID_ATK_LOCALE = 5;
const RAID_DEF_LOCALE = 12;
const RAID_DEF_EDGE   = 2;   // e12-2 on locale12 side

// 突撃: locale19 → locale12 via e12-1 (cav_impassable + inf_obstacle)
const ASL_ATK_LOCALE = 19;
const ASL_ATK_EDGE   = 4;   // e19-4 (locale19 side)
const ASL_DEF_LOCALE = 12;
const ASL_DEF_EDGE   = 1;   // e12-1

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
// Test 1: 騎兵急襲 → cav_impassable で除外
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 騎兵急襲 → cav_impassable で除外 ═══');
console.log('  AU-CAV-1 in locale5 reserve → locale12 は cav_impassable → 急襲不可');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', RAID_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', RAID_DEF_LOCALE),
  ]);
  const cav = state.pieces['AU-CAV-1'];
  const raids = validator.getLegalRaids(cav, state);
  const raidToLocale12 = raids.filter(r => r.targetLocaleId === RAID_DEF_LOCALE);
  expect('騎兵はlocale12への急襲なし（cav_impassable）', raidToLocale12.length, 0);
}

// ════════════════════════════════════════════════════════════════
// Test 2: 歩兵急襲 → cav_impassable の影響なし → 急襲可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 歩兵急襲 → cav_impassable の影響なし ═══');
console.log('  AU-INF-1 in locale5 reserve → locale12 (e12-2: cav_impassable only, no cav_obstacle) → 急襲可');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', RAID_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', RAID_DEF_LOCALE),
  ]);
  const inf = state.pieces['AU-INF-1'];
  const raids = validator.getLegalRaids(inf, state);
  const raidToLocale12 = raids.filter(r => r.targetLocaleId === RAID_DEF_LOCALE);
  expect('歩兵はlocale12への急襲あり（cav_impassableの影響なし）', raidToLocale12.length >= 1, true);
}

// ════════════════════════════════════════════════════════════════
// Test 3: 突撃 - 騎兵を攻撃先導駒に選択 → サイレントフィルタ → 先導なし扱い
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 騎兵攻撃先導 → cav_impassableでフィルタ → 先導なし → 防御側勝利 ═══');
console.log('  AU-CAV-1(str=4) を先導に提出するが e12-1 の cav_impassable でフィルタ');
console.log('  先導なし: atkTotal=0 → result=0-0=0 → 防御側勝利');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 4, `approach_${ASL_ATK_EDGE}`, ASL_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, 'reserve', ASL_DEF_LOCALE),
  ]);
  const r = runAssault(state, ASL_ATK_LOCALE, ASL_ATK_EDGE, ASL_DEF_LOCALE, ASL_DEF_EDGE, {
    defLeaders: [], atkLeaders: ['AU-CAV-1'], counter: [],
  });
  // フィルタにより atkLeaderIds=[] → atkTotal=0 → result=0 → 防御側勝利
  expect('騎兵先導フィルタ → 防御側勝利（interruption なし）', r.interruption, null);
}

// ════════════════════════════════════════════════════════════════
// Test 4: 突撃 - 歩兵を攻撃先導駒に選択 → cav_impassableの影響なし → 攻撃側勝利
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 歩兵攻撃先導 → cav_impassableの影響なし → 攻撃側勝利 ═══');
console.log('  AU-INF-1(str=4) 先導、e12-1: inf_obstacle×1 → -1');
console.log('  result = 4 - 1(地形) - 0 = 3 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${ASL_ATK_EDGE}`, ASL_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, 'reserve', ASL_DEF_LOCALE),
  ]);
  const r = runAssault(state, ASL_ATK_LOCALE, ASL_ATK_EDGE, ASL_DEF_LOCALE, ASL_DEF_EDGE, {
    defLeaders: [], atkLeaders: ['AU-INF-1'], counter: [],
  });
  expect('歩兵先導 → 攻撃側勝利（retreat_destination）', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 5: 突撃 - 騎兵を防御先導駒に選択 → サイレントフィルタ → 先導なし扱い
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 騎兵防御先導 → cav_impassableでフィルタ → 防御先導なし ═══');
console.log('  FR-CAV-1(str=3) を防御先導に提出するが cav_impassable でフィルタ');
console.log('  result = 4 - 1(地形) - 0(防御先導フィルタ) = 3 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${ASL_ATK_EDGE}`, ASL_ATK_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry', 3, `approach_${ASL_DEF_EDGE}`, ASL_DEF_LOCALE),
  ]);
  const r = runAssault(state, ASL_ATK_LOCALE, ASL_ATK_EDGE, ASL_DEF_LOCALE, ASL_DEF_EDGE, {
    defLeaders: ['FR-CAV-1'], atkLeaders: ['AU-INF-1'], counter: [],
  });
  // 防御先導フィルタ → defTotal=0 → result=4-1=3 → 攻撃側勝利
  expect('防御騎兵先導フィルタ → 攻撃側勝利（retreat_destination）', r.interruption?.type, 'retreat_destination');
}

// ════════════════════════════════════════════════════════════════
// Test 6: 突撃 - 騎兵をカウンター駒に選択 → サイレントフィルタ → カウンターなし扱い
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: 騎兵カウンター → cav_impassableでフィルタ → カウンターなし ═══');
console.log('  AU-INF-1(str=3) 先導（-1地形=-2合計1）、FR-CAV-1 カウンター提出→フィルタ');
console.log('  フィルタなし: result = 3-1-3(CAV) = -1 → 防御勝ち');
console.log('  フィルタあり: result = 3-1-0 = 2 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${ASL_ATK_EDGE}`, ASL_ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, `approach_${ASL_DEF_EDGE}`, ASL_DEF_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry',  3, `approach_${ASL_DEF_EDGE}`, ASL_DEF_LOCALE),
  ]);
  const r = runAssault(state, ASL_ATK_LOCALE, ASL_ATK_EDGE, ASL_DEF_LOCALE, ASL_DEF_EDGE, {
    defLeaders: ['FR-INF-1'], atkLeaders: ['AU-INF-1'],
    counter: ['FR-CAV-1'],  // 騎兵カウンター → フィルタされるはず
  });
  // カウンターフィルタ → counterTotal=0 → result=3-1-1=1 → 攻撃側勝利
  expect('騎兵カウンターフィルタ → 攻撃側勝利（retreat_destination）', r.interruption?.type, 'retreat_destination');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
