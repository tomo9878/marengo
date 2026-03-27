'use strict';
/**
 * morale_cleanup_last_occupant.js
 * チェックリスト #6: 士気クリーンアップ「最後に敵がいた」条件
 *
 * 実行: node tests/morale_cleanup_last_occupant.js
 *
 * ルール: 現在敵が占拠していなくても、最後にそのロケールに存在した駒が
 *         敵だった場合もトークンを除去する。
 *
 * テスト設計:
 *   - moraleCleanup は「敵隣接なし → uncommittedへ返還」ルールも持つ
 *   - 「最後に敵がいた」ルールを単独で検証するため、
 *     隣接ロケールに敵を配置して「隣接チェック」には引っかかるようにする
 *   - その上で「現在占拠」vs「最後に占拠」の差を確認する
 *
 * 使用ロケール: locale=5 の隣接ロケール=3 (Austria が locale=3 にいる状態にする)
 * つまりフランスのトークンが locale=5 にあり、locale=3 に Austria がいる → 隣接敵あり
 */

const { moraleCleanup } = require('../server/engine/MoraleManager');
const { createInitialState } = require('../server/engine/GameState');
const map = require('../server/engine/MapGraph');

// テスト用ロケール
// locale=5 (FR token locale), locale=3 (Austria is adjacent neighbor)
const TOKEN_LOCALE = 5;
const ENEMY_ADJ    = 3; // locale=3 は locale=5 の隣接（assault_patterns と同じ設定）

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

function baseState() {
  const s = createInitialState();
  s.pieces = {};
  s.activePlayer  = 'austria';
  s.controlToken  = { holder: 'austria', reason: 'active_player' };
  s.commandPoints = 3;
  s.round = 5;
  return s;
}

// まず locale=3 が locale=5 の隣接かを確認
const isAdjacent = map.isAdjacent(TOKEN_LOCALE, ENEMY_ADJ);
console.log(`\nℹ️  locale${TOKEN_LOCALE}↔locale${ENEMY_ADJ} 隣接: ${isAdjacent}`);

