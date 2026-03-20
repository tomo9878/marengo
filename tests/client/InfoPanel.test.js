'use strict';

/**
 * InfoPanel.test.js
 * Tests for client InfoPanel (header, morale, log).
 * Uses manual DOM simulation (no jsdom required).
 */

// ---------------------------------------------------------------------------
// Minimal DOM stub
// ---------------------------------------------------------------------------

function makeEl(id, tag) {
  return {
    id,
    tagName: (tag || 'div').toUpperCase(),
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    children: [],
    _listeners: {},
    querySelectorAll(selector) {
      // Simplified: return children matching className
      const cls = selector.replace('.', '');
      return this.children.filter(c => c.className.includes(cls));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      const idx = this.children.indexOf(ref);
      if (idx >= 0) {
        this.children.splice(idx, 0, child);
      } else {
        this.children.unshift(child);
      }
      return child;
    },
    firstChild: null,
    get firstChild() { return this.children[0] || null; },
    addEventListener(e, h) {
      this._listeners[e] = this._listeners[e] || [];
      this._listeners[e].push(h);
    },
  };
}

function makeDoc(elMap) {
  return {
    getElementById(id) { return elMap[id] || null; },
    createElement(tag) { return makeEl(null, tag); },
  };
}

// ---------------------------------------------------------------------------
// InfoPanel implementation (mirrors client/js/InfoPanel.js for testing)
// ---------------------------------------------------------------------------

const TIME_LABELS = [
  '6AM','7AM','8AM','9AM','10AM','11AM',
  '12PM','1PM','2PM','3PM','4PM','5PM',
  '6PM','7PM','8PM','9PM',
];

const MAX_LOG_ENTRIES = 20;

class InfoPanel {
  constructor(doc) {
    this._doc = doc;
    this._timeTrack     = doc.getElementById('timeTrack');
    this._roundInfo     = doc.getElementById('roundInfo');
    this._turnIndicator = doc.getElementById('turnIndicator');
    this._commandPoints = doc.getElementById('commandPoints');
    this._moraleBarFR   = doc.getElementById('moraleBarFR');
    this._moraleBarAU   = doc.getElementById('moraleBarAU');
    this._moraleNumFR   = doc.getElementById('moraleNumFR');
    this._moraleNumAU   = doc.getElementById('moraleNumAU');
    this._logPanel      = doc.getElementById('logPanel');

    this._buildTimeTrack();
  }

  _buildTimeTrack() {
    if (!this._timeTrack) return;
    this._timeTrack.innerHTML = '';
    this._timeTrack.children = [];
    for (let i = 0; i < TIME_LABELS.length; i++) {
      const span = this._doc.createElement('span');
      span.className = 'time-step';
      span.textContent = TIME_LABELS[i];
      span.dataset = { round: String(i + 1) };
      this._timeTrack.appendChild(span);
    }
  }

  updateHeader(gameState, mySide) {
    if (!gameState) return;

    const round  = gameState.round || 1;
    const holder = gameState.controlToken ? gameState.controlToken.holder : null;
    const cp     = gameState.commandPoints != null ? gameState.commandPoints : 3;

    if (this._timeTrack) {
      const steps = this._timeTrack.querySelectorAll('.time-step');
      steps.forEach((s) => {
        const isActive = Number(s.dataset.round) === round;
        if (isActive) {
          if (!s.className.includes('active')) s.className += ' active';
        } else {
          s.className = s.className.replace(' active', '').replace('active', '');
        }
      });
    }

    if (this._roundInfo) {
      this._roundInfo.textContent = `Round ${round}/16`;
    }

    if (this._turnIndicator) {
      const pending = gameState.pendingInterruption;
      const sideLabel = mySide === 'france' ? 'あなた(仏)' : 'あなた(墺)';

      if (pending) {
        if (pending.waitingFor === mySide) {
          this._turnIndicator.textContent = '応答待ち (あなた)';
          this._turnIndicator.className = 'waiting';
        } else {
          this._turnIndicator.textContent = '応答待ち (相手)';
          this._turnIndicator.className = 'opponent';
        }
      } else if (holder === mySide) {
        this._turnIndicator.textContent = `手番: ${sideLabel}`;
        this._turnIndicator.className = 'my-turn';
      } else {
        const oppLabel = mySide === 'france' ? '相手(墺)' : '相手(仏)';
        this._turnIndicator.textContent = `手番: ${oppLabel}`;
        this._turnIndicator.className = 'opponent';
      }
    }

    if (this._commandPoints) {
      const label = this._commandPoints.querySelector('.cp-label');
      this._commandPoints.innerHTML = '';
      this._commandPoints.children = [];
      if (label) {
        this._commandPoints.appendChild(label);
      } else {
        const lbl = this._doc.createElement('span');
        lbl.className = 'cp-label';
        lbl.textContent = '司令:';
        this._commandPoints.appendChild(lbl);
      }
      const maxCp = 3;
      for (let i = 0; i < maxCp; i++) {
        const dot = this._doc.createElement('span');
        dot.className = 'cp-dot' + (i < cp ? ' filled' : '');
        this._commandPoints.appendChild(dot);
      }
    }
  }

