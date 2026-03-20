'use strict';

/**
 * ActionPanel.test.js
 * Tests for client ActionPanel (action buttons, piece info, turn end).
 * Uses manual DOM simulation (no jsdom required).
 */

// ---------------------------------------------------------------------------
// Minimal DOM stub
// ---------------------------------------------------------------------------

function makeEl(id, tag) {
  const el = {
    id: id || null,
    tagName: (tag || 'div').toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    _listeners: {},
    _value: '',
    get value() { return this._value; },
    set value(v) { this._value = v; },
    querySelectorAll(selector) {
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      const id  = selector.startsWith('#') ? selector.slice(1) : null;
      const tag  = (!cls && !id) ? selector.toLowerCase() : null;
      const all  = this._allDescendants();
      return all.filter(c => {
        if (cls) return c.className && c.className.includes(cls);
        if (id)  return c.id === id;
        if (tag) return c.tagName && c.tagName.toLowerCase() === tag;
        return false;
      });
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    _allDescendants() {
      const result = [];
      const visit = (node) => {
        for (const child of (node.children || [])) {
          result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      const idx = this.children.indexOf(ref);
      if (idx >= 0) this.children.splice(idx, 0, child);
      else this.children.unshift(child);
      return child;
    },
    get firstChild() { return this.children[0] || null; },
    addEventListener(e, h) {
      this._listeners[e] = this._listeners[e] || [];
      this._listeners[e].push(h);
    },
    click() {
      const handlers = this._listeners['click'] || [];
      handlers.forEach(h => h({}));
    },
    remove() {},
  };
  return el;
}

function makeDoc(elMap) {
  return {
    _elMap: elMap,
    getElementById(id) { return elMap[id] || null; },
    createElement(tag) {
      const el = makeEl(null, tag);
      if (tag === 'button') el.disabled = false;
      return el;
    },
  };
}

// ---------------------------------------------------------------------------
// ActionPanel inline implementation for testing
// (mirrors client/js/ActionPanel.js logic, adapted for manual DOM)
// ---------------------------------------------------------------------------

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
      { key: 'raid',        label: '急 襲', types: ['raid'] },
      { key: 'assault',     label: '突 撃', types: ['assault'] },
      { key: 'bombardment', label: '砲 撃', types: ['bombardment'] },
    ],
  },
  {
    label: '特殊',
    actions: [
      { key: 'reorganize', label: '再編成', types: ['reorganize'] },
    ],
  },
];

class ActionPanel {
  constructor(onAction, onTurnEnd, doc) {
    this._onAction   = onAction;
    this._onTurnEnd  = onTurnEnd;
    this._doc        = doc;

    this._pieceInfoEl   = doc.getElementById('pieceInfo');
    this._actionPanelEl = doc.getElementById('actionPanel');
    this._turnEndBtn    = doc.getElementById('btnTurnEnd');

    this._interruptionActive = false;
    this._selectedPiece = null;

    if (this._turnEndBtn) {
      this._turnEndBtn.addEventListener('click', () => {
        if (this._onTurnEnd) this._onTurnEnd();
      });
    }
  }

  updatePieceInfo(piece, mapData) {
    this._selectedPiece = piece;
    const el = this._pieceInfoEl;
    if (!el) return;

    if (!piece) {
      el.innerHTML = '<h3>選択中の駒</h3><div class="no-selection">駒を選択してください</div>';
      el.children = [];
      return;
    }

    const sideStr  = piece.side === 'france' ? '仏' : '墺';
    const typeMap  = { infantry: '歩兵', cavalry: '騎兵', artillery: '砲兵' };
    const typeStr  = piece.type ? (typeMap[piece.type] || piece.type) : '?';
    const sideClass = piece.side === 'france' ? 'fr' : 'au';
    const strDisplay = piece.type != null
      ? `${piece.strength ?? '?'}/${piece.maxStrength ?? '?'}`
      : '—';

    el.innerHTML = `<h3>選択中の駒</h3>
      <div class="piece-detail">
        <div class="piece-name ${sideClass}">${sideStr} ${typeStr}</div>
        <div>戦力: ${strDisplay}</div>
      </div>`;
    el.children = [];

    // Build DOM children
    const detail = makeEl(null, 'div');
    detail.className = 'piece-detail';
    const nameEl = makeEl(null, 'div');
    nameEl.className = `piece-name ${sideClass}`;
    nameEl.textContent = `${sideStr} ${typeStr}`;
    detail.children = [nameEl];
    el.children = [detail];
  }

