'use strict';

/**
 * GameState.js
 * ゲーム状態の定義・生成・シリアライズ
 *
 * サーバーサイドで唯一の正（Authoritative）な状態として扱う。
 * 状態は常にイミュータブルに更新する（cloneState を使う）。
 */

const scenarios = require('../../data/scenarios.json');
const pieceDefs = require('../../data/pieces.json');

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const SIDES = Object.freeze({ FRANCE: 'france', AUSTRIA: 'austria' });

const PHASES = Object.freeze({
  MORALE_UPDATE:      'morale_update',
  APPROACH_CLEANUP:   'approach_cleanup',
  ACTION:             'action',
  MORALE_CLEANUP:     'morale_cleanup',
});

const PIECE_TYPES = Object.freeze({
  INFANTRY:  'infantry',
  CAVALRY:   'cavalry',
  ARTILLERY: 'artillery',
});

// インタラプションの種類
const INTERRUPTION = Object.freeze({
  DEFENSE_RESPONSE:       'defense_response',       // 急襲: 防御対応
  ASSAULT_DEF_LEADERS:    'assault_def_leaders',    // 突撃①: 防御先導駒
  ASSAULT_ATK_LEADERS:    'assault_atk_leaders',    // 突撃②: 攻撃先導駒
  ASSAULT_DEF_ARTILLERY:  'assault_def_artillery',  // 突撃③: 防御砲撃
  ASSAULT_COUNTER:        'assault_counter',         // 突撃④: カウンター攻撃
  ASSAULT_REDUCTIONS:     'assault_reductions',      // 突撃⑤: 戦力減少割振り
  BOMBARDMENT_REDUCTION:  'bombardment_reduction',   // 砲撃完遂: 減少駒選択
  RETREAT_DESTINATION:    'retreat_destination',     // 退却先選択
  ATTACKER_APPROACH:      'attacker_approach',       // 急襲後: 攻撃側アプローチ移動オプション
  MORALE_TOKEN_REMOVAL:   'morale_token_removal',    // 士気トークン除去: 相手が対象を選ぶ
  FRANCE_MORALE_RECOVERY: 'france_morale_recovery',  // フランス士気回収: 1トークン返還
});

// ---------------------------------------------------------------------------
// 状態生成
// ---------------------------------------------------------------------------

/**
 * ゲーム開始時の初期状態を生成する。
 * セットアップフェーズ（駒の配置）はこの後に別途行う。
 * @returns {GameState}
 */
