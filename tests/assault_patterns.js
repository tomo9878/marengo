'use strict';
/**
 * assault_patterns.js
 * 突撃（assault）の全パターン検証スクリプト
 *
 * 実行: node tests/assault_patterns.js
 *
 * ─── マップ設定 ───────────────────────────────────────────
 *  【攻撃側ロケール】 locale3   ← Austria
 *       edge2 (locale3側) → edge4 (locale5側)
 *  【防御側ロケール】 locale5   ← France
 *
 * ─── 突撃フロー ──────────────────────────────────────────
 *  initiateAssault
 *    → ① ASSAULT_DEF_LEADERS  (防御側: 先導駒を選ぶ)
 *    → ② ASSAULT_ATK_LEADERS  (攻撃側: 先導駒を選ぶ)
 *    → ③ ASSAULT_DEF_ARTILLERY (防御側砲兵あれば: 砲撃するか?)
 *    → ④ ASSAULT_COUNTER       (防御側: カウンター駒を選ぶ)
 *    → ⑤ ASSAULT_REDUCTIONS    (勝者側が余剰減少を割り当て)
 *    → [RETREAT_DESTINATION]    (攻撃側勝利時: 防御側退却先)
 *
 * ─── 勝敗計算式 ──────────────────────────────────────────
 *  result = (攻撃先導駒戦力合計) - (地形ペナルティ) - (防御先導駒戦力合計) - (カウンター戦力合計)
 *  atkWins = result >= 1
 *
 * ─── 減少計算 ─────────────────────────────────────────────
 *  defReductions = 攻撃先導駒の数 (強度でなく枚数)
 *  atkReductions = 防御先導駒の数 + 生き残り防御騎兵カウンター数
 *               + (攻撃側負け かつ atkLeaderStr <= |result| なら +1 or +2)
 */

const TurnManager = require('../server/engine/TurnManager');
const { createInitialState } = require('../server/engine/GameState');

// ─── 定数 ───────────────────────────────────────────────────
const ATK_LOCALE  = 3;  // Austria のいるロケール
const ATK_EDGE    = 2;  // locale3 側のエッジ
const DEF_LOCALE  = 5;  // France のいるロケール
const DEF_EDGE    = 4;  // locale5 側のエッジ (getOppositeApproach(3,2) → {localeIdx:5, edgeIdx:4})

// ─── ヘルパー ────────────────────────────────────────────────
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
  s.activePlayer = 'austria';
  s.controlToken = { holder: 'austria', reason: 'active_player' };
  s.commandPoints = 3;
  return s;
}

function assault(state) {
  return TurnManager.executeAction({
    type: 'assault',
    pieceId: Object.values(state.pieces).find(p => p.side === 'austria').id,
    attackLocaleId:  ATK_LOCALE,
    attackEdgeIdx:   ATK_EDGE,
    defenseLocaleId: DEF_LOCALE,
    defenseEdgeIdx:  DEF_EDGE,
  }, state);
}

function resp(state, response) {
  return TurnManager.processInterruption(response, state);
}

// ─── ユーティリティ: 突撃を①〜⑤まで一気に流す ──────────────
// responses = { defLeaders, atkLeaders, defArtilleryFire?, counter, atkApproachChoice? }
function runAssault(initState, responses) {
  let r = assault(initState);
  // ① 防御先導駒
  r = resp(r.newState, { leaderIds: responses.defLeaders });
  // ② 攻撃先導駒
  r = resp(r.newState, { leaderIds: responses.atkLeaders });
  // ③ 防御砲撃 (インタラプションがあれば)
  if (r.interruption?.type === 'assault_def_artillery') {
    r = resp(r.newState, { fire: responses.defArtilleryFire ?? false });
  }
  // ④ カウンター
  r = resp(r.newState, { counterIds: responses.counter ?? [] });
  // ⑤ 減少割り当て
  r = resp(r.newState, { atkApproachChoice: responses.atkApproachChoice ?? [] });
  return r;
}