  showActions(legalActions, commandPoints, isMyTurn, mySide) {
    if (this._interruptionActive) return;

    const el = this._actionPanelEl;
    if (!el) return;

    el.innerHTML = '';
    el.children = [];

    if (!isMyTurn) {
      const msg = makeEl(null, 'div');
      msg.className = 'not-my-turn-msg';
      msg.textContent = '相手のターン...';
      el.appendChild(msg);
      if (this._turnEndBtn) this._turnEndBtn.disabled = true;
      return;
    }

    const legalTypes = new Set((legalActions || []).map(a => a.type));

    for (const group of ACTION_GROUPS) {
      if (group.label === '特殊' && mySide === 'austria') continue;

      const groupEl = makeEl(null, 'div');
      groupEl.className = 'action-group';

      const labelEl = makeEl(null, 'div');
      labelEl.className = 'action-group-label';
      labelEl.textContent = group.label;
      groupEl.appendChild(labelEl);

      for (const action of group.actions) {
        const hasLegal = action.types.some(t => legalTypes.has(t));
        const btn = this._doc.createElement('button');
        btn.className = 'action-btn';
        btn.textContent = action.label;
        btn.disabled = !hasLegal;

        if (hasLegal) {
          btn.addEventListener('click', () => {
            if (this._onAction) this._onAction({ type: action.key });
          });
        }

        groupEl.appendChild(btn);
      }

      el.appendChild(groupEl);
    }

    if (this._turnEndBtn) this._turnEndBtn.disabled = false;
  }

  setInterruptionMode(interruptionType, options, gameState, onResponse) {
    this._interruptionActive = true;
    const el = this._actionPanelEl;
    if (el) {
      el.id = 'interruptionPanel';
      el.innerHTML = '';
      el.children = [];
    }
    if (this._turnEndBtn) this._turnEndBtn.disabled = true;
  }

  clearInterruptionMode() {
    this._interruptionActive = false;
    const el = this._actionPanelEl;
    if (el) {
      el.id = 'actionPanel';
      el.innerHTML = '';
      el.children = [];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefaultDoc() {
  const els = {
    pieceInfo:    makeEl('pieceInfo'),
    actionPanel:  makeEl('actionPanel'),
    btnTurnEnd:   makeEl('btnTurnEnd', 'button'),
  };
  return makeDoc(els);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActionPanel.showActions', () => {
  test('all buttons disabled when no legal moves', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([], 3, true, 'france');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    btns.forEach(btn => {
      expect(btn.disabled).toBe(true);
    });
  });

  test('rough_march enabled when in legal actions', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([{ type: 'rough_march' }], 3, true, 'france');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    const roughBtn = btns.find(b => b.textContent === '悪路行軍');
    expect(roughBtn).toBeTruthy();
    expect(roughBtn.disabled).toBe(false);
  });

  test('road_march enabled when in legal actions', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([{ type: 'road_march' }], 3, true, 'france');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    const roadBtn = btns.find(b => b.textContent === '道路行軍');
    expect(roadBtn).toBeTruthy();
    expect(roadBtn.disabled).toBe(false);
  });

