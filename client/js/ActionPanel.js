/**
 * ActionPanel.js
 * Right sidebar: piece info + action buttons + interruption mode.
 */

import CombatDialog from './CombatDialog.js';

// Action definitions
const ACTION_GROUPS = [
  {
    label: '行軍 (マップをクリック)',
    actions: [
      { key: 'cross_country_march', label: '悪路行軍', types: ['cross_country_march', 'defensive_march'] },
      { key: 'road_march',          label: '道路行軍', types: ['road_march', 'continuation_march'] },
    ],
    mapSelectOnly: true, // clicking shows hint, does not send action
  },
  {
    label: '攻撃',
    actions: [
      { key: 'raid',               label: '急 襲', types: ['raid'] },
      { key: 'assault',            label: '突 撃', types: ['assault'] },
      { key: 'bombardment_declare', label: '砲 撃', types: ['bombardment_declare'] },
    ],
  },
  {
    label: '特殊',
    actions: [
      { key: 'reorganize',   label: '再編成', types: ['reorganize'] },
    ],
  },
];

export default class ActionPanel {
  /**
   * @param {function} onAction  - called with action object
   * @param {function} onTurnEnd - called when turn end button clicked
   */
  constructor(onAction, onTurnEnd) {
    this._onAction = onAction;
    this._onTurnEnd = onTurnEnd;

    this._pieceInfoEl = document.getElementById('pieceInfo');
    this._actionPanelEl = document.getElementById('actionPanel');
    this._turnEndBtn = document.getElementById('btnTurnEnd');

    this._combatDialog = new CombatDialog();
    this._interruptionActive = false;
    this._selectedPiece = null;

    if (this._turnEndBtn) {
      this._turnEndBtn.addEventListener('click', () => {
        if (this._onTurnEnd) this._onTurnEnd();
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Piece info
  // ---------------------------------------------------------------------------

  /**
   * Update the selected piece info panel.
   * @param {object|null} piece - piece state or null
   * @param {object|null} mapData - for locale name lookup
   */
  updatePieceInfo(piece, mapData) {
    this._selectedPiece = piece;
    const el = this._pieceInfoEl;
    if (!el) return;

    // Find the inner content area (after the h3)
    const content = el.querySelector('.piece-detail') || this._ensurePieceContent(el);

    if (!piece) {
      el.innerHTML = '<h3>選択中の駒</h3><div class="no-selection">駒を選択してください</div>';
      return;
    }

    const sideStr = piece.side === 'france' ? '仏' : '墺';
    const typeMap = { infantry: '歩兵', cavalry: '騎兵', artillery: '砲兵' };
    const typeStr = piece.type ? (typeMap[piece.type] || piece.type) : '?';
    const sideClass = piece.side === 'france' ? 'fr' : 'au';

    const localeName = this._getLocaleName(piece.localeId, mapData);
    const posStr = piece.position === 'reserve' ? 'リザーブ' :
                   piece.position ? `アプローチ ${piece.position.replace('approach_', '')}` : '—';

    const disorderedTag = piece.disordered
      ? '<span class="disordered-tag">混乱</span>'
      : '';

    const strDisplay = piece.type != null
      ? `${piece.strength ?? '?'}/${piece.maxStrength ?? '?'}`
      : '—';

    el.innerHTML = `
      <h3>選択中の駒</h3>
      <div class="piece-detail">
        <div class="piece-name ${sideClass}">${sideStr} ${typeStr}${disorderedTag}</div>
        <div>戦力: ${strDisplay}</div>
        <div>位置: ${localeName} / ${posStr}</div>
      </div>
    `;
  }

  _ensurePieceContent(el) {
    let div = el.querySelector('.piece-detail');
    if (!div) {
      div = document.createElement('div');
      div.className = 'piece-detail';
      el.appendChild(div);
    }
    return div;
  }

  _getLocaleName(localeId, mapData) {
    if (localeId == null) return '—';
    if (!mapData || !mapData.areas) return `ロケール ${localeId}`;
    const area = mapData.areas.find(a => a.idx === localeId || a.id === localeId);
    if (!area) return `ロケール ${localeId}`;
    return area.historicalName || area.name || `ロケール ${localeId}`;
  }

  // ---------------------------------------------------------------------------
  // Action buttons
  // ---------------------------------------------------------------------------

  /**
   * Show available action buttons.
   * @param {object[]} legalActions - array of legal action objects (with .type)
   * @param {number} commandPoints
   * @param {boolean} isMyTurn
   * @param {string|null} mySide
   */
  showActions(legalActions, commandPoints, isMyTurn, mySide) {
    if (this._interruptionActive) return;

    const el = this._actionPanelEl;
    if (!el) return;

    el.innerHTML = '';

    if (!isMyTurn) {
      const msg = document.createElement('div');
      msg.className = 'not-my-turn-msg';
      msg.textContent = '相手のターン...';
      el.appendChild(msg);
      if (this._turnEndBtn) this._turnEndBtn.disabled = true;
      return;
    }

    // Build set of available action types
    const legalTypes = new Set((legalActions || []).map(a => a.type));

    for (const group of ACTION_GROUPS) {
      // Skip reorganize for austria
      if (group.label === '特殊' && mySide === 'austria') continue;

      const groupEl = document.createElement('div');
      groupEl.className = 'action-group';

      const labelEl = document.createElement('div');
      labelEl.className = 'action-group-label';
      labelEl.textContent = group.label;
      groupEl.appendChild(labelEl);

      for (const action of group.actions) {
        const hasLegal = action.types.some(t => legalTypes.has(t));
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = action.label;
        btn.disabled = !hasLegal;

        if (hasLegal) {
          btn.addEventListener('click', () => {
            if (group.mapSelectOnly) {
              // March actions require destination — handled by map click
              if (this._onAction) this._onAction({ type: action.key, _mapSelect: true });
            } else {
              if (this._onAction) this._onAction({ type: action.key });
            }
          });
        }

        groupEl.appendChild(btn);
      }

      el.appendChild(groupEl);
    }

    // Enable turn end
    if (this._turnEndBtn) this._turnEndBtn.disabled = !isMyTurn;
  }

  // ---------------------------------------------------------------------------
  // 移動確認ダイアログ
  // ---------------------------------------------------------------------------

  /**
   * 移動確認ダイアログを表示する。
   * @param {object[]} actions - 同じ目的地への合法アクション（種別が複数の場合あり）
   * @param {number} fromLocaleId
   * @param {number} toLocaleId
   * @param {object|null} mapData
   * @param {function} onConfirm - 選択アクションを引数に呼ばれる
   * @param {function} onCancel
   */
  showMoveConfirmDialog(actions, fromLocaleId, toLocaleId, mapData, onConfirm, onCancel) {
    const el = this._actionPanelEl;
    if (!el) return;

    const fromName = this._getLocaleName(fromLocaleId, mapData);
    const toName   = this._getLocaleName(toLocaleId,   mapData);

    el.innerHTML = '';

    const title = document.createElement('div');
    title.style.cssText = 'color:#4ecca3;font-size:12px;font-weight:bold;margin-bottom:4px;';
    title.textContent = '移動確認';
    el.appendChild(title);

    const route = document.createElement('div');
    route.style.cssText = 'font-size:11px;color:#ccc;margin-bottom:8px;';
    route.textContent = `${fromName}（${fromLocaleId}）→ ${toName}（${toLocaleId}）`;
    el.appendChild(route);

    for (const action of actions) {
      let label;
      if (action.type === 'road_march') {
        label = action.isMajorRoadOnly ? '主要道路行軍' : '道路行軍（側道含む）';
      } else if (action.type === 'cross_country_march') {
        label = '悪路行軍';
      } else if (action.type === 'defensive_march') {
        label = '防御行軍';
      } else if (action.type === 'continuation_march') {
        label = '継続行軍';
      } else {
        label = action.type;
      }

      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.style.cssText = 'display:block;width:100%;margin-bottom:4px;text-align:left;';
      btn.textContent = `${label}  (${action.commandCost}CP)`;
      btn.addEventListener('click', () => onConfirm(action));
      el.appendChild(btn);
    }

    const btnCancel = document.createElement('button');
    btnCancel.className = 'action-btn';
    btnCancel.style.cssText = 'display:block;width:100%;background:#333;margin-top:4px;';
    btnCancel.textContent = 'キャンセル';
    btnCancel.addEventListener('click', () => { if (onCancel) onCancel(); });
    el.appendChild(btnCancel);
  }

  // ---------------------------------------------------------------------------
  // 再編成ダイアログ
  // ---------------------------------------------------------------------------

  showReorganizeDialog(reorganizeAction, gameState, mapData, onConfirm, onCancel) {
    const el = this._actionPanelEl;
    if (!el) return;

    const { disorderedPieceIds, localeId } = reorganizeAction;
    const pieces = gameState.pieces || {};
    const typeMap = { infantry: '歩兵', cavalry: '騎兵', artillery: '砲兵' };
    const localeName = this._getLocaleName(localeId, mapData);

    el.innerHTML = '';

    const title = document.createElement('div');
    title.style.cssText = 'color:#4ecca3;font-size:12px;font-weight:bold;margin-bottom:6px;';
    title.textContent = `再編成 — ${localeName}`;
    el.appendChild(title);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:10px;color:#aaa;margin-bottom:6px;';
    note.textContent = '以下の全駒を再編成します（一括のみ）:';
    el.appendChild(note);

    // 対象駒リスト（選択不可・表示のみ）
    for (const pid of disorderedPieceIds) {
      const piece = pieces[pid];
      if (!piece) continue;
      const row = document.createElement('div');
      row.style.cssText = 'padding:2px 0;font-size:11px;color:#ccc;';
      row.textContent = `▶ 仏 ${typeMap[piece.type] || piece.type} (戦力${piece.strength}/${piece.maxStrength})`;
      el.appendChild(row);
    }

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;';

    const cpCost = reorganizeAction.commandCost ?? disorderedPieceIds.length;
    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'action-btn';
    btnConfirm.textContent = `再編成実行 (${cpCost}CP)`;
    btnConfirm.addEventListener('click', () => onConfirm(disorderedPieceIds));

    const btnCancel = document.createElement('button');
    btnCancel.className = 'action-btn';
    btnCancel.style.background = '#333';
    btnCancel.textContent = 'キャンセル';
    btnCancel.addEventListener('click', () => { if (onCancel) onCancel(); });

    btnRow.appendChild(btnConfirm);
    btnRow.appendChild(btnCancel);
    el.appendChild(btnRow);
  }

  // ---------------------------------------------------------------------------
  // Interruption mode
  // ---------------------------------------------------------------------------

  /**
   * Switch to interruption response mode.
   * @param {string} interruptionType
   * @param {object} options
   * @param {object} gameState
   * @param {function} onResponse
   */
  setInterruptionMode(interruptionType, options, gameState, onResponse) {
    this._interruptionActive = true;

    const el = this._actionPanelEl;
    if (!el) return;

    el.innerHTML = '';
    el.id = 'interruptionPanel';

    // Dim canvas
    const canvas = document.getElementById('mapCanvas');
    if (canvas) canvas.classList.add('dimmed');

    // Disable turn end
    if (this._turnEndBtn) this._turnEndBtn.disabled = true;

    const dialog = this._combatDialog;
    const wrap = (fn) => (response) => {
      this.clearInterruptionMode();
      onResponse(response);
    };

    switch (interruptionType) {
      case 'defense_response':
        dialog.renderDefenseResponse(el, options, gameState, wrap(onResponse));
        break;
      case 'assault_def_leaders':
        dialog.renderAssaultDefLeaders(el, options, gameState, wrap(onResponse));
        break;
      case 'assault_atk_leaders':
        dialog.renderAssaultAtkLeaders(el, options, gameState, wrap(onResponse));
        break;
      case 'assault_def_artillery':
        dialog.renderAssaultDefArtillery(el, options, gameState, wrap(onResponse));
        break;
      case 'assault_counter':
        dialog.renderAssaultCounter(el, options, gameState, wrap(onResponse));
        break;
      case 'assault_reductions':
        dialog.renderAssaultReductions(el, options, gameState, wrap(onResponse));
        break;
      case 'bombardment_reduction':
        dialog.renderBombardmentReduction(el, options, gameState, wrap(onResponse));
        break;
      case 'retreat_destination':
        dialog.renderRetreatDestination(el, options, gameState, wrap(onResponse));
        break;
      default: {
        const msg = document.createElement('div');
        msg.className = 'interruption-title';
        msg.textContent = `不明なインタラプション: ${interruptionType}`;
        el.appendChild(msg);
        break;
      }
    }
  }

  /**
   * Return to normal action mode.
   */
  clearInterruptionMode() {
    this._interruptionActive = false;
    const el = this._actionPanelEl;
    if (el) {
      el.id = 'actionPanel';
      el.innerHTML = '';
    }

    // Un-dim canvas
    const canvas = document.getElementById('mapCanvas');
    if (canvas) canvas.classList.remove('dimmed');
  }
}