// ════════════════════════════════════════════════════════════════
// パターン 1: 攻撃側圧勝（先導駒1体 vs 防御先導なし・カウンターなし）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 1: 攻撃側圧勝（AU歩兵str3 vs 防御先導なし）═══');
console.log('  設定: AU-INF-1(str=3) @ approach_2, FR-INF-1(str=2) @ reserve');
console.log('  攻撃先導: AU-INF-1(3)  防御先導: なし  カウンター: なし');
console.log('  result = 3 - 0 - 0 = 3 → 攻撃側勝利');
console.log('  defReductions=1(攻撃先導1枚), atkReductions=0');
console.log('  FR-INF-1(str2→1)、退却インタラプション発生');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve',              DEF_LOCALE),
  ]);
  const r = runAssault(state, {
    defLeaders: [],
    atkLeaders: ['AU-INF-1'],
    counter: [],
  });
  expect('攻撃側勝利 → retreat_destination interruption',
    r.interruption?.type, 'retreat_destination');
  expect('退却ロケール = DEF_LOCALE',
    r.interruption?.context?.losingLocaleId, DEF_LOCALE);
  expect('AU-INF-1 が DEF_LOCALE へ移動',
    r.newState.pieces['AU-INF-1']?.localeId, DEF_LOCALE);
  expect('FR-INF-1 戦力減少 2→1',
    r.newState.pieces['FR-INF-1']?.strength, 1);
}

// ════════════════════════════════════════════════════════════════
// パターン 2: 防御先導駒あり、攻撃側辛勝
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 2: 防御先導駒あり、攻撃側辛勝 ═══');
console.log('  設定: AU-INF-1(str=4) @ approach_2, FR-INF-1(str=2) @ approach_4');
console.log('  攻撃先導: AU-INF-1(4)  防御先導: FR-INF-1(2)  カウンター: なし');
console.log('  e5-4に inf_obstacle×1 → 歩兵先導ペナルティ -1');
console.log('  result = 4 - 1(地形) - 2 = 1 → 攻撃側辛勝');
console.log('  defReductions=1(攻撃先導1枚)→FR-INF-1(2→1)');
console.log('  atkReductions=1(防御先導1枚)→AU-INF-1(4→3)');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 4, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  const r = runAssault(state, {
    defLeaders: ['FR-INF-1'],
    atkLeaders: ['AU-INF-1'],
    counter: [],
  });
  expect('攻撃側勝利 → retreat_destination interruption',
    r.interruption?.type, 'retreat_destination');
  expect('AU-INF-1 戦力減少 4→3',
    r.newState.pieces['AU-INF-1']?.strength, 3);
  expect('FR-INF-1 戦力減少 2→1',
    r.newState.pieces['FR-INF-1']?.strength, 1);
}

// ════════════════════════════════════════════════════════════════
// パターン 3: 防御側勝利（防御先導が強い）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 3: 防御側勝利（AU弱 vs FR強）═══');
console.log('  設定: AU-INF-1(str=1) @ approach_2, FR-INF-1(str=3) @ approach_4');
console.log('  攻撃先導: AU-INF-1(1)  防御先導: FR-INF-1(3)  カウンター: なし');
console.log('  result = 1 - 3 = -2 → 防御側勝利');
console.log('  defReductions=1(攻撃先導1枚)→FR-INF-1(3→2)');
console.log('  atkReductions=1(防御先導1枚) + 追加+1(atkStr1 <= |result|2) = 2');
console.log('  AU-INF-1(str1→0で消滅) 退却なし（防御側が守り抜く）');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 1, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 3, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  const r = runAssault(state, {
    defLeaders: ['FR-INF-1'],
    atkLeaders: ['AU-INF-1'],
    counter: [],
  });
  expect('防御側勝利 → interruption なし',
    r.interruption, null);
  expect('AU-INF-1 戦力減少 1→0（消滅）',
    r.newState.pieces['AU-INF-1']?.strength, 0);
  expect('FR-INF-1 戦力減少 3→2',
    r.newState.pieces['FR-INF-1']?.strength, 2);
  expect('制御トークンがactivePlayerへ戻る',
    r.newState.controlToken.holder, 'austria');
}