function createInitialState() {
  const initialMorale = scenarios.initialMorale;

  return {
    // --- ラウンド・ターン管理 ---
    round: 1,                        // 1〜16
    activePlayer: SIDES.AUSTRIA,     // 先攻はオーストリア
    phase: PHASES.MORALE_UPDATE,

    // --- 制御トークン ---
    // 通常は activePlayer が制御権を持つ。
    // インタラプション中は相手が一時的に制御権を持つ。
    controlToken: {
      holder: SIDES.AUSTRIA,         // 現在制御権を持つプレイヤー
      reason: 'active_player',       // 'active_player' | インタラプション種別
    },

    // --- インタラプション ---
    // null でなければ相手プレイヤーの応答待ち。
    pendingInterruption: null,
    // pendingInterruption の構造:
    // {
    //   type: INTERRUPTION.*,
    //   waitingFor: 'france' | 'austria',
    //   context: { ... }  // 戦闘ごとの文脈データ
    // }

    // --- 司令ポイント ---
    commandPoints: 3,

    // --- 士気 ---
    morale: {
      france: {
        uncommitted: initialMorale.france.uncommitted,
        total: initialMorale.france.total,
        // mapTokens は moraleTokens 配列で管理（ロケール単位）
      },
      austria: {
        uncommitted: initialMorale.austria.uncommitted,
        total: initialMorale.austria.total,
      },
    },

    // マップ上に投入された士気トークン
    // [ { side, localeId }, ... ]
    moraleTokens: [],

    // --- 駒の状態 ---
    // キー: pieceId, 値: PieceState
    pieces: {},

    // --- 砲撃の予約 ---
    // 砲撃は宣言ターンと完遂ターンが異なる
    pendingBombardment: null,
    // { artilleryId, targetLocaleId, defenseApproachIdx, declaredRound }

    // --- 交通制限カウンター（横断ごと・このターン） ---
    // キー: crossingId, 値: [ { pieceId, steps } ]
    crossingTraffic: {},

    // --- このターン移動済みのアクション記録 ---
    // 同一ターンに2つのアクションを取った駒を追跡
    actedPieceIds: new Set(),

    // --- このターンのマップ入場数 ---
    entriesThisTurn: 0,

    // --- 入場直後で行軍可能な駒 ---
    // { [pieceId]: remainingSteps }  ターン開始時にリセット
    // 入場後に道路行軍を完了するか、ターンが終わるまで actedPieceIds に入らない
    enteredThisTurn: {},

    // --- このターンに道路行軍した入場駒の数 ---
    // 0回目→2ステップ、1回目→1ステップ、2回目以降→行軍不可
    roadMarchUsedCount: 0,

    // --- このターンに投入した士気トークン記録 ---
    // フランス回収時に「このターン置いたもの」を除外するために使う
    // [ { side, localeId }, ... ]  ターン開始時にリセット
    moraleTokensPlacedThisTurn: [],

    // --- 直前の相手ターン中に投入されたフランストークン ---
    // FRANCE_MORALE_RECOVERY 時に「直前のオーストリアターンに置かれたもの」を除外するために使う
    // [ { side, localeId }, ... ]  オーストリアターン終了時に更新
    moraleTokensPlacedByEnemyLastTurn: [],

    // --- 突撃敗北後のブロック済みアプローチ ---
    // [ { localeId, edgeIdx }, ... ]  ターン開始時にリセット
    // 同一ターン中に同じアプローチを通じて攻撃・行軍不可
    blockedApproachesAfterAssault: [],

    // --- 突撃勝利後の道路行軍禁止ロケール ---
    // [ localeId, ... ]  ターン開始時にリセット
    // 突撃に勝利した場合、そのターン中は元の防御側ロケールへの道路行軍不可
    roadMarchBlockedLocales: [],

    // --- このターンに急襲したアプローチの記録 ---
    // [ { localeId, edgeIdx }, ... ]  ターン開始時にリセット
    // 2トークン条件「最初の急襲」チェック用
    raidHistoryThisTurn: [],

    // --- このターンに道路行軍急襲に使った横断IDの記録 ---
    // [ canonicalEdgeId, ... ]  ターン開始時にリセット
    // 同一横断を道路行軍急襲に2回以上使用禁止
    roadMarchRaidCrossings: [],

    // --- 継続行軍資格のある騎兵 ---
    // { [pieceId]: { fromLocaleId: number | null } }  ターン開始時にリセット
    // 道路行軍後: fromLocaleId = 出発ロケール、悪路行軍後: fromLocaleId = null
    continuationEligiblePieces: {},

    // --- ロケールの最後の占拠側 ---
    // { [localeId]: side }  ゲーム全体を通じて維持（リセットなし）
    // 士気クリーンアップで「最後に敵がいた」条件に使用
    localeLastOccupant: {},

    // --- 未処理の士気マップトークン除去 ---
    // reduceMorale でuncommitted不足の場合に積む → 相手がトークンを選んで除去するインタラプション
    // [ { side, amount }, ... ]
    pendingMoraleRemovals: [],

    // --- ゲームログ ---
    log: [],
  };
}

/**
 * 駒の初期状態を生成する。
 * @param {string} pieceId
 * @param {object} def - pieces.json の定義
 * @param {boolean} disordered - フランス軍は6AMで混乱
 * @returns {PieceState}
 */
function createPieceState(pieceId, def, disordered = false, entryArea = null) {
  return {
    id: pieceId,
    side: pieceId.startsWith('FR') ? SIDES.FRANCE : SIDES.AUSTRIA,
    type: def.type,
    maxStrength: def.maxStrength,
    strength: def.maxStrength,
    faceUp: false,         // 初期は裏向き
    disordered,
    localeId: null,        // セットアップ時に設定
    // position: 'reserve' | 'approach_0' | 'approach_1' | ... | 'approach_N'
    position: 'reserve',
    actedThisTurn: false,
    entryArea,             // フランス増援の進入可能ラウンド区分（null = 増援なし）
  };
}

/**
 * すべてのフランス駒を混乱状態で生成して初期状態にセットする。
 * （6AMルール: フランス軍全駒が混乱）
 * @param {GameState} state
 * @returns {GameState}
 */
function initializePieces(state) {
  const next = cloneState(state);

  // --- オーストリア全駒：オフマップ待機（localeId: null）---
  for (const def of pieceDefs.austria.setup) {
    next.pieces[def.id] = createPieceState(def.id, def, false);
  }

  // --- フランス増援：オフマップ待機（localeId: null）、時間帯をランダムシャッフル ---
  // 全9駒をシャッフルし、シナリオ定義のスロット順（500→1100→1600）に割り当て
  const renfortIds = pieceDefs.france.renforts.map(d => d.id);
  for (let i = renfortIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [renfortIds[i], renfortIds[j]] = [renfortIds[j], renfortIds[i]];
  }
  let renfortIdx = 0;
  for (const slot of scenarios.reinforcements.france) {
    for (let c = 0; c < slot.count; c++) {
      const pieceId = renfortIds[renfortIdx++];
      const def = pieceDefs.france.renforts.find(d => d.id === pieceId);
      next.pieces[pieceId] = createPieceState(pieceId, def, true, slot.area);
    }
  }

  // --- フランス初期配置（auDébut）：ランダムにセットアップエリアへ配置 ---
  // シャッフル（Fisher-Yates）
  const auDebutIds = pieceDefs.france.auDebut.map(d => d.id);
  for (let i = auDebutIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [auDebutIds[i], auDebutIds[j]] = [auDebutIds[j], auDebutIds[i]];
  }

  // セットアップエリアに駒を割り当て
  let idx = 0;
  for (const slot of scenarios.franceAuDebutSetup) {
    for (let c = 0; c < slot.count; c++) {
      const pieceId = auDebutIds[idx++];
      const def = pieceDefs.france.auDebut.find(d => d.id === pieceId);
      const ps = createPieceState(pieceId, def, true); // 混乱状態（6AMルール）
      ps.localeId = slot.localeIdx;
      ps.position = 'reserve';
      ps.faceUp = false;
      next.pieces[pieceId] = ps;
    }
  }

  return next;
}

