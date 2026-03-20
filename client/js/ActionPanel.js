/**
 * ActionPanel.js
 * Right sidebar: piece info + action buttons + interruption mode.
 */

import CombatDialog from './CombatDialog.js';

// Action definitions
const ACTION_GROUPS = [
  {
    label: '行軍',
    actions: [
      { key: 'rough_march',  label: '悪路行軍', types: ['rough_march'] },
      { key: 'road_march',   label: '道路行軍', types: ['road_march'] },
    ],
  },
  {
    label: '攻撃',
    actions: [
      { key: 'raid',         label: '急 襲', types: ['raid'] },
      { key: 'assault',      label: '突 撃', types: ['assault'] },
      { key: 'bombardment',  label: '砲 撃', types: ['bombardment'] },
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
            if (this._onAction) {
              this._onAction({ type: action.key });
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