// ════════════════════════════════════════════════════════════════
// パターン 4: カウンター攻撃（騎兵）あり、攻撃側敗北
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 4: カウンター騎兵あり、攻撃敗北 ═══');
console.log('  設定: AU-INF-1(str=2) @ approach_2');
console.log('         FR-INF-1(str=2) @ approach_4 (防御先導)');
console.log('         FR-CAV-1(str=2) @ approach_4 (カウンター候補)');
console.log('  攻撃先導: AU-INF-1(2)  防御先導: FR-INF-1(2)  カウンター: FR-CAV-1(2)');
console.log('  防御砲撃なし');
console.log('  result = 2 - 2 - 2 = -2 → 防御側勝利');
console.log('  生き残り騎兵カウンター: FR-CAV-1は戦前str2、カウンター参加→AU先導を2減少');
console.log('  AU-INF-1 カウンター参加前に受ける: 先導2体分 = なし、カウンター2体→AU-INF-1(2-2=0)');
console.log('  atkReductions=1(FR防御先導)+1(生き残り騎兵CAV)+追加+1=3');
console.log('  defReductions=1(AU攻撃先導1枚)→FR-INF-1(2→1)');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, `approach_${DEF_EDGE}`, DEF_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry',  2, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  const r = runAssault(state, {
    defLeaders: ['FR-INF-1'],
    atkLeaders: ['AU-INF-1'],
    counter: ['FR-CAV-1'],
  });
  // カウンター参加前: AU-INF-1 str=2、FR-CAV-1 str=2
  // カウンター参加でAU先導をcounterIds.length=1分減少→AU-INF-1(2→1)
  // result = 1(after counter) - 2(FR-INF-1) - 2(FR-CAV-1) = -3 → def wins
  expect('防御側勝利 → interruption なし',
    r.interruption, null);
  expect('AU-INF-1 戦力ゼロ以下',
    r.newState.pieces['AU-INF-1']?.strength <= 0, true);
  expect('FR-INF-1 戦力減少（攻撃先導1枚分）',
    r.newState.pieces['FR-INF-1']?.strength, 1);
}

// ════════════════════════════════════════════════════════════════
// パターン 5: 防御砲兵あり・砲撃実施 → 攻撃先導弱体化 → 逆転負け
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 5: 防御砲撃で攻撃先導弱体化 → 防御側勝利 ═══');
console.log('  設定: AU-INF-1(str=2) @ approach_2');
console.log('         FR-INF-1(str=1) @ approach_4 (防御先導)');
console.log('         FR-ART-1(str=2) @ reserve     (防御砲兵)');
console.log('  砲撃前: result見込み = 2 - 1 = 1 → 攻撃側勝利のはず');
console.log('  砲撃実施→攻撃先導AU-INF-1(2→1)');
console.log('  カウンターなし、result = 1 - 1 = 0 → 防御側勝利（>=1 でなければ防御勝ち）');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry',  2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry',  1, `approach_${DEF_EDGE}`, DEF_LOCALE),
    piece('FR-ART-1', 'france',  'artillery', 2, 'reserve',              DEF_LOCALE),
  ]);

  let r = assault(state);
  // ① 防御先導: FR-INF-1
  r = resp(r.newState, { leaderIds: ['FR-INF-1'] });
  // ② 攻撃先導: AU-INF-1
  r = resp(r.newState, { leaderIds: ['AU-INF-1'] });
  // ③ 防御砲撃インタラプションが来るはず
  expect('防御砲撃 interruption が来る',
    r.interruption?.type, 'assault_def_artillery');
  // 砲撃実施
  r = resp(r.newState, { fire: true });
  expect('AU-INF-1 砲撃で 2→1',
    r.newState.pieces['AU-INF-1']?.strength, 1);
  // ④ カウンターなし
  r = resp(r.newState, { counterIds: [] });
  // ⑤ 減少割り当て
  r = resp(r.newState, { atkApproachChoice: [] });

  expect('防御側勝利（result=0）→ interruption なし',
    r.interruption, null);
  expect('AU-INF-1 さらに減少 1→0（atkReductions=1）',
    r.newState.pieces['AU-INF-1']?.strength, 0);
  expect('FR-INF-1 減少 1→0（defReductions=1枚）',
    r.newState.pieces['FR-INF-1']?.strength, 0);
}

