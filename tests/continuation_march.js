'use strict';
/**
 * continuation_march.js
 * 継続行軍（Section 12）の検証
 *
 * 実行: node tests/continuation_march.js
 *
 * ルール:
 *   道路行軍または悪路行軍でリザーブに到達した騎兵は
 *   引き続き同一ロケールのアプローチへ移動できる（0 CP）
 *
 * テスト用ロケール（area3 → area2 が thick road で隣接）:
 *   area3 edge1 → area2 (thick road, cav_obstacle, wide)
 *   area2 edge0/1 → area1 (adj)
 *   area2 edge3  → area3 (adj)
 */

const TurnManager = require('../server/engine/TurnManager');
const validator   = require('../server/engine/MoveValidator');
const { createInitialState } = require('../server/engine/GameState');

const ATK_LOCALE = 3;   // 騎兵の出発地
const MID_LOCALE = 2;   // 行軍先（継続元）
const ENE_LOCALE = 1;   // 敵占拠ロケール（継続先向かい側）

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

// ════════════════════════════════════════════════════════════════
// Test 1: 悪路行軍後の継続行軍が利用可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 悪路行軍後 → 騎兵に継続行軍が表示される ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', ENE_LOCALE),
  ]);

  // 悪路行軍: locale3 → locale2 reserve
  const marchActions = validator.getLegalCrossCountryMoves(state.pieces['AU-CAV-1'], state);
  const marchTo2 = marchActions.find(a => a.to.localeId === MID_LOCALE && a.to.position === 'reserve');
  expect('悪路行軍 locale3→locale2 が合法', marchTo2 !== undefined, true);

  const { newState: afterMarch } = TurnManager.executeAction(marchTo2, state);

  expect('行軍後 locale2 reserve にいる', afterMarch.pieces['AU-CAV-1'].localeId, MID_LOCALE);
  expect('行軍後 continuationEligiblePieces に登録', afterMarch.continuationEligiblePieces?.['AU-CAV-1'] !== undefined, true);
  expect('fromLocaleId = null（悪路行軍）', afterMarch.continuationEligiblePieces['AU-CAV-1'].fromLocaleId, null);

  const contMoves = validator.getLegalActions('AU-CAV-1', afterMarch)
    .filter(a => a.type === 'continuation_march');
  expect('継続行軍アクションが1件以上存在', contMoves.length >= 1, true);
  expect('継続行軍の CP = 0', contMoves[0]?.commandCost, 0);
}

// ════════════════════════════════════════════════════════════════
// Test 2: 悪路行軍後の継続行軍を実行 → アプローチへ移動
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 悪路行軍後 → 継続行軍を実行 → アプローチへ ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', ENE_LOCALE),
  ]);

  const marchActions = validator.getLegalCrossCountryMoves(state.pieces['AU-CAV-1'], state);
  const marchTo2 = marchActions.find(a => a.to.localeId === MID_LOCALE && a.to.position === 'reserve');
  const { newState: afterMarch } = TurnManager.executeAction(marchTo2, state);

  const contMoves = validator.getLegalActions('AU-CAV-1', afterMarch)
    .filter(a => a.type === 'continuation_march');
  const contAction = contMoves[0];
  const { newState: afterCont, interruption } = TurnManager.executeAction(contAction, afterMarch);

  expect('継続行軍後インタラプションなし', interruption, null);
  expect('継続行軍後 locale2 のアプローチにいる', afterCont.pieces['AU-CAV-1'].localeId, MID_LOCALE);
  expect('継続行軍後ポジションがアプローチ', afterCont.pieces['AU-CAV-1'].position.startsWith('approach_'), true);
  expect('継続行軍後 continuationEligiblePieces から削除', afterCont.continuationEligiblePieces?.['AU-CAV-1'], undefined);
}

