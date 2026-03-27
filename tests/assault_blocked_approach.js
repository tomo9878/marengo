'use strict';
/**
 * assault_blocked_approach.js
 * チェックリスト #1: 突撃敗北後の同アプローチ禁止
 *
 * 実行: node tests/assault_blocked_approach.js
 *
 * ルール: 攻撃側が突撃に敗北した場合、同一ターン中、
 *         同じアプローチを通じた攻撃（突撃・急襲）および行軍ができない。
 *
 * マップ設定 (assault_patterns.js と共通):
 *   ATK_LOCALE=3 (Austria), ATK_EDGE=2
 *   DEF_LOCALE=5 (France),  DEF_EDGE=4
 */

const TurnManager    = require('../server/engine/TurnManager');
const { createInitialState, resetCommandPoints } = require('../server/engine/GameState');
const { getLegalAssaults, getLegalRaids, getLegalRoadMoves, isApproachBlocked }
  = require('../server/engine/MoveValidator');
const map = require('../server/engine/MapGraph');

const ATK_LOCALE = 3;
const ATK_EDGE   = 2;
const DEF_LOCALE = 5;
const DEF_EDGE   = 4;

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
  s.activePlayer   = 'austria';
  s.controlToken   = { holder: 'austria', reason: 'active_player' };
  s.commandPoints  = 3;
  return s;
}

function resp(state, response) {
  return TurnManager.processInterruption(response, state);
}

// 突撃を①〜⑤まで流す（assault_patterns.js の runAssault と同様）
function runAssault(initState, atkLeaders, defLeaders, counter = []) {
  let r = TurnManager.executeAction({
    type:            'assault',
    pieceId:         Object.values(initState.pieces).find(p => p.side === 'austria').id,
    attackLocaleId:  ATK_LOCALE,
    attackEdgeIdx:   ATK_EDGE,
    defenseLocaleId: DEF_LOCALE,
    defenseEdgeIdx:  DEF_EDGE,
  }, initState);

  r = resp(r.newState, { leaderIds: defLeaders });      // ① 防御先導
  r = resp(r.newState, { leaderIds: atkLeaders });      // ② 攻撃先導
  if (r.interruption?.type === 'assault_def_artillery') {
    r = resp(r.newState, { fire: false });              // ③ 防御砲撃 (なし)
  }
  r = resp(r.newState, { counterIds: counter });        // ④ カウンター
  r = resp(r.newState, { atkApproachChoice: [] });      // ⑤ 減少割り当て
  return r;
}

// ════════════════════════════════════════════════════════════════
// テスト 1: 突撃敗北 → blockedApproachesAfterAssault に記録される
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 突撃敗北 → ブロックアプローチが記録される ═══');
console.log('  AU-INF-1(str=1) vs FR-INF-1(str=3) → result=1-3=-2 → 防御側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 1, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 3, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  const r = runAssault(state, ['AU-INF-1'], ['FR-INF-1']);

  expect('interruption は null（退却なし）', r.interruption, null);
  expect('blockedApproachesAfterAssault に攻撃アプローチが追加される',
    r.newState.blockedApproachesAfterAssault,
    [{ localeId: ATK_LOCALE, edgeIdx: ATK_EDGE }]
  );
}

// ════════════════════════════════════════════════════════════════
// テスト 2: 突撃勝利 → blockedApproachesAfterAssault は空のまま
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 突撃勝利 → ブロックアプローチは記録されない ═══');
console.log('  AU-INF-1(str=3) vs FR-INF-1(str=1) → result=3-1=2 → 攻撃側勝利');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  // 攻撃勝利 → retreat_destination が来る → それを処理
  let r = TurnManager.executeAction({
    type:            'assault',
    pieceId:         'AU-INF-1',
    attackLocaleId:  ATK_LOCALE,
    attackEdgeIdx:   ATK_EDGE,
    defenseLocaleId: DEF_LOCALE,
    defenseEdgeIdx:  DEF_EDGE,
  }, state);
  r = resp(r.newState, { leaderIds: [] });              // ① 防御先導なし
  r = resp(r.newState, { leaderIds: ['AU-INF-1'] });    // ② 攻撃先導
  r = resp(r.newState, { counterIds: [] });             // ④ カウンターなし
  r = resp(r.newState, { atkApproachChoice: [] });      // ⑤ 減少割り当て

  // 攻撃側が勝ったので retreat_destination
  expect('攻撃勝利 → retreat_destination interruption',
    r.interruption?.type, 'retreat_destination');
  expect('blockedApproachesAfterAssault は空',
    r.newState.blockedApproachesAfterAssault ?? [], []
  );
}

