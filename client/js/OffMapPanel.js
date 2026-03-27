/**
 * OffMapPanel.js
 * オーストリアのマップ外待機駒パネル。
 * サイドバーに常時表示し、入場アクションボタンを提供する。
 */

// 砲兵入場可能ラウンド（7AM = round 2）
const ARTILLERY_ENTRY_MIN_ROUND = 2;
const MAX_ENTRIES_PER_TURN = 4;

// 駒タイプの定義（表示順）
const PIECE_GROUPS = [
  { type: 'infantry',  maxStrength: 3, label: 'INF×3', imgSrc: '/assets/images/AUINF3.png' },
  { type: 'infantry',  maxStrength: 2, label: 'INF×2', imgSrc: '/assets/images/AUINF2.png' },
  { type: 'cavalry',   maxStrength: 2, label: 'CAV×2', imgSrc: '/assets/images/AUCAV2.png' },
  { type: 'artillery', maxStrength: 1, label: 'ART×1', imgSrc: '/assets/images/AUART1.png' },
];

// フランス増援スケジュール（scenarios.json と一致）
const FRANCE_ENTRY_SCHEDULE = {
  'renfort_500':  { time: '5:00AM',  round: 1  },
  'renfort_1100': { time: '11:00AM', round: 6  },
  'renfort_1600': { time: '4:00PM',  round: 11 },
};

// 駒タイプ日本語
const FR_TYPE_LABEL = { infantry: '歩兵', cavalry: '騎兵', artillery: '砲兵' };

export default class OffMapPanel {
  /**
   * @param {Document} doc
   */
  constructor(doc = document) {
    this._doc = doc;
    this._container = doc.getElementById('offMapPanel');
    this._rendered = false;
  }

  /**
   * ゲーム状態が更新されたときに呼ぶ。
   * @param {object|null} gameState - フルゲーム状態
   * @param {string|null} mySide - 'france' | 'austria'
   * @param {function} onEnter - コールバック(pieceId)
   */
  update(gameState, mySide, onEnter) {
    if (!this._container) return;
    if (!gameState) {
      this._container.style.display = 'none';
      return;
    }

    this._container.style.display = '';
    this._render(gameState, mySide, onEnter);
  }