// ════════════════════════════════════════════════════════════════
// Test 3: 道路行軍後の継続行軍が利用可能
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 道路行軍後 → 騎兵に継続行軍が表示される ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', ENE_LOCALE),
  ]);

  // 道路行軍: locale3 → locale2 reserve（thick road）
  const roadActions = validator.getLegalRoadMoves(state.pieces['AU-CAV-1'], state);
  const roadTo2 = roadActions.find(a => a.to.localeId === MID_LOCALE && !a.raidTargetLocaleId);
  expect('道路行軍 locale3→locale2 が合法', roadTo2 !== undefined, true);

  const { newState: afterMarch } = TurnManager.executeAction(roadTo2, state);

  expect('道路行軍後 continuationEligiblePieces に登録', afterMarch.continuationEligiblePieces?.['AU-CAV-1'] !== undefined, true);
  expect('fromLocaleId = 3（出発地）', afterMarch.continuationEligiblePieces['AU-CAV-1'].fromLocaleId, ATK_LOCALE);

  const contMoves = validator.getLegalActions('AU-CAV-1', afterMarch)
    .filter(a => a.type === 'continuation_march');
  expect('道路行軍後も継続行軍アクションが存在', contMoves.length >= 1, true);
}

// ════════════════════════════════════════════════════════════════
// Test 4: 同一ロケール内の悪路行軍（アプローチへ）は継続行軍不可
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 同一ロケール内の悪路行軍後 → 継続行軍なし ═══');
{
  // locale2 reserve → locale2 approach（同一ロケール内移動）
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', MID_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', ENE_LOCALE),
  ]);

  const marchActions = validator.getLegalCrossCountryMoves(state.pieces['AU-CAV-1'], state);
  // 敵に面したアプローチへの悪路行軍（同一ロケール内）
  const sameLocaleMarch = marchActions.find(
    a => a.to.localeId === MID_LOCALE && a.to.position.startsWith('approach_')
  );
  expect('同一ロケール内悪路行軍が合法', sameLocaleMarch !== undefined, true);

  const { newState: afterMarch } = TurnManager.executeAction(sameLocaleMarch, state);

  expect('同一ロケール行軍後 continuationEligiblePieces に登録されない',
    afterMarch.continuationEligiblePieces?.['AU-CAV-1'], undefined);
}

// ════════════════════════════════════════════════════════════════
// Test 5: 歩兵は悪路行軍後も継続行軍なし
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 歩兵の悪路行軍後 → 継続行軍なし ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', ENE_LOCALE),
  ]);

  const marchActions = validator.getLegalCrossCountryMoves(state.pieces['AU-INF-1'], state);
  const marchTo2 = marchActions.find(a => a.to.localeId === MID_LOCALE && a.to.position === 'reserve');
  expect('歩兵の悪路行軍 locale3→locale2 が合法', marchTo2 !== undefined, true);

  const { newState: afterMarch } = TurnManager.executeAction(marchTo2, state);

  expect('歩兵行軍後 continuationEligiblePieces に登録されない',
    afterMarch.continuationEligiblePieces?.['AU-INF-1'], undefined);

  const contMoves = validator.getLegalActions('AU-INF-1', afterMarch)
    .filter(a => a.type === 'continuation_march');
  expect('歩兵には継続行軍アクションなし', contMoves.length, 0);
}

// ════════════════════════════════════════════════════════════════
// Test 6: ターン開始時に continuationEligiblePieces がリセット
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: ターン終了→開始時に継続資格がリセット ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry', 3, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', ENE_LOCALE),
  ]);

  const marchActions = validator.getLegalCrossCountryMoves(state.pieces['AU-CAV-1'], state);
  const marchTo2 = marchActions.find(a => a.to.localeId === MID_LOCALE && a.to.position === 'reserve');
  const { newState: afterMarch } = TurnManager.executeAction(marchTo2, state);
  expect('行軍後 eligible に登録', afterMarch.continuationEligiblePieces?.['AU-CAV-1'] !== undefined, true);

  // ターン終了（Austria → France → Austria）
  const { newState: afterTurnEnd } = TurnManager.executeAction({ type: 'end_turn' }, afterMarch);
  const { newState: afterFranceTurn } = TurnManager.executeAction({ type: 'end_turn' }, afterTurnEnd);

  expect('ターン開始後 continuationEligiblePieces がリセット',
    afterFranceTurn.continuationEligiblePieces?.['AU-CAV-1'], undefined);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