if (!isAdjacent) {
  console.log('⚠️  テスト設定エラー: ENEMY_ADJ が TOKEN_LOCALE の隣接ではありません。');
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════
// テスト 1: 基本ケース — 敵が現在占拠 → トークン除去（既存動作）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 1: 敵が現在占拠 → トークン除去 ═══');
{
  const state = baseState();
  state.moraleTokens = [{ side: 'france', localeId: TOKEN_LOCALE }];
  state.morale.france.uncommitted = 0;
  // Austria が TOKEN_LOCALE を占拠
  state.pieces['AU-INF-1'] = {
    id: 'AU-INF-1', side: 'austria', type: 'infantry',
    strength: 2, maxStrength: 2, disordered: false, faceUp: false,
    localeId: TOKEN_LOCALE, position: 'reserve', actedThisTurn: false,
  };

  const result = moraleCleanup('austria', 5, state);
  expect('敵現在占拠ロケールのトークンは除去される',
    result.moraleTokens.filter(t => t.side === 'france' && t.localeId === TOKEN_LOCALE).length, 0);
  // uncommitted には戻らない（除去されたので）
  expect('除去されたトークンは uncommitted に戻らない',
    result.morale.france.uncommitted, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 2: 新ルール — 最後に敵がいた（現在は空だが隣接に敵あり）→ トークン除去
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 2: 最後に敵がいた（現在空 + 隣接に敵）→ トークン除去 ═══');
{
  const state = baseState();
  // TOKEN_LOCALE にフランスのトークン
  // TOKEN_LOCALE は現在空だが最後にいたのはオーストリア
  // ENEMY_ADJ にオーストリアがいる（隣接敵あり → 「隣接なし → return」は発動しない）
  state.moraleTokens = [{ side: 'france', localeId: TOKEN_LOCALE }];
  state.morale.france.uncommitted = 0;
  state.localeLastOccupant = { [TOKEN_LOCALE]: 'austria' };
  state.pieces['AU-INF-1'] = {
    id: 'AU-INF-1', side: 'austria', type: 'infantry',
    strength: 2, maxStrength: 2, disordered: false, faceUp: false,
    localeId: ENEMY_ADJ, position: 'reserve', actedThisTurn: false,
  };

  const result = moraleCleanup('austria', 5, state);
  expect('最後に敵がいたロケール（隣接敵あり）のトークンは除去される',
    result.moraleTokens.filter(t => t.side === 'france' && t.localeId === TOKEN_LOCALE).length, 0);
  expect('除去されたトークンは uncommitted に戻らない',
    result.morale.france.uncommitted, 0);
}

// ════════════════════════════════════════════════════════════════
// テスト 3: 最後にいたのは友軍（現在空 + 隣接に敵） → 除去しない（マップ上に残る）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 3: 最後に友軍がいた（現在空 + 隣接に敵）→ トークン残る ═══');
{
  const state = baseState();
  state.moraleTokens = [{ side: 'france', localeId: TOKEN_LOCALE }];
  state.morale.france.uncommitted = 0;
  state.localeLastOccupant = { [TOKEN_LOCALE]: 'france' }; // 最後の占拠者はフランス（友軍）
  state.pieces['AU-INF-1'] = {
    id: 'AU-INF-1', side: 'austria', type: 'infantry',
    strength: 2, maxStrength: 2, disordered: false, faceUp: false,
    localeId: ENEMY_ADJ, position: 'reserve', actedThisTurn: false,
  };

  const result = moraleCleanup('austria', 5, state);
  // TOKEN_LOCALE は空だが最後の占拠者はフランス（友軍）なので除去しない
  // ただし隣接に敵がいるので unmcommitted にも返還しない → マップ上に残る
  expect('最後に友軍がいたロケールのトークンはマップ上に残る',
    result.moraleTokens.filter(t => t.side === 'france' && t.localeId === TOKEN_LOCALE).length, 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 4: 現在友軍が占拠（最後に敵がいた記録あり）→ 除去しない
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 4: 現在友軍が占拠（lastOccupant=敵）→ 除去しない ═══');
{
  const state = baseState();
  state.moraleTokens = [{ side: 'france', localeId: TOKEN_LOCALE }];
  state.morale.france.uncommitted = 0;
  state.localeLastOccupant = { [TOKEN_LOCALE]: 'austria' }; // 古い記録（今はフランスが奪還）
  // フランスが現在 TOKEN_LOCALE を占拠
  state.pieces['FR-INF-1'] = {
    id: 'FR-INF-1', side: 'france', type: 'infantry',
    strength: 2, maxStrength: 2, disordered: false, faceUp: false,
    localeId: TOKEN_LOCALE, position: 'reserve', actedThisTurn: false,
  };
  // ENEMY_ADJ にオーストリアがいる（隣接敵あり → uncommitted への返還も発生しない）
  state.pieces['AU-INF-1'] = {
    id: 'AU-INF-1', side: 'austria', type: 'infantry',
    strength: 2, maxStrength: 2, disordered: false, faceUp: false,
    localeId: ENEMY_ADJ, position: 'reserve', actedThisTurn: false,
  };

  const result = moraleCleanup('austria', 5, state);
  // occupant = france (friendly) → 除去しない
  // hasEnemyNeighbor = true (ENEMY_ADJ にオーストリア) → return にもならない
  expect('現在友軍が占拠していればトークンは除去されない（マップ上に残る）',
    result.moraleTokens.filter(t => t.side === 'france' && t.localeId === TOKEN_LOCALE).length, 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 5: 占拠履歴なし（現在空 + 隣接に敵） → 除去しない（マップ上に残る）
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 5: 占拠履歴なし（現在空 + 隣接に敵）→ トークン残る ═══');
{
  const state = baseState();
  state.moraleTokens = [{ side: 'france', localeId: TOKEN_LOCALE }];
  state.morale.france.uncommitted = 0;
  state.localeLastOccupant = {}; // 履歴なし
  state.pieces['AU-INF-1'] = {
    id: 'AU-INF-1', side: 'austria', type: 'infantry',
    strength: 2, maxStrength: 2, disordered: false, faceUp: false,
    localeId: ENEMY_ADJ, position: 'reserve', actedThisTurn: false,
  };

  const result = moraleCleanup('austria', 5, state);
  // lastOccupant は unknown → 除去しない（隣接敵あり → return にもならない）
  expect('占拠履歴なしのロケールのトークンは除去されない',
    result.moraleTokens.filter(t => t.side === 'france' && t.localeId === TOKEN_LOCALE).length, 1);
}

// ════════════════════════════════════════════════════════════════
// テスト 6: オーストリアトークン + 最後にフランスがいた → 除去
// ════════════════════════════════════════════════════════════════
console.log('\n═══ Test 6: オーストリアのトークン + 最後にフランスがいた → 除去 ═══');
{
  const state = baseState();
  state.activePlayer = 'france';
  // ENEMY_ADJ(3) にオーストリアのトークン
  // ENEMY_ADJ は現在空、最後にいたのはフランス
  state.moraleTokens = [{ side: 'austria', localeId: ENEMY_ADJ }];
  state.morale.austria.uncommitted = 0;
  state.localeLastOccupant = { [ENEMY_ADJ]: 'france' };
  // TOKEN_LOCALE(5) にフランスがいる → ENEMY_ADJ の隣接に敵（フランス）あり
  state.pieces['FR-INF-1'] = {
    id: 'FR-INF-1', side: 'france', type: 'infantry',
    strength: 2, maxStrength: 2, disordered: false, faceUp: false,
    localeId: TOKEN_LOCALE, position: 'reserve', actedThisTurn: false,
  };

  const result = moraleCleanup('france', 5, state);
  expect('最後に敵がいたロケールのオーストリアトークンも除去される',
    result.moraleTokens.filter(t => t.side === 'austria' && t.localeId === ENEMY_ADJ).length, 0);
  expect('除去されたトークンは uncommitted に戻らない',
    result.morale.austria.uncommitted, 0);
}

// ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`結果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