// ---------------------------------------------------------------------------
// イミュータブル更新ユーティリティ
// ---------------------------------------------------------------------------

/**
 * 状態をディープコピーする。
 * Set は Array に変換して復元する。
 * @param {GameState} state
 * @returns {GameState}
 */
function cloneState(state) {
  const raw = JSON.parse(JSON.stringify(state, (key, val) =>
    val instanceof Set ? { __type: 'Set', values: [...val] } : val
  ));
  // Set を復元
  if (raw.actedPieceIds && raw.actedPieceIds.__type === 'Set') {
    raw.actedPieceIds = new Set(raw.actedPieceIds.values);
  }
  return raw;
}

/**
 * 駒の状態を更新する（イミュータブル）。
 * @param {GameState} state
 * @param {string} pieceId
 * @param {object} patch
 * @returns {GameState}
 */
function updatePiece(state, pieceId, patch) {
  const next = cloneState(state);
  next.pieces[pieceId] = { ...next.pieces[pieceId], ...patch };
  return next;
}

/**
 * ゲームログにエントリを追加する（イミュータブル）。
 * @param {GameState} state
 * @param {string} message
 * @returns {GameState}
 */
function addLog(state, message) {
  const next = cloneState(state);
  next.log.push({ round: state.round, time: getRoundTime(state.round), message });
  return next;
}

// ---------------------------------------------------------------------------
// シリアライズ
// ---------------------------------------------------------------------------

/**
 * 状態を JSON シリアライズ可能な形式に変換する。
 * @param {GameState} state
 * @returns {object}
 */
function serialize(state) {
  return JSON.parse(JSON.stringify(state, (key, val) =>
    val instanceof Set ? [...val] : val
  ));
}

/**
 * serialize した形式から状態を復元する。
 * @param {object} raw
 * @returns {GameState}
 */
function deserialize(raw) {
  const state = JSON.parse(JSON.stringify(raw));
  // actedPieceIds は Set に復元
  if (Array.isArray(state.actedPieceIds)) {
    state.actedPieceIds = new Set(state.actedPieceIds);
  } else {
    state.actedPieceIds = new Set();
  }
  return state;
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/**
 * ラウンド番号を時刻文字列に変換する。
 * @param {number} round 1〜16
 * @returns {string}
 */
function getRoundTime(round) {
  const entry = scenarios.timeTrack.find(t => t.round === round);
  return entry ? entry.time : `Round ${round}`;
}

/**
 * 指定プレイヤーの総士気（未投入 + マップ上）を計算する。
 * @param {string} side
 * @param {GameState} state
 * @returns {number}
 */
function getTotalMorale(side, state) {
  const mapTokens = state.moraleTokens.filter(t => t.side === side).length;
  return state.morale[side].uncommitted + mapTokens;
}

/**
 * ターン開始時に司令ポイントをリセットする。
 * @param {GameState} state
 * @returns {GameState}
 */
function resetCommandPoints(state) {
  const next = cloneState(state);
  next.commandPoints = 3;
  next.actedPieceIds = new Set();
  next.crossingTraffic = {};
  next.entriesThisTurn = 0;
  next.enteredThisTurn = {};
  next.roadMarchUsedCount = 0;
  next.moraleTokensPlacedThisTurn = [];
  next.pendingMoraleRemovals = [];
  next.blockedApproachesAfterAssault = [];
  next.roadMarchBlockedLocales = [];
  next.raidHistoryThisTurn = [];
  next.roadMarchRaidCrossings = [];
  next.continuationEligiblePieces = {};
  // 砲撃予約は前のターンのものを引き継ぐ（完遂判定はTurnManagerで行う）
  return next;
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

module.exports = {
  SIDES,
  PHASES,
  PIECE_TYPES,
  INTERRUPTION,
  createInitialState,
  createPieceState,
  initializePieces,
  cloneState,
  updatePiece,
  addLog,
  serialize,
  deserialize,
  getRoundTime,
  getTotalMorale,
  resetCommandPoints,
};