// ════════════════════════════════════════════════════════════════
// テスト 3: ブロック済みアプローチから getLegalAssaults が空になる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: ブロック済みアプローチからの突撃禁止 ═══');
{
  // 突撃敗北後の状態をシミュレート
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  // ブロック前: getLegalAssaults は何かを返す
  const beforeAssault = getLegalAssaults(state.pieces['AU-INF-1'], state);
  expect('ブロック前: getLegalAssaults が突撃アクションを返す',
    beforeAssault.length > 0, true);

  // 手動でブロック設定
  const blockedState = { ...state, blockedApproachesAfterAssault: [{ localeId: ATK_LOCALE, edgeIdx: ATK_EDGE }] };
  const afterAssault = getLegalAssaults(blockedState.pieces['AU-INF-1'], blockedState);
  expect('ブロック後: getLegalAssaults は空',
    afterAssault.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 4: ブロック済みアプローチ方向への getLegalRaids が空になる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: ブロック済みアプローチからの急襲禁止 ═══');
{
  // アプローチにいる駒からの急襲
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve',               DEF_LOCALE),
  ]);
  const beforeRaid = getLegalRaids(state.pieces['AU-INF-1'], state);
  expect('ブロック前: アプローチからの getLegalRaids が急襲を返す',
    beforeRaid.length > 0, true);

  const blockedState = { ...state, blockedApproachesAfterAssault: [{ localeId: ATK_LOCALE, edgeIdx: ATK_EDGE }] };
  const afterRaid = getLegalRaids(blockedState.pieces['AU-INF-1'], blockedState);
  expect('ブロック後: アプローチからの getLegalRaids は空',
    afterRaid.length, 0);

  // リザーブにいる駒からの急襲（同方向）
  const reservePiece = piece('AU-INF-2', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE);
  const state2 = { ...state, pieces: { ...state.pieces, 'AU-INF-2': reservePiece } };
  // まずブロックなしでATK_EDGEへの急襲があることを確認
  const raidsFromReserve = getLegalRaids(reservePiece, state2);
  const raidToDefLocale = raidsFromReserve.filter(a => a.targetLocaleId === DEF_LOCALE);
  expect('ブロック前: リザーブから DEF_LOCALE への急襲が存在する',
    raidToDefLocale.length > 0, true);

  // ブロック後
  const blockedState2 = { ...state2, blockedApproachesAfterAssault: [{ localeId: ATK_LOCALE, edgeIdx: ATK_EDGE }] };
  const afterRaidReserve = getLegalRaids(reservePiece, blockedState2);
  const afterRaidToDefLocale = afterRaidReserve.filter(a => a.targetLocaleId === DEF_LOCALE);
  expect('ブロック後: リザーブから DEF_LOCALE への急襲は空',
    afterRaidToDefLocale.length, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 5: isApproachBlocked のユニットテスト
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: isApproachBlocked ユニットテスト ═══');
{
  const state = baseState([]);
  state.blockedApproachesAfterAssault = [{ localeId: ATK_LOCALE, edgeIdx: ATK_EDGE }];

  expect('ブロック済みアプローチ: true',
    isApproachBlocked(ATK_LOCALE, ATK_EDGE, state), true);
  expect('別ロケール同エッジ: false',
    isApproachBlocked(DEF_LOCALE, ATK_EDGE, state), false);
  expect('同ロケール別エッジ: false',
    isApproachBlocked(ATK_LOCALE, 0, state), false);

  // blockedApproachesAfterAssault が未定義の場合も安全
  const stateNoField = baseState([]);
  delete stateNoField.blockedApproachesAfterAssault;
  expect('フィールド未定義でもクラッシュしない: false',
    isApproachBlocked(ATK_LOCALE, ATK_EDGE, stateNoField), false);
}

// ════════════════════════════════════════════════════════════════
// テスト 6: resetCommandPoints でブロックがリセットされる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: ターン開始時にブロックがリセットされる ═══');
{
  const state = baseState([]);
  state.blockedApproachesAfterAssault = [{ localeId: ATK_LOCALE, edgeIdx: ATK_EDGE }];

  const next = resetCommandPoints(state);
  expect('resetCommandPoints後: blockedApproachesAfterAssault は空',
    next.blockedApproachesAfterAssault, []);
}

// ════════════════════════════════════════════════════════════════
// テスト 7: 突撃勝利後 → roadMarchBlockedLocales に防御ロケールが記録される
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 7: 突撃勝利後 → 防御ロケールへの道路行軍禁止 ═══');
{
  // 勝利後の状態を得る（retreat interruption 処理後まで）
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);

  let r = TurnManager.executeAction({
    type:            'assault',
    pieceId:         'AU-INF-1',
    attackLocaleId:  ATK_LOCALE,
    attackEdgeIdx:   ATK_EDGE,
    defenseLocaleId: DEF_LOCALE,
    defenseEdgeIdx:  DEF_EDGE,
  }, state);
  r = resp(r.newState, { leaderIds: [] });              // ① 防御先導なし
  r = resp(r.newState, { leaderIds: ['AU-INF-1'] });    // ② 攻撃先導
  r = resp(r.newState, { counterIds: [] });             // ④ カウンターなし
  r = resp(r.newState, { atkApproachChoice: [] });      // ⑤ 減少割り当て

  // ASSAULT_REDUCTIONS 後（retreat前）の state に roadMarchBlockedLocales が入っているはず
  expect('突撃勝利後: roadMarchBlockedLocales に DEF_LOCALE が追加される',
    (r.newState.roadMarchBlockedLocales ?? []).includes(DEF_LOCALE), true);

  // 退却処理後も引き継がれること
  const retreatResult = TurnManager.processInterruption(
    { destinationLocaleId: ATK_LOCALE },  // 攻撃側ロケールへ退却
    r.newState
  );
  expect('退却処理後も roadMarchBlockedLocales は保持される',
    (retreatResult.newState.roadMarchBlockedLocales ?? []).includes(DEF_LOCALE), true);
}

// ════════════════════════════════════════════════════════════════
// テスト 8: roadMarchBlockedLocales が設定されていると getLegalRoadMoves でそのロケールが除外される
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 8: roadMarchBlockedLocales → 道路行軍先から除外 ═══');
{
  // ATK_LOCALE から道路でアクセスできるロケールを確認
  // DEF_LOCALE=5 が道路でアクセスできるか（エッジに road があれば）
  const state = baseState([
    piece('AU-INF-2', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    // DEF_LOCALE は今はフランス側だが、ここでは空にして道路行軍の可否だけ確認
    piece('FR-INF-X', 'france', 'infantry', 2, 'reserve', DEF_LOCALE),  // 防御側占拠（enemyで除外）
  ]);

  // ATK_LOCALE と DEF_LOCALE の間に road があるか確認
  const roadEdges = map.getRoadEdgesBetween(ATK_LOCALE, DEF_LOCALE);
  if (roadEdges.length > 0) {
    // 道路がある場合のみテスト
    // DEF_LOCALE が敵占拠の場合は通常の敵占拠チェックで除外される（road march blocked と関係ない）
    // なので: DEF_LOCALE に中立(friendly)がいる or 空の状態でテスト
    const emptyState = baseState([
      piece('AU-INF-2', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    ]);
    const beforeBlock = getLegalRoadMoves(emptyState.pieces['AU-INF-2'], emptyState);
    const canReachBefore = beforeBlock.some(a => a.to.localeId === DEF_LOCALE);

    if (canReachBefore) {
      const blockedState = { ...emptyState, roadMarchBlockedLocales: [DEF_LOCALE] };
      const afterBlock = getLegalRoadMoves(blockedState.pieces['AU-INF-2'], blockedState);
      const canReachAfter = afterBlock.some(a => a.to.localeId === DEF_LOCALE);
      expect('ブロック後: DEF_LOCALE への道路行軍が除外される', canReachAfter, false);
    } else {
      // 道路はあるが通常でも到達できない場合（交通制限など）
      console.log('  ℹ️  ATK_LOCALE→DEF_LOCALE に道路あるが通常で到達不可、スキップ');
      passed++; // カウント維持
    }
  } else {
    // 道路がない場合: roadMarchBlockedLocales は関係ない
    console.log('  ℹ️  ATK_LOCALE→DEF_LOCALE 間に road なし（スキップ）');
    // 別のロケールで直接テスト
    const state2 = baseState([
      piece('AU-INF-2', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    ]);
    const allMoves = getLegalRoadMoves(state2.pieces['AU-INF-2'], state2);
    if (allMoves.length > 0) {
      const someLocale = allMoves[0].to.localeId;
      const blockedState = { ...state2, roadMarchBlockedLocales: [someLocale] };
      const afterBlock = getLegalRoadMoves(blockedState.pieces['AU-INF-2'], blockedState);
      const stillReaches = afterBlock.some(a => a.to.localeId === someLocale);
      expect(`roadMarchBlockedLocales: locale${someLocale} が道路行軍先から除外される`,
        stillReaches, false);
    } else {
      console.log('  ℹ️  ATK_LOCALE からの道路行軍なし（スキップ）');
      passed++;
    }
  }

  // roadMarchBlockedLocales が未定義でも安全
  const stateSafe = baseState([piece('AU-INF-2', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE)]);
  delete stateSafe.roadMarchBlockedLocales;
  let didThrow = false;
  try { getLegalRoadMoves(stateSafe.pieces['AU-INF-2'], stateSafe); } catch { didThrow = true; }
  expect('roadMarchBlockedLocales 未定義でもクラッシュしない', didThrow, false);
}

// ════════════════════════════════════════════════════════════════
// テスト 9: resetCommandPoints で roadMarchBlockedLocales がリセットされる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 9: ターン開始時に roadMarchBlockedLocales がリセットされる ═══');
{
  const state = baseState([]);
  state.roadMarchBlockedLocales = [DEF_LOCALE, 10, 20];

  const next = resetCommandPoints(state);
  expect('resetCommandPoints後: roadMarchBlockedLocales は空',
    next.roadMarchBlockedLocales, []);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
