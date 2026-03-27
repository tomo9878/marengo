'use strict';
/**
 * morale_combat.js
 * 戦闘における士気変動6パターンの検証
 *
 * 実行: node tests/morale_combat.js
 *
 * ─── テスト一覧 ──────────────────────────────────────────────────────────────
 *  Test 1: 急襲・防御側勝利 → 士気トークン投入1個（狭いアプローチ）
 *  Test 2: 急襲・防御側勝利 → 士気トークン投入2個（広い+2攻撃駒+最初の急襲）
 *  Test 3: 突撃・攻撃側勝利 → 防御側の先導駒+カウンター駒の数だけ投入
 *  Test 4: オーストリア退却 → 退却駒の数だけ士気投入
 *  Test 5: 突撃の戦力減少による士気低下（敗者のみ、勝者は低下しない）
 *  Test 6: 士気崩壊（0以下）→ 即時ゲーム終了
 *
 * ─── マップ参考 ──────────────────────────────────────────────────────────────
 *  ATK_LOCALE=3  → DEF_LOCALE=5: attackEdge=2, defEdge=4, narrow, ["inf_obstacle"]
 *  WIDE_ATK=8    → WIDE_DEF=9:   defEdge=4, wide, ["inf_obstacle"]
 *    locale 8 edge 1 ↔ locale 9 edge 4 (wide; getApproachWidth==='wide')
 */

const TurnManager   = require('../server/engine/TurnManager');
const MoraleManager = require('../server/engine/MoraleManager');
const { createInitialState, INTERRUPTION, SIDES } = require('../server/engine/GameState');

// ─── 定数 ────────────────────────────────────────────────────────────────────
const ATK_LOCALE  = 3;
const ATK_EDGE    = 2;
const DEF_LOCALE  = 5;
const DEF_EDGE    = 4;
const WIDE_ATK    = 8;
const WIDE_DEF    = 9;
const WIDE_EDGE   = 4;  // locale9 edge4 is wide

// ─── ヘルパー ─────────────────────────────────────────────────────────────────
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
  return {
    id, side, type,
    strength: str, maxStrength: str,
    disordered: false, faceUp: false,
    localeId: locale, position: pos, actedThisTurn: false,
  };
}

/** テスト用に士気値を上書きした initialState を生成する */
function baseState(pieces, opts = {}) {
  const s = createInitialState();
  s.pieces = {};
  for (const p of pieces) s.pieces[p.id] = p;
  s.activePlayer  = opts.active  ?? 'austria';
  s.controlToken  = { holder: s.activePlayer, reason: 'active_player' };
  s.commandPoints = opts.cp      ?? 6;
  s.morale.austria.uncommitted = opts.auUncomm ?? 5;
  s.morale.france.uncommitted  = opts.frUncomm ?? 5;
  s.morale.austria.total = 12;
  s.morale.france.total  = 12;
  s.moraleTokens = [];
  return s;
}

function resp(state, response) {
  return TurnManager.processInterruption(response, state);
}

// ─── 突撃を①〜⑤まで一気に流すユーティリティ ────────────────────────────────
function runAssault(state, attackAction, responses) {
  let r = TurnManager.executeAction(attackAction, state);
  r = resp(r.newState, { leaderIds: responses.defLeaders });
  r = resp(r.newState, { leaderIds: responses.atkLeaders });
  if (r.interruption?.type === 'assault_def_artillery') {
    r = resp(r.newState, { fire: false });
  }
  r = resp(r.newState, { counterIds: responses.counter ?? [] });
  r = resp(r.newState, { atkApproachChoice: [] });
  return r;
}

// ════════════════════════════════════════════════════════════════════════════
// Test 1: 急襲・防御側勝利 → 士気投入1個（狭いアプローチ）
// ════════════════════════════════════════════════════════════════════════════
// 設定: ATK_LOCALE=3(Austria), DEF_LOCALE=5(France), 狭いアプローチ(e5-4)
//   AU-INF-1 が急襲 → FR-INF-1 が1体応答でブロック（狭いアプローチ→1体で完全ブロック）
//   moraleInvestment = 1（wide でないため常に1）
//   防御側（フランス）がlocale5に1トークン投入
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 急襲・防御側勝利 → 士気投入1個（狭いアプローチ） ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', DEF_LOCALE),
  ]);

  let r = TurnManager.executeAction({
    type: 'raid', pieceId: 'AU-INF-1',
    fromLocaleId: ATK_LOCALE, fromPosition: 'reserve',
    targetLocaleId: DEF_LOCALE, defenseEdgeIdx: DEF_EDGE, commandCost: 3,
  }, state);

  expect('急襲後 defense_response インタラプション', r.interruption?.type, 'defense_response');

  // France が1体応答 → 狭いアプローチを完全ブロック
  r = resp(r.newState, { pieceIds: ['FR-INF-1'] });

  // 防御側勝利後は attacker_approach インタラプション（攻撃側がアプローチへ移動するか選択）
  expect('防御側ブロック後 attacker_approach', r.interruption?.type, 'attacker_approach');

  expect('フランスのトークンがlocale5に1個投入される',
    r.newState.moraleTokens.filter(t => t.side === SIDES.FRANCE && t.localeId === DEF_LOCALE).length, 1);
  expect('フランスの uncommitted が1減少（5→4）',
    r.newState.morale.france.uncommitted, 4);
  expect('オーストリアの uncommitted は変化しない',
    r.newState.morale.austria.uncommitted, 5);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 2: 急襲・防御側勝利 → 士気投入2個（広いアプローチ + 2攻撃駒 + 最初の急襲）