  updateMorale(gameState) {
    if (!gameState || !gameState.morale) return;

    const fr = gameState.morale.france;
    const au = gameState.morale.austria;

    const frTotal   = fr.total   || 14;
    const auTotal   = au.total   || 16;
    const frCurrent = fr.uncommitted != null ? fr.uncommitted : frTotal;
    const auCurrent = au.uncommitted != null ? au.uncommitted : auTotal;

    const frPct = frTotal > 0 ? Math.round((frCurrent / frTotal) * 100) : 0;
    const auPct = auTotal > 0 ? Math.round((auCurrent / auTotal) * 100) : 0;

    if (this._moraleBarFR) this._moraleBarFR.style.width = `${frPct}%`;
    if (this._moraleBarAU) this._moraleBarAU.style.width = `${auPct}%`;
    if (this._moraleNumFR) this._moraleNumFR.textContent = String(frCurrent);
    if (this._moraleNumAU) this._moraleNumAU.textContent = String(auCurrent);
  }

  addLog(message) {
    if (!this._logPanel) return;

    const entry = this._doc.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = message;

    const first = this._logPanel.firstChild;
    if (first) {
      this._logPanel.insertBefore(entry, first);
    } else {
      this._logPanel.appendChild(entry);
    }

    const entries = this._logPanel.querySelectorAll('.log-entry');
    if (entries.length > MAX_LOG_ENTRIES) {
      for (let i = MAX_LOG_ENTRIES; i < entries.length; i++) {
        const idx = this._logPanel.children.indexOf(entries[i]);
        if (idx >= 0) this._logPanel.children.splice(idx, 1);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDefaultDoc() {
  const els = {};
  const ids = [
    'timeTrack','roundInfo','turnIndicator','commandPoints',
    'moraleBarFR','moraleBarAU','moraleNumFR','moraleNumAU','logPanel',
  ];
  for (const id of ids) els[id] = makeEl(id);
  return makeDoc(els);
}

function makeGameState(overrides) {
  return Object.assign({
    round: 1,
    controlToken: { holder: 'france', reason: 'active_player' },
    commandPoints: 3,
    pendingInterruption: null,
    morale: {
      france: { uncommitted: 10, total: 14 },
      austria: { uncommitted: 12, total: 16 },
    },
  }, overrides);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InfoPanel.updateHeader', () => {
  test('round text updates correctly', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(makeGameState({ round: 5 }), 'france');
    expect(doc.getElementById('roundInfo').textContent).toBe('Round 5/16');
  });

  test('time track marks correct round as active', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(makeGameState({ round: 3 }), 'france');

    const steps = doc.getElementById('timeTrack').querySelectorAll('.time-step');
    const activeSteps = steps.filter(s => s.className.includes('active'));
    expect(activeSteps).toHaveLength(1);
    expect(Number(activeSteps[0].dataset.round)).toBe(3);
  });

  test('turn indicator shows my-turn when it is my turn', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(
      makeGameState({ controlToken: { holder: 'france', reason: 'active_player' } }),
      'france'
    );
    expect(doc.getElementById('turnIndicator').className).toBe('my-turn');
  });

  test('turn indicator shows opponent class when not my turn', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(
      makeGameState({ controlToken: { holder: 'austria', reason: 'active_player' } }),
      'france'
    );
    expect(doc.getElementById('turnIndicator').className).toBe('opponent');
  });

