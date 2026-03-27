/**
 * InfoPanel.js
 * Manages header (time track, round, turn indicator, command points),
 * morale panel, and log panel DOM updates.
 */

// Time labels for each round (rounds 1-16 = 6AM to 9PM every hour)
const TIME_LABELS = [
  '6AM','7AM','8AM','9AM','10AM','11AM',
  '12PM','1PM','2PM','3PM','4PM','5PM',
  '6PM','7PM','8PM','9PM'
];

const MAX_LOG_ENTRIES = 20;

export default class InfoPanel {
  constructor() {
    this._timeTrack = document.getElementById('timeTrack');
    this._roundInfo = document.getElementById('roundInfo');
    this._turnIndicator = document.getElementById('turnIndicator');
    this._commandPoints = document.getElementById('commandPoints');
    this._moraleBarFR = document.getElementById('moraleBarFR');
    this._moraleBarAU = document.getElementById('moraleBarAU');
    this._moraleNumFR = document.getElementById('moraleNumFR');
    this._moraleNumAU = document.getElementById('moraleNumAU');
    this._logPanel = document.getElementById('logPanel');

    this._buildTimeTrack();
  }

  /**
   * Build the static time track DOM once.
   */
  _buildTimeTrack() {
    if (!this._timeTrack) return;
    this._timeTrack.innerHTML = '';
    for (let i = 0; i < TIME_LABELS.length; i++) {
      const span = document.createElement('span');
      span.className = 'time-step';
      span.textContent = TIME_LABELS[i];
      span.dataset.round = String(i + 1);
      this._timeTrack.appendChild(span);
    }
  }

  /**
   * Update header display.
   * @param {object} gameState
   * @param {string} mySide - 'france' | 'austria'
   */
  updateHeader(gameState, mySide) {
    if (!gameState) return;

    const round = gameState.round || 1;
    const holder = gameState.controlToken ? gameState.controlToken.holder : null;
    const cp = gameState.commandPoints != null ? gameState.commandPoints : 3;

    // Time track highlight
    if (this._timeTrack) {
      const steps = this._timeTrack.querySelectorAll('.time-step');
      steps.forEach((s) => {
        s.classList.toggle('active', Number(s.dataset.round) === round);
      });
    }

    // Round counter
    if (this._roundInfo) {
      this._roundInfo.textContent = `Round ${round}/16`;
    }

    // Turn indicator
    if (this._turnIndicator) {
      const pending = gameState.pendingInterruption;

      if (mySide === 'spectator') {
        // 観戦者: 「あなた」表現なし、中立表示
        if (pending) {
          const waitLabel = pending.waitingFor === 'france' ? 'フランス(仏)' : 'オーストリア(墺)';
          this._turnIndicator.textContent = `応答待ち: ${waitLabel}`;
          this._turnIndicator.className = 'opponent';
        } else {
          const turnLabel = holder === 'france' ? 'フランス(仏)' : 'オーストリア(墺)';
          this._turnIndicator.textContent = `手番: ${turnLabel}`;
          this._turnIndicator.className = 'opponent';
        }
      } else {
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
    }

    // Command points dots
    if (this._commandPoints) {
      // Keep the label span, rebuild dots
      const label = this._commandPoints.querySelector('.cp-label');
      this._commandPoints.innerHTML = '';
      if (label) this._commandPoints.appendChild(label);
      else {
        const lbl = document.createElement('span');
        lbl.className = 'cp-label';
        lbl.textContent = '司令:';
        this._commandPoints.appendChild(lbl);
      }
      const maxCp = 3;
      for (let i = 0; i < maxCp; i++) {
        const dot = document.createElement('span');
        dot.className = 'cp-dot' + (i < cp ? ' filled' : '');
        this._commandPoints.appendChild(dot);
      }
    }
  }

  /**
   * Update morale bars and numbers.
   * @param {object} gameState
   */
  updateMorale(gameState) {
    if (!gameState || !gameState.morale) return;

    const fr = gameState.morale.france;
    const au = gameState.morale.austria;

    // Max morale from scenarios (default 14 for FR, 16 for AU — use total as reference)
    const frTotal = fr.total || 14;
    const auTotal = au.total || 16;
    const frCurrent = fr.uncommitted != null ? fr.uncommitted : frTotal;
    const auCurrent = au.uncommitted != null ? au.uncommitted : auTotal;

    const frPct = frTotal > 0 ? Math.round((frCurrent / frTotal) * 100) : 0;
    const auPct = auTotal > 0 ? Math.round((auCurrent / auTotal) * 100) : 0;

    if (this._moraleBarFR) this._moraleBarFR.style.width = `${frPct}%`;
    if (this._moraleBarAU) this._moraleBarAU.style.width = `${auPct}%`;
    if (this._moraleNumFR) this._moraleNumFR.textContent = String(frCurrent);
    if (this._moraleNumAU) this._moraleNumAU.textContent = String(auCurrent);
  }

  /**
   * Add a log entry. Keeps only the last MAX_LOG_ENTRIES.
   * @param {string} message
   */
  addLog(message) {
    if (!this._logPanel) return;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = message;

    // Prepend
    const first = this._logPanel.firstChild;
    if (first) {
      this._logPanel.insertBefore(entry, first);
    } else {
      this._logPanel.appendChild(entry);
    }

    // Trim to max entries
    const entries = this._logPanel.querySelectorAll('.log-entry');
    if (entries.length > MAX_LOG_ENTRIES) {
      for (let i = MAX_LOG_ENTRIES; i < entries.length; i++) {
        entries[i].remove();
      }
    }
  }
}