// ════════════════════════════════════════════════════════════════════════════
// 設定: WIDE_ATK=8(Austria), WIDE_DEF=9(France), 広いアプローチ(e9-4)
//   attackerPieceIds を2体に設定（通常の raid action は1体だが context を直接構築）
//   France が2体応答 → 広いアプローチを完全ブロック（wide は2体必要）
//   isWide=true AND multipleAttackers=true AND isFirstRaidThroughApproach=true → 2トークン投入
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 急襲・防御側勝利 → 士気投入2個（広い+2攻撃駒+最初の急襲） ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', WIDE_ATK),
    piece('AU-INF-2', 'austria', 'infantry', 2, 'reserve', WIDE_ATK),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve', WIDE_DEF),
    piece('FR-INF-2', 'france',  'infantry', 2, 'reserve', WIDE_DEF),
  ]);

  // 広いアプローチ・2攻撃駒の急襲を直接構築（context に attackerPieceIds=2 を設定）
  state.controlToken = { holder: 'france', reason: INTERRUPTION.DEFENSE_RESPONSE };
  state.pendingInterruption = {
    type: INTERRUPTION.DEFENSE_RESPONSE,
    waitingFor: 'france',
    context: {
      attackerPieceIds:         ['AU-INF-1', 'AU-INF-2'],
      targetLocaleId:           WIDE_DEF,
      defenseEdgeIdx:           WIDE_EDGE,
      availableDefenders:       ['FR-INF-1', 'FR-INF-2'],
      maxResponse:              2,
      isFirstRaidThroughApproach: true,
    },
  };

  // France が2体応答 → 広いアプローチを完全ブロック
  let r = resp(state, { pieceIds: ['FR-INF-1', 'FR-INF-2'] });

  // 防御側勝利後 attacker_approach
  expect('防御側ブロック後 attacker_approach', r.interruption?.type, 'attacker_approach');

  const frTokensAtWide = r.newState.moraleTokens.filter(
    t => t.side === SIDES.FRANCE && t.localeId === WIDE_DEF
  );
  expect('フランスのトークンがlocale9に2個投入される（2トークン条件）', frTokensAtWide.length, 2);
  expect('フランスの uncommitted が2減少（5→3）',
    r.newState.morale.france.uncommitted, 3);
  expect('オーストリアの uncommitted は変化しない',
    r.newState.morale.austria.uncommitted, 5);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 3: 突撃・攻撃側勝利 → 防御側の先導駒+カウンター駒の数だけ士気投入
// ════════════════════════════════════════════════════════════════════════════
// 設定: ATK_LOCALE=3(Austria CAV str=6), DEF_LOCALE=5(France)
//   FR-INF-1(str=2) を防御先導駒、FR-INF-2(str=2) をカウンターに使用
//   カウンターが AU-CAV-1 を1減少（6→5）後の計算:
//     result = 5(atkStr) - 0(penalty) - 2(defStr) - 2(counterStr) = 1 → atkWins=true
//   defInvestCount = defLeaderIds.length(1) + counterIds.length(1) = 2
//   突撃勝利 → investMorale(france, locale5, 2)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 突撃・攻撃側勝利 → 防御側の先導駒+カウンター駒の数だけ士気投入 ═══');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry',  6, 'approach_2', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve',    DEF_LOCALE),
    piece('FR-INF-2', 'france',  'infantry', 2, 'reserve',    DEF_LOCALE),
  ]);

  const r = runAssault(state, {
    type: 'assault', pieceId: 'AU-CAV-1',
    attackLocaleId: ATK_LOCALE, attackEdgeIdx: ATK_EDGE,
    defenseLocaleId: DEF_LOCALE, defenseEdgeIdx: DEF_EDGE,
  }, {
    defLeaders: ['FR-INF-1'],
    atkLeaders: ['AU-CAV-1'],
    counter:    ['FR-INF-2'],
  });

  // 攻撃側勝利 → RETREAT_DESTINATION が発生
  expect('突撃完了後 retreat_destination', r.interruption?.type, 'retreat_destination');

  const frTokensAtDef = r.newState.moraleTokens.filter(
    t => t.side === SIDES.FRANCE && t.localeId === DEF_LOCALE
  );
  expect('フランストークンがlocale5に2個投入される（defLeader1+counter1）',
    frTokensAtDef.length, 2);
  expect('オーストリアの uncommitted は変化しない（勝者は投入なし）',
    r.newState.morale.austria.uncommitted, 5);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 4: オーストリア退却 → 退却駒の数だけ士気投入