// ════════════════════════════════════════════════════════════════
// パターン 6: 攻撃先導2体 vs 防御先導2体（均衡→わずか攻撃勝ち）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 6: 攻撃先導2体 vs 防御先導2体 ═══');
console.log('  設定: AU-INF-1(str=2), AU-CAV-1(str=2) @ approach_2 (2体)');
console.log('         FR-INF-1(str=1), FR-CAV-1(str=1) @ approach_4 (防御先導2体)');
console.log('  攻撃先導: AU-INF-1+AU-CAV-1 (合計4)');
console.log('  防御先導: FR-INF-1+FR-CAV-1 (合計2)');
console.log('  カウンター: なし');
console.log('  result = 4 - 2 = 2 → 攻撃側勝利');
console.log('  defReductions=2(攻撃先導2枚)→ FR-INF-1(1→0), FR-CAV-1(1→0)');
console.log('  atkReductions=2(防御先導2枚)→ AU-INF-1(2→1), AU-CAV-1(2→1)');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('AU-CAV-1', 'austria', 'cavalry',  2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 1, `approach_${DEF_EDGE}`, DEF_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry',  1, `approach_${DEF_EDGE}`, DEF_LOCALE),
  ]);
  const r = runAssault(state, {
    defLeaders: ['FR-INF-1', 'FR-CAV-1'],
    atkLeaders: ['AU-INF-1', 'AU-CAV-1'],
    counter: [],
  });
  expect('攻撃側勝利 → retreat_destination',
    r.interruption?.type, 'retreat_destination');
  expect('AU-INF-1 戦力 2→1',
    r.newState.pieces['AU-INF-1']?.strength, 1);
  expect('AU-CAV-1 戦力 2→1',
    r.newState.pieces['AU-CAV-1']?.strength, 1);
  expect('FR-INF-1 戦力 1→0',
    r.newState.pieces['FR-INF-1']?.strength, 0);
  expect('FR-CAV-1 戦力 1→0',
    r.newState.pieces['FR-CAV-1']?.strength, 0);
}

// ════════════════════════════════════════════════════════════════
// パターン 7: 先導駒なし（攻撃・防御ともに0）→ result=0 → 防御側勝利
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 7: 先導駒なし（result=0 → 防御側勝利）═══');
console.log('  設定: AU-INF-1(str=2) @ approach_2（先導に指定しない）');
console.log('         FR-INF-1(str=2) @ reserve');
console.log('  攻撃先導: なし  防御先導: なし  カウンター: なし');
console.log('  result = 0 → 防御側勝利（result < 1）');
console.log('  先導駒なし→双方減少なし、退却なし');
console.log('  ※コードバグ修正: absResult=0時は追加減少を適用しない');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve',              DEF_LOCALE),
  ]);
  const r = runAssault(state, {
    defLeaders: [],
    atkLeaders: [],
    counter: [],
  });
  expect('防御側勝利（result=0）→ interruption なし',
    r.interruption, null);
  expect('AU-INF-1 戦力変わらず（先導なし・減少なし）',
    r.newState.pieces['AU-INF-1']?.strength, 2);
  expect('FR-INF-1 戦力変わらず',
    r.newState.pieces['FR-INF-1']?.strength, 2);
}