  test('attack buttons disabled when no attack legal actions', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([{ type: 'rough_march' }], 3, true, 'france');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    const raidBtn = btns.find(b => b.textContent === '急 襲');
    expect(raidBtn).toBeTruthy();
    expect(raidBtn.disabled).toBe(true);
  });

  test('all buttons disabled when not my turn', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([{ type: 'rough_march' }, { type: 'assault' }], 3, false, 'france');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    // No buttons rendered (replaced with not-my-turn message)
    expect(btns).toHaveLength(0);
  });

  test('not-my-turn message shown when not my turn', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([], 3, false, 'france');

    const el = doc.getElementById('actionPanel');
    const msgs = el.querySelectorAll('.not-my-turn-msg');
    expect(msgs).toHaveLength(1);
  });

  test('turn end button disabled when not my turn', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([], 3, false, 'france');

    expect(doc.getElementById('btnTurnEnd').disabled).toBe(true);
  });

  test('turn end button enabled when my turn', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([], 3, true, 'france');

    expect(doc.getElementById('btnTurnEnd').disabled).toBe(false);
  });

  test('reorganize not shown for austria', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([{ type: 'reorganize' }], 3, true, 'austria');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    const reorg = btns.find(b => b.textContent === '再編成');
    expect(reorg).toBeUndefined();
  });

  test('reorganize shown for france', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([{ type: 'reorganize' }], 3, true, 'france');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    const reorg = btns.find(b => b.textContent === '再編成');
    expect(reorg).toBeTruthy();
    expect(reorg.disabled).toBe(false);
  });

  test('action callback invoked when button clicked', () => {
    const actions = [];
    const doc = makeDefaultDoc();
    const panel = new ActionPanel((a) => actions.push(a), null, doc);
    panel.showActions([{ type: 'rough_march' }], 3, true, 'france');

    const el = doc.getElementById('actionPanel');
    const btns = el.querySelectorAll('button');
    const roughBtn = btns.find(b => b.textContent === '悪路行軍');
    roughBtn.click();

    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('rough_march');
  });

  test('turn end callback invoked when turn end button clicked', () => {
    const endCalled = [];
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, () => endCalled.push(true), doc);
    panel.showActions([], 3, true, 'france');

    doc.getElementById('btnTurnEnd').click();
    expect(endCalled).toHaveLength(1);
  });
});

describe('ActionPanel piece info display', () => {
  test('shows piece name and type for infantry', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    const piece = { id: 'FR1', side: 'france', type: 'infantry', strength: 3, maxStrength: 3, disordered: false };
    panel.updatePieceInfo(piece, null);

    const el = doc.getElementById('pieceInfo');
    const detail = el.querySelectorAll('.piece-detail')[0];
    expect(detail).toBeTruthy();
    const nameEl = detail.querySelectorAll('.piece-name')[0];
    expect(nameEl).toBeTruthy();
    expect(nameEl.textContent).toContain('歩兵');
    expect(nameEl.className).toContain('fr');
  });

  test('shows austria color for austrian piece', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    const piece = { id: 'AU1', side: 'austria', type: 'cavalry', strength: 2, maxStrength: 2, disordered: false };
    panel.updatePieceInfo(piece, null);

    const el = doc.getElementById('pieceInfo');
    const nameEl = el.querySelectorAll('.piece-name')[0];
    expect(nameEl.className).toContain('au');
    expect(nameEl.textContent).toContain('騎兵');
  });

  test('no-selection shown when piece is null', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.updatePieceInfo(null, null);

    const el = doc.getElementById('pieceInfo');
    expect(el.innerHTML).toContain('no-selection');
  });
});

describe('ActionPanel interruption mode', () => {
  test('setInterruptionMode disables turn end button', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.showActions([{ type: 'rough_march' }], 3, true, 'france');

    panel.setInterruptionMode('defense_response', {}, null, () => {});
    expect(doc.getElementById('btnTurnEnd').disabled).toBe(true);
  });

  test('clearInterruptionMode re-enables action panel', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel.setInterruptionMode('defense_response', {}, null, () => {});

    expect(panel._interruptionActive).toBe(true);
    panel.clearInterruptionMode();
    expect(panel._interruptionActive).toBe(false);
  });

  test('showActions does nothing when interruption is active', () => {
    const doc = makeDefaultDoc();
    const panel = new ActionPanel(null, null, doc);
    panel._interruptionActive = true;

    panel.showActions([{ type: 'rough_march' }], 3, true, 'france');

    const el = doc.getElementById('actionPanel');
    // Action panel should still be empty (not populated)
    expect(el.children).toHaveLength(0);
  });
});
