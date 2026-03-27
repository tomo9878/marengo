'use strict';
/**
 * raid_cavalry_obstacle.js
 * チェックリスト #4: 急襲の騎兵障害物チェック（攻撃側に歩兵必須）
 *
 * 実行: node tests/raid_cavalry_obstacle.js
 *
 * ルール: 防御アプローチに cav_obstacle がある場合、
 *         攻撃側駒が歩兵でなければ急襲できない（騎兵・砲兵は不可）
 */

const { getLegalRaids } = require('../server/engine/MoveValidator');
const { createInitialState } = require('../server/engine/GameState');

// 騎兵障害物があるアプローチを手動で設定するために
// マップを直接操作するのではなく、getApproachSymbols が返す値を制御する。
// ここでは: DEF_LOCALE=5、DEF_EDGE=4 に cav_obstacle を設定したと仮定し、
// map.hasCavalryObstacle をモック。
// ただし、実際のマップデータでは cav_obstacle は設定されていないため、
// 直接 map.json を操作してテストするか、内部テストで検証する。
//
// ここでは: MoveValidator の checkTarget のロジックを
// "cav_obstacle 付きのアプローチ" を持つ状態で直接テストする。
// map.hasCavalryObstacle(localeIdx, edgeIdx) は MapGraph から呼ばれるので
// テスト用に edge の symbols を設定したマップデータが必要。
//
// 代替アプローチ: map.json の特定エッジに symbols: ['cav_obstacle'] を設定して
// テストするか、or MapGraph をモックする。
//
// ここでは: MapGraph モジュールをモックして
// 特定のアプローチに cav_obstacle があるようにシミュレートする。

// ─── マップグラフのモック ────────────────────────────────────────

const MapGraph = require('../server/engine/MapGraph');

const ATK_LOCALE = 3;
const ATK_EDGE   = 2;
const DEF_LOCALE = 5;
const DEF_EDGE   = 4;

// 元の hasCavalryObstacle を保存
const originalHasCavalryObstacle = MapGraph.hasCavalryObstacle;

function withCavObstacle(fn) {
  // DEF_LOCALE/DEF_EDGE に cav_obstacle があるようにモック
  MapGraph.hasCavalryObstacle = (localeIdx, edgeIdx) => {
    if (localeIdx === DEF_LOCALE && edgeIdx === DEF_EDGE) return true;
    return originalHasCavalryObstacle(localeIdx, edgeIdx);
  };
  try {
    fn();
  } finally {
    MapGraph.hasCavalryObstacle = originalHasCavalryObstacle;
  }
}

// ─── ヘルパー ────────────────────────────────────────────────────

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
  s.activePlayer  = 'austria';
  s.controlToken  = { holder: 'austria', reason: 'active_player' };
  s.commandPoints = 3;
  return s;
}

// ════════════════════════════════════════════════════════════════
// テスト 1: cav_obstacle なし → 騎兵も急襲可能（通常ケース）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: cav_obstacle なし → 騎兵も急襲可能 ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const raids = getLegalRaids(state.pieces['AU-CAV-1'], state);
  const toDefLocale = raids.filter(a => a.targetLocaleId === DEF_LOCALE);
  expect('cav_obstacle なし: 騎兵が DEF_LOCALE へ急襲できる',
    toDefLocale.length > 0, true);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: cav_obstacle あり → 騎兵は急襲不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: cav_obstacle あり → 騎兵は急襲不可 ═══');
withCavObstacle(() => {
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const raids = getLegalRaids(state.pieces['AU-CAV-1'], state);
  const toDefLocale = raids.filter(a => a.targetLocaleId === DEF_LOCALE);
  expect('cav_obstacle あり: 騎兵の急襲は DEF_LOCALE から除外される',
    toDefLocale.length, 0);
});

// ════════════════════════════════════════════════════════════════
// テスト 3: cav_obstacle あり → 歩兵は急襲可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: cav_obstacle あり → 歩兵は急襲可能 ═══');
withCavObstacle(() => {
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const raids = getLegalRaids(state.pieces['AU-INF-1'], state);
  const toDefLocale = raids.filter(a => a.targetLocaleId === DEF_LOCALE);
  expect('cav_obstacle あり: 歩兵は DEF_LOCALE へ急襲できる',
    toDefLocale.length > 0, true);
});

// ════════════════════════════════════════════════════════════════
// テスト 4: cav_obstacle あり → 砲兵は急襲不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: cav_obstacle あり → 砲兵は急襲不可 ═══');
withCavObstacle(() => {
  const state = baseState([
    piece('AU-ART-1', 'austria', 'artillery', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const raids = getLegalRaids(state.pieces['AU-ART-1'], state);
  const toDefLocale = raids.filter(a => a.targetLocaleId === DEF_LOCALE);
  expect('cav_obstacle あり: 砲兵の急襲は DEF_LOCALE から除外される',
    toDefLocale.length, 0);
});

// ════════════════════════════════════════════════════════════════
// テスト 5: cav_obstacle あり → アプローチにいる騎兵は急襲不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: cav_obstacle あり → アプローチ上の騎兵は急襲不可 ═══');
withCavObstacle(() => {
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const raids = getLegalRaids(state.pieces['AU-CAV-1'], state);
  expect('cav_obstacle あり: アプローチの騎兵は急襲不可',
    raids.filter(a => a.targetLocaleId === DEF_LOCALE).length, 0);
});

// ════════════════════════════════════════════════════════════════
// テスト 6: cav_obstacle あり → アプローチにいる歩兵は急襲可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: cav_obstacle あり → アプローチ上の歩兵は急襲可能 ═══');
withCavObstacle(() => {
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);
  const raids = getLegalRaids(state.pieces['AU-INF-1'], state);
  expect('cav_obstacle あり: アプローチの歩兵は急襲可能',
    raids.filter(a => a.targetLocaleId === DEF_LOCALE).length > 0, true);
});

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