// ════════════════════════════════════════════════════════════════════════════
// 設定: locale3 に AU-INF-1・AU-INF-2（Franceなし）→ retreat_destination を直接構築
//   processRetreatDestination が resolveRetreat を呼ぶ:
//     losingOccupant = 'austria' (locale3 にはオーストリアのみ) → moraleInvestment=2
//   2駒がlocale2へ退却 → Austria が 2トークンを locale3 に投入
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: オーストリア退却 → 退却駒の数だけ士気投入 ═══');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('AU-INF-2', 'austria', 'infantry', 2, 'reserve', ATK_LOCALE),
    piece('FR-CAV-1', 'france',  'cavalry',  3, 'reserve', DEF_LOCALE),
  ], { active: 'austria' });

  // France はlocale3にいない → losingOccupant='austria' になる
  state.controlToken = { holder: 'austria', reason: INTERRUPTION.RETREAT_DESTINATION };
  state.pendingInterruption = {
    type: INTERRUPTION.RETREAT_DESTINATION,
    waitingFor: 'austria',
    context: {
      losingLocaleId: ATK_LOCALE,
      losingSide:     'austria',
      attackInfo: {
        attackLocaleId:    DEF_LOCALE,
        attackEdgeIdx:     DEF_EDGE,
        isWideApproach:    false,
        attackerPieceCount: 1,
      },
    },
  };

  // Austria が2駒をlocale2へ退却
  const r = resp(state, { destinations: { 'AU-INF-1': 2, 'AU-INF-2': 2 } });

  expect('退却処理後 interruption なし（正常終了）', r.interruption, null);

  const auTokens = r.newState.moraleTokens.filter(
    t => t.side === SIDES.AUSTRIA && t.localeId === ATK_LOCALE
  );
  expect('オーストリアトークンがlocale3に2個投入される（退却駒数=2）',
    auTokens.length, 2);
  // investMorale(2) + reduceMorale(2: retreat reductions) = 合計4減少 → 5→1
  expect('オーストリアの uncommitted が4減少（5→1: 投入2 + 退却損耗2）',
    r.newState.morale.austria.uncommitted, 1);
  expect('フランスの uncommitted は変化しない',
    r.newState.morale.france.uncommitted, 5);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 5: 突撃の戦力減少による士気低下（敗者のみ、勝者は低下しない）
// ════════════════════════════════════════════════════════════════════════════
// Test 5a: 攻撃側（Austria）勝利 → フランス（防御側・敗者）のみ士気低下
//   AU-CAV-1(str=4) vs FR-INF-1(str=2) defLeader, counter=[]
//   result = 4 - 0 - 2 = 2 → atkWins
//   defReductions=1 → reduceMorale(france, 1)
//   Austria（勝者）は reduceMorale されない
//
// Test 5b: 攻撃側（Austria）敗北 → オーストリア（攻撃側・敗者）のみ士気低下
//   AU-INF-1(str=2) vs FR-INF-1(str=3) defLeader, counter=[]
//   inf_obstacle penalty=1 → result = 2 - 1 - 3 = -2 → atkWins=false
//   atkReductions=2 → reduceMorale(austria, 2)
//   France（勝者）は reduceMorale されない
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 突撃の戦力減少による士気低下（敗者のみ、勝者は低下しない） ═══');

// ── Test 5a: Austria 勝利 ────────────────────────────────────────────────────
console.log('  [5a] 攻撃側勝利 → 防御側（フランス）のみ士気低下');
{
  const state = baseState([
    piece('AU-CAV-1', 'austria', 'cavalry',  4, 'approach_2', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 2, 'reserve',    DEF_LOCALE),
    piece('FR-INF-2', 'france',  'infantry', 2, 'reserve',    DEF_LOCALE),
  ]);

  const r = runAssault(state, {
    type: 'assault', pieceId: 'AU-CAV-1',
    attackLocaleId: ATK_LOCALE, attackEdgeIdx: ATK_EDGE,
    defenseLocaleId: DEF_LOCALE, defenseEdgeIdx: DEF_EDGE,
  }, {
    defLeaders: ['FR-INF-1'],
    atkLeaders: ['AU-CAV-1'],
    counter:    [],
  });

  // atkWins=true: france.uncommitted = 5 - 1(invest for defLeader) - 1(reduce for defReductions=1) = 3
  expect('攻撃側勝利: フランスの uncommitted が減少する',
    r.newState.morale.france.uncommitted < 5, true);
  expect('攻撃側勝利: オーストリアの uncommitted は変化しない（勝者は低下なし）',
    r.newState.morale.austria.uncommitted, 5);
}