  test('turn indicator shows waiting when pending interruption for me', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(
      makeGameState({ pendingInterruption: { waitingFor: 'france', type: 'defense_response' } }),
      'france'
    );
    expect(doc.getElementById('turnIndicator').className).toBe('waiting');
  });

  test('command points: 3 filled dots for cp=3', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(makeGameState({ commandPoints: 3 }), 'france');

    const cpEl = doc.getElementById('commandPoints');
    const dots = cpEl.children.filter(c => c.className.includes('cp-dot'));
    const filled = dots.filter(c => c.className.includes('filled'));
    expect(dots).toHaveLength(3);
    expect(filled).toHaveLength(3);
  });

  test('command points: 1 filled dot for cp=1', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(makeGameState({ commandPoints: 1 }), 'france');

    const cpEl = doc.getElementById('commandPoints');
    const dots = cpEl.children.filter(c => c.className.includes('cp-dot'));
    const filled = dots.filter(c => c.className.includes('filled'));
    expect(dots).toHaveLength(3);
    expect(filled).toHaveLength(1);
  });

  test('command points: 0 filled dots for cp=0', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateHeader(makeGameState({ commandPoints: 0 }), 'france');

    const cpEl = doc.getElementById('commandPoints');
    const dots = cpEl.children.filter(c => c.className.includes('cp-dot'));
    const filled = dots.filter(c => c.className.includes('filled'));
    expect(filled).toHaveLength(0);
  });
});

describe('InfoPanel.updateMorale', () => {
  test('FR bar width reflects morale ratio', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateMorale(makeGameState({
      morale: {
        france: { uncommitted: 7, total: 14 },
        austria: { uncommitted: 16, total: 16 },
      },
    }));
    expect(doc.getElementById('moraleBarFR').style.width).toBe('50%');
  });

  test('AU bar width reflects morale ratio', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateMorale(makeGameState({
      morale: {
        france: { uncommitted: 14, total: 14 },
        austria: { uncommitted: 8, total: 16 },
      },
    }));
    expect(doc.getElementById('moraleBarAU').style.width).toBe('50%');
  });

  test('morale numbers are shown', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateMorale(makeGameState({
      morale: {
        france:  { uncommitted: 9,  total: 14 },
        austria: { uncommitted: 12, total: 16 },
      },
    }));
    expect(doc.getElementById('moraleNumFR').textContent).toBe('9');
    expect(doc.getElementById('moraleNumAU').textContent).toBe('12');
  });

  test('FR bar is 100% at full morale', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateMorale(makeGameState({
      morale: {
        france:  { uncommitted: 14, total: 14 },
        austria: { uncommitted: 16, total: 16 },
      },
    }));
    expect(doc.getElementById('moraleBarFR').style.width).toBe('100%');
  });

  test('bar is 0% when morale is 0', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.updateMorale(makeGameState({
      morale: {
        france:  { uncommitted: 0, total: 14 },
        austria: { uncommitted: 0, total: 16 },
      },
    }));
    expect(doc.getElementById('moraleBarFR').style.width).toBe('0%');
    expect(doc.getElementById('moraleBarAU').style.width).toBe('0%');
  });
});

describe('InfoPanel.addLog', () => {
  test('log entry is added', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.addLog('テストメッセージ');

    const logEl = doc.getElementById('logPanel');
    const entries = logEl.querySelectorAll('.log-entry');
    expect(entries).toHaveLength(1);
    expect(entries[0].textContent).toBe('テストメッセージ');
  });

  test('new entries are prepended (newest first)', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    panel.addLog('最初');
    panel.addLog('次');
    panel.addLog('最新');

    const logEl = doc.getElementById('logPanel');
    const entries = logEl.querySelectorAll('.log-entry');
    expect(entries[0].textContent).toBe('最新');
  });

  test('old entries trimmed to 20 max', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    for (let i = 0; i < 25; i++) {
      panel.addLog(`メッセージ ${i}`);
    }

    const logEl = doc.getElementById('logPanel');
    const entries = logEl.querySelectorAll('.log-entry');
    expect(entries.length).toBeLessThanOrEqual(20);
  });

  test('exactly 20 entries remain after 20 additions', () => {
    const doc = makeDefaultDoc();
    const panel = new InfoPanel(doc);
    for (let i = 0; i < 20; i++) {
      panel.addLog(`msg${i}`);
    }

    const logEl = doc.getElementById('logPanel');
    const entries = logEl.querySelectorAll('.log-entry');
    expect(entries).toHaveLength(20);
  });
});