// ════════════════════════════════════════════════════════════════
// パターン 8: 攻撃側勝利、退却処理の詳細検証
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 8: 攻撃勝利 → 退却先選択 → 解決 ═══');
console.log('  設定: AU-INF-1(str=3) @ approach_2');
console.log('         FR-INF-1(str=2) @ reserve  (歩兵: 退却時1減少 → str1 → locale4へ退却)');
console.log('         FR-CAV-1(str=2) @ reserve  (騎兵: 退却時減少なし → str2 → locale4へ退却)');
console.log('  ゲームルール: リザーブ歩兵は1減少、騎兵は減少なし');
console.log('  FR-INF-1: 突撃減少(2→1) + 退却減少(1→0) → 消滅');
console.log('  FR-CAV-1: 退却減少なし → str2のままlocale4へ退却');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve',              DEF_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry',  2, 'reserve',              DEF_LOCALE),
  ]);
  let r = runAssault(state, {
    defLeaders: [],
    atkLeaders: ['AU-INF-1'],
    counter: [],
  });
  expect('攻撃側勝利 → retreat_destination',
    r.interruption?.type, 'retreat_destination');

  const waitingFor = r.interruption?.context?.losingSide;
  expect('退却要求 = france',
    waitingFor, 'france');

  // 退却先を locale4 に指定して応答
  const retreatResp = { destinations: { 'FR-INF-1': 4, 'FR-CAV-1': 4 } };
  r = resp(r.newState, retreatResp);
  expect('退却後 interruption なし',
    r.interruption, null);
  expect('FR-INF-1 消滅（退却減少で str=0）',
    r.newState.pieces['FR-INF-1']?.strength, 0);
  expect('FR-CAV-1 がlocale4 へ退却（騎兵は減少なし）',
    r.newState.pieces['FR-CAV-1']?.localeId, 4);
  expect('FR-CAV-1 退却後は reserve',
    r.newState.pieces['FR-CAV-1']?.position, 'reserve');
  expect('FR-CAV-1 戦力変わらず str=2',
    r.newState.pieces['FR-CAV-1']?.strength, 2);
  expect('制御トークン → austria',
    r.newState.controlToken.holder, 'austria');
}

// ════════════════════════════════════════════════════════════════
// パターン 9: 退却 - 強い歩兵は生き残って退却できる
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Pattern 9: 退却 - 強い歩兵は生き残って退却 ═══');
console.log('  設定: AU-INF-1(str=3) @ approach_2');
console.log('         FR-INF-1(str=3) @ reserve  (退却減少: 3→2, 生存)');
console.log('  FR-INF-1(str3)は突撃減少(3→2) + 退却減少(2→1) → str=1でlocale4へ');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 3, `approach_${ATK_EDGE}`, ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 3, 'reserve',              DEF_LOCALE),
  ]);
  let r = runAssault(state, {
    defLeaders: [],
    atkLeaders: ['AU-INF-1'],
    counter: [],
  });
  expect('攻撃側勝利 → retreat_destination',
    r.interruption?.type, 'retreat_destination');

  // 突撃時: defReductions=1 → FR-INF-1(3→2)
  expect('FR-INF-1 突撃後 3→2',
    r.newState.pieces['FR-INF-1']?.strength, 2);

  r = resp(r.newState, { destinations: { 'FR-INF-1': 4 } });
  expect('FR-INF-1 がlocale4 へ退却',
    r.newState.pieces['FR-INF-1']?.localeId, 4);
  expect('FR-INF-1 退却後 str=1（退却減少1）',
    r.newState.pieces['FR-INF-1']?.strength, 1);
}

// ════════════════════════════════════════════════════════════════
// サマリー
// ════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed / ${passed + failed} total`);
if (failed > 0) {
  console.log(`     ${failed} FAILED`);
  process.exitCode = 1;
} else {
  console.log('     全パターン PASSED ✅');
}