// ── Test 5b: Austria 敗北 ────────────────────────────────────────────────────
console.log('  [5b] 攻撃側敗北 → 攻撃側（オーストリア）のみ士気低下');
{
  const state = baseState([
    piece('AU-INF-1', 'austria', 'infantry', 2, 'approach_2', ATK_LOCALE),
    piece('FR-INF-1', 'france',  'infantry', 3, 'reserve',    DEF_LOCALE),
  ]);

  const r = runAssault(state, {
    type: 'assault', pieceId: 'AU-INF-1',
    attackLocaleId: ATK_LOCALE, attackEdgeIdx: ATK_EDGE,
    defenseLocaleId: DEF_LOCALE, defenseEdgeIdx: DEF_EDGE,
  }, {
    defLeaders: ['FR-INF-1'],
    atkLeaders: ['AU-INF-1'],
    counter:    [],
  });

  // atkWins=false (result=-2): reduceMorale(austria, atkReductions=2) → 5→3
  expect('攻撃側敗北: オーストリアの uncommitted が減少する（5→3）',
    r.newState.morale.austria.uncommitted, 3);
  expect('攻撃側敗北: フランスの uncommitted は変化しない（勝者は低下なし）',
    r.newState.morale.france.uncommitted, 5);
  expect('攻撃側敗北: interruption なし（退却不要）', r.interruption, null);
}

// ════════════════════════════════════════════════════════════════════════════
// Test 6: 士気崩壊（0以下）→ 即時ゲーム終了
// ════════════════════════════════════════════════════════════════════════════
// Test 6a: MoraleManager.checkMoraleCollapse がフランス崩壊を検出
// Test 6b: TurnManager.checkVictory が勝者を正しく返す
// Test 6c: フランス uncommitted=0 かつ MAPトークンもなし → 崩壊（uncommitted の上は総合士気）
// Test 6d: オーストリア崩壊 → フランスの勝利
// ════════════════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: 士気崩壊（0以下）→ 即時ゲーム終了 ═══');

// ── Test 6a: フランス崩壊検出 ────────────────────────────────────────────────
{
  const state = createInitialState();
  state.morale.france.uncommitted = 0;
  state.morale.france.total = 12;
  state.moraleTokens = []; // フランスのマップトークンなし
  state.morale.austria.uncommitted = 3;

  const collapse = MoraleManager.checkMoraleCollapse(state);
  expect('フランス uncommitted=0 かつマップトークンなし → 崩壊検出',
    collapse?.collapsed, true);
  expect('崩壊サイド = france', collapse?.side, SIDES.FRANCE);
}

// ── Test 6b: TurnManager.checkVictory がフランス崩壊でオーストリア勝利を返す ──
{
  const state = createInitialState();
  state.morale.france.uncommitted = 0;
  state.moraleTokens = [];
  state.morale.austria.uncommitted = 3;
  state.round = 5; // ラウンド終了条件は除外

  const result = TurnManager.checkVictory(state);
  expect('フランス崩壊 → checkVictory: winner=austria',
    result?.winner, SIDES.AUSTRIA);
  expect('フランス崩壊 → checkVictory: type=morale_collapse',
    result?.type, 'morale_collapse');
}

// ── Test 6c: フランスにマップトークンがあれば崩壊しない ────────────────────────
{
  const state = createInitialState();
  state.morale.france.uncommitted = 0;
  state.moraleTokens = [{ side: SIDES.FRANCE, localeId: 5 }]; // マップトークン1個
  state.morale.austria.uncommitted = 3;
  state.round = 5;

  const result = TurnManager.checkVictory(state);
  expect('フランス uncommitted=0 でもマップトークンあり → 崩壊なし',
    result, null);
}

// ── Test 6d: オーストリア崩壊 → フランスの勝利 ───────────────────────────────
{
  const state = createInitialState();
  state.morale.austria.uncommitted = 0;
  state.moraleTokens = []; // オーストリアのマップトークンなし
  state.morale.france.uncommitted = 3;
  state.round = 5;

  const result = TurnManager.checkVictory(state);
  expect('オーストリア崩壊 → checkVictory: winner=france',
    result?.winner, SIDES.FRANCE);
  expect('オーストリア崩壊 → checkVictory: type=morale_collapse',
    result?.type, 'morale_collapse');
}

// ════════════════════════════════════════════════════════════════════════════
// 結果
// ════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