  /**
   * パネルをレンダリングする。
   */
  _render(gameState, mySide, onEnter) {
    const doc = this._doc;
    const container = this._container;

    // マップ外のオーストリア駒を収集
    const offMapPieces = Object.values(gameState.pieces || {}).filter(
      p => p.side === 'austria' && p.localeId === null && p.strength > 0
    );

    // オーストリアの制御ターンかどうか
    const isAustriaTurn =
      gameState.activePlayer === 'austria' &&
      gameState.controlToken?.holder === 'austria' &&
      !gameState.pendingInterruption;

    const entriesThisTurn = gameState.entriesThisTurn ?? 0;
    const commandPoints = gameState.commandPoints ?? 0;
    const round = gameState.round ?? 1;

    // 次の入場コスト
    const nextCost = entriesThisTurn === 0 ? 0 : 1;
    const canEnterMore = isAustriaTurn &&
      entriesThisTurn < MAX_ENTRIES_PER_TURN &&
      nextCost <= commandPoints;

    // HTMLを構築
    let html = `<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">待機中の駒</div>`;

    if (offMapPieces.length === 0) {
      html += `<div style="color:#555;font-style:italic;font-size:11px;">待機駒なし</div>`;
    } else {
      for (const group of PIECE_GROUPS) {
        // このグループに該当する駒
        const matching = offMapPieces.filter(
          p => p.type === group.type && p.maxStrength === group.maxStrength
        );
        if (matching.length === 0) continue;

        const count = matching.length;
        const firstPiece = matching[0];

        // 砲兵の入場制限チェック
        const artilleryLocked = group.type === 'artillery' && round < ARTILLERY_ENTRY_MIN_ROUND;

        // ボタンの有効/無効
        const btnDisabled = !canEnterMore || artilleryLocked || (mySide !== 'austria');

        html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;">`;

        // 駒画像
        html += `<img src="${group.imgSrc}" alt="${group.label}"
          style="width:48px;height:16px;object-fit:contain;image-rendering:pixelated;"
          onerror="this.style.display='none'">`;

        // タイプラベル
        html += `<span style="flex:1;font-size:11px;color:#ccc;">${group.label}</span>`;

        // 個数バッジ
        html += `<span style="background:#0f3460;color:#4ecca3;font-size:10px;font-weight:bold;
          padding:1px 5px;border-radius:3px;min-width:18px;text-align:center;">${count}</span>`;

        // 入場ボタン
        html += `<button
          data-piece-id="${firstPiece.id}"
          ${btnDisabled ? 'disabled' : ''}
          style="padding:2px 6px;font-size:10px;background:${btnDisabled ? '#0a0f1e' : '#1a4a30'};
            border:1px solid ${btnDisabled ? '#1a4a80' : '#4ecca3'};
            border-radius:3px;color:${btnDisabled ? '#555' : '#4ecca3'};
            cursor:${btnDisabled ? 'not-allowed' : 'pointer'};
            opacity:${btnDisabled ? '0.45' : '1'};
            white-space:nowrap;">入場</button>`;

        // 砲兵制限メッセージ
        if (artilleryLocked) {
          html += `<span style="font-size:9px;color:#b8860b;margin-left:2px;">7AM以降</span>`;
        }

        html += `</div>`;
      }
    }

    // 入場残り枠の表示（オーストリアターン中のみ）
    if (isAustriaTurn && offMapPieces.length > 0) {
      const remaining = MAX_ENTRIES_PER_TURN - entriesThisTurn;
      html += `<div style="font-size:10px;color:#888;margin-top:4px;">
        入場枠: ${remaining}/${MAX_ENTRIES_PER_TURN} 残り　次コスト: 無料
      </div>`;
    }

    // ─────────────────────────────────────────
    // フランス増援セクション
    // ─────────────────────────────────────────
    const frenchOffMap = Object.values(gameState.pieces || {}).filter(
      p => p.side === 'france' && p.localeId === null
    );

    if (frenchOffMap.length > 0) {
      html += `<div style="border-top:1px solid #0f3460;margin:8px 0 6px 0;"></div>`;
      html += `<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">フランス増援</div>`;

      // entryArea でグループ化
      const byArea = {};
      for (const piece of frenchOffMap) {
        const area = piece.entryArea || 'unknown';
        if (!byArea[area]) byArea[area] = [];
        byArea[area].push(piece);
      }

      // スケジュール順にソート
      const sortedAreas = Object.keys(byArea).sort((a, b) => {
        const ra = FRANCE_ENTRY_SCHEDULE[a]?.round ?? 99;
        const rb = FRANCE_ENTRY_SCHEDULE[b]?.round ?? 99;
        return ra - rb;
      });

      for (const area of sortedAreas) {
        const schedule = FRANCE_ENTRY_SCHEDULE[area];
        const pieces = byArea[area];
        const timeLabel = schedule ? `${schedule.time}` : area;
        const entryRound = schedule?.round ?? 99;
        // 入場可能ラウンドに達しているか
        const isAvailable = round >= entryRound;
        const timeColor = isAvailable ? '#e94560' : '#4ecca3';

        html += `<div style="margin-bottom:6px;">`;
        html += `<div style="font-size:10px;font-weight:bold;color:${timeColor};margin-bottom:2px;">`
              + `${timeLabel}&nbsp;<span style="color:#666;">(R${entryRound})</span>`
              + `</div>`;

        // 全駒のtypeが見えるか（フランスプレイヤー / ソロ）
        const allVisible = pieces.every(p => p.type != null);
        if (allVisible) {
          // タイプ × 戦力 でグループ化して表示
          const typeGroups = {};
          for (const piece of pieces) {
            const key = `${piece.type}_${piece.maxStrength}`;
            if (!typeGroups[key]) {
              typeGroups[key] = { type: piece.type, maxStrength: piece.maxStrength, count: 0 };
            }
            typeGroups[key].count++;
          }
          for (const g of Object.values(typeGroups)) {
            const typeStr = FR_TYPE_LABEL[g.type] || g.type;
            html += `<div style="font-size:11px;color:#ccc;padding-left:8px;">`
                  + `▸ ${typeStr}×${g.maxStrength}&nbsp;`
                  + `<span style="color:#4ecca3;">×${g.count}</span>`
                  + `</div>`;
          }
        } else {
          // オーストリアプレイヤー: 種類不明・個数のみ表示
          html += `<div style="font-size:11px;color:#777;padding-left:8px;">`
                + `▸ ?&nbsp;<span style="color:#4ecca3;">×${pieces.length}</span>`
                + `</div>`;
        }

        html += `</div>`;
      }
    }

    container.innerHTML = html;

    // ボタンイベントを設定
    container.querySelectorAll('button[data-piece-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-piece-id');
        if (pid && onEnter) onEnter(pid);
      });
    });
  }
}
