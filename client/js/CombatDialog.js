/**
 * CombatDialog.js
 * Interruption response UI embedded in the sidebar.
 * Each render* method populates a given container element.
 */

export default class CombatDialog {

  /**
   * Render defense response UI (急襲: 防御対応).
   * options: { attackerPieceIds, targetLocaleId, eligiblePieceIds }
   * @param {HTMLElement} container
   * @param {object} options
   * @param {object} gameState  - for piece labels
   * @param {function} onResponse
   */
  renderDefenseResponse(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '防御対応');
    const instr = this._el('div', 'interruption-instruction',
      'アプローチに移動する駒を選択（任意）');
    container.appendChild(title);
    container.appendChild(instr);

    const eligible = options.availableDefenders || options.eligiblePieceIds || [];
    const checkboxes = [];

    for (const pid of eligible) {
      const piece = gameState && gameState.pieces ? gameState.pieces[pid] : null;
      const label = piece ? this._pieceLabel(pid, piece) : pid;

      const row = document.createElement('div');
      row.className = 'interruption-option';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = pid;

      const lbl = document.createElement('label');
      lbl.textContent = label;

      row.appendChild(cb);
      row.appendChild(lbl);
      container.appendChild(row);
      checkboxes.push(cb);
    }

    const actions = document.createElement('div');
    actions.className = 'interruption-actions';

    const btn = this._btn('応答する', 'btn-yes', () => {
      const selected = checkboxes.filter(c => c.checked).map(c => c.value);
      onResponse({ pieceIds: selected });
    });

    // 応答可能な駒がある場合、1体以上選択するまで確定不可
    if (eligible.length > 0) {
      btn.disabled = true;
      for (const cb of checkboxes) {
        cb.addEventListener('change', () => {
          btn.disabled = !checkboxes.some(c => c.checked);
        });
      }
    }

    actions.appendChild(btn);
    container.appendChild(actions);
  }

  /**
   * Render assault defender leaders UI (突撃①: 防御先導駒).
   * options: { approach: {width, symbols}, eligiblePieceIds, max }
   */
  renderAssaultDefLeaders(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '突撃①: 防御先導駒');
    const instr = this._el('div', 'interruption-instruction',
      `防御先導駒を選択してください（最大 ${options.max || 1} 駒）\n` +
      this._constraintText(options.approach));
    container.appendChild(title);
    container.appendChild(instr);

    const checkboxes = this._renderCheckboxList(container, options.eligiblePieceIds || [], gameState, options.max || 1);

    this._appendSubmitBtn(container, '選択確定', () => {
      const selected = checkboxes.filter(c => c.checked).map(c => c.value);
      onResponse({ leaderIds: selected });
    });
  }

  /**
   * Render assault attacker leaders UI (突撃②: 攻撃先導駒).
   */
  renderAssaultAtkLeaders(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '突撃②: 攻撃先導駒');
    const instr = this._el('div', 'interruption-instruction',
      `攻撃先導駒を選択してください（最大 ${options.max || 1} 駒）\n` +
      this._constraintText(options.approach));
    container.appendChild(title);
    container.appendChild(instr);

    const checkboxes = this._renderCheckboxList(container, options.eligiblePieceIds || [], gameState, options.max || 1);

    this._appendSubmitBtn(container, '選択確定', () => {
      const selected = checkboxes.filter(c => c.checked).map(c => c.value);
      onResponse({ leaderIds: selected });
    });
  }

  /**
   * Render assault def artillery UI (突撃③: 防御砲撃).
   * options: { artilleryPieceIds, targetLeaderIds }
   */
  renderAssaultDefArtillery(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '突撃③: 防御砲撃');
    const instr = this._el('div', 'interruption-instruction', '防御砲撃を実施しますか？');
    container.appendChild(title);
    container.appendChild(instr);

    const actions = document.createElement('div');
    actions.className = 'interruption-actions';

    const yes = this._btn('はい', 'btn-yes', () => onResponse({ fire: true }));
    const no  = this._btn('いいえ', 'btn-no', () => onResponse({ fire: false }));

    actions.appendChild(yes);
    actions.appendChild(no);
    container.appendChild(actions);
  }

  /**
   * Render assault counter UI (突撃④: カウンター攻撃).
   */
  renderAssaultCounter(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '突撃④: カウンター攻撃');
    const instr = this._el('div', 'interruption-instruction',
      `カウンター攻撃に参加する駒を選択（最大 ${options.max || 1} 駒）`);
    container.appendChild(title);
    container.appendChild(instr);

    const checkboxes = this._renderCheckboxList(container, options.eligiblePieceIds || [], gameState, options.max || 1);

    this._appendSubmitBtn(container, '選択確定', () => {
      const selected = checkboxes.filter(c => c.checked).map(c => c.value);
      onResponse({ pieceIds: selected });
    });
  }

  /**
   * Render assault reductions UI (突撃⑤: 戦力減少割振り).
   * options: { totalReductions, eligiblePieceIds }
   */
  renderAssaultReductions(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const total = options.totalReductions || 0;
    const eligible = options.eligiblePieceIds || [];

    const title = this._el('div', 'interruption-title', '突撃⑤: 戦力減少');
    const instr = this._el('div', 'interruption-instruction',
      `合計 ${total} ポイントの戦力減少を割り振ってください`);
    container.appendChild(title);
    container.appendChild(instr);

    // Remaining indicator
    const remaining = this._el('div', 'interruption-instruction', `残り: ${total}`);
    container.appendChild(remaining);

    const values = {};
    for (const pid of eligible) {
      values[pid] = 0;
    }

    const updateRemaining = () => {
      const used = Object.values(values).reduce((a, b) => a + b, 0);
      remaining.textContent = `残り: ${total - used}`;
    };

    for (const pid of eligible) {
      const piece = gameState && gameState.pieces ? gameState.pieces[pid] : null;
      const label = piece ? this._pieceLabel(pid, piece) : pid;
      const maxVal = piece ? (piece.strength || 1) : 1;

      const row = document.createElement('div');
      row.className = 'reduction-row';

      const lbl = document.createElement('div');
      lbl.className = 'piece-label';
      lbl.textContent = label;

      const ctrl = document.createElement('div');
      ctrl.className = 'num-control';

      const dec = document.createElement('button');
      dec.textContent = '−';

      const val = document.createElement('span');
      val.className = 'num-val';
      val.textContent = '0';

      const inc = document.createElement('button');
      inc.textContent = '+';

      dec.addEventListener('click', () => {
        if (values[pid] > 0) {
          values[pid]--;
          val.textContent = String(values[pid]);
          updateRemaining();
        }
      });

      inc.addEventListener('click', () => {
        const used = Object.values(values).reduce((a, b) => a + b, 0);
        if (values[pid] < maxVal && used < total) {
          values[pid]++;
          val.textContent = String(values[pid]);
          updateRemaining();
        }
      });

      ctrl.appendChild(dec);
      ctrl.appendChild(val);
      ctrl.appendChild(inc);
      row.appendChild(lbl);
      row.appendChild(ctrl);
      container.appendChild(row);
    }

    this._appendSubmitBtn(container, '確定', () => {
      const used = Object.values(values).reduce((a, b) => a + b, 0);
      if (used !== total) {
        // Can't submit until all reductions assigned (or allow partial)
        return;
      }
      onResponse({ reductions: { ...values } });
    });
  }

  /**
   * Render bombardment reduction UI (砲撃: 減少駒選択).
   * options: { targetPieceIds }
   */
  renderBombardmentReduction(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '砲撃: 被害駒選択');
    const instr = this._el('div', 'interruption-instruction',
      '戦力減少を受ける駒を選択してください');
    container.appendChild(title);
    container.appendChild(instr);

    const targets = options.targetPieceIds || [];
    let selected = targets[0] || null;
    const radios = [];

    for (const pid of targets) {
      const piece = gameState && gameState.pieces ? gameState.pieces[pid] : null;
      const label = piece ? this._pieceLabel(pid, piece) : pid;

      const row = document.createElement('div');
      row.className = 'interruption-option';

      const rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = 'bombardmentTarget';
      rb.value = pid;
      rb.checked = pid === selected;

      rb.addEventListener('change', () => { selected = pid; });

      const lbl = document.createElement('label');
      lbl.textContent = label;

      row.appendChild(rb);
      row.appendChild(lbl);
      container.appendChild(row);
      radios.push(rb);
    }

    this._appendSubmitBtn(container, '確定', () => {
      if (selected) onResponse({ targetPieceId: selected });
    });
  }

  /**
   * Render retreat destination UI.
   * options: { pieces: [{pieceId, validDestinations}] }
   */
  renderRetreatDestination(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '退却先選択');
    const instr = this._el('div', 'interruption-instruction',
      '各駒の退却先を選択してください');
    container.appendChild(title);
    container.appendChild(instr);

    const pieces = options.pieces || [];
    const selections = {};

    for (const entry of pieces) {
      const { pieceId, validDestinations } = entry;
      const piece = gameState && gameState.pieces ? gameState.pieces[pieceId] : null;
      const label = piece ? this._pieceLabel(pieceId, piece) : pieceId;

      const lbl = this._el('div', 'interruption-instruction', label + ':');
      container.appendChild(lbl);

      if (!validDestinations || validDestinations.length === 0) {
        // 退却先なし → 消滅扱い
        const noDestEl = this._el('div', 'interruption-instruction',
          '　退却先なし（消滅）');
        noDestEl.style.color = '#e94560';
        container.appendChild(noDestEl);
        selections[pieceId] = null;
        continue;
      }

      const sel = document.createElement('select');
      sel.style.cssText = 'width:100%;padding:4px;background:#0a0f1e;border:1px solid #0f3460;color:#eee;border-radius:3px;margin-bottom:8px;';

      for (const dest of validDestinations) {
        const opt = document.createElement('option');
        opt.value = dest;
        opt.textContent = `エリア ${dest}`;
        sel.appendChild(opt);
      }

      selections[pieceId] = validDestinations[0];
      sel.addEventListener('change', () => { selections[pieceId] = parseInt(sel.value, 10); });

      container.appendChild(sel);
    }

    this._appendSubmitBtn(container, '確定', () => {
      // null（退却先なし）のエントリは除外してサーバーへ送信
      const destinations = {};
      for (const [pid, dest] of Object.entries(selections)) {
        if (dest !== null) destinations[pid] = dest;
      }
      onResponse({ destinations });
    });
  }

  /**
   * 士気マップトークン除去: 相手プレイヤーが対象ロケールを選ぶ。
   * options: { side, amount, availableTokens: number[] }
   */
  renderMoraleTokenRemoval(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const sideStr = options.side === 'france' ? 'フランス' : 'オーストリア';
    const title = this._el('div', 'interruption-title', `${sideStr}士気トークン除去`);
    const instr = this._el('div', 'interruption-instruction',
      `${sideStr}のマップ上士気を ${options.amount} 個除去するロケールを選んでください`);
    container.appendChild(title);
    container.appendChild(instr);

    // ロケール別にトークン数を集計
    const countByLocale = {};
    for (const localeId of (options.availableTokens || [])) {
      countByLocale[localeId] = (countByLocale[localeId] || 0) + 1;
    }

    const selected = []; // 除去するロケールID配列（重複可）
    const remainEl = this._el('div', 'interruption-instruction', `残り選択: ${options.amount}`);
    container.appendChild(remainEl);

    for (const [localeIdStr, count] of Object.entries(countByLocale)) {
      const localeId = Number(localeIdStr);

      const row = document.createElement('div');
      row.className = 'reduction-row';

      const lbl = document.createElement('div');
      lbl.className = 'piece-label';
      lbl.textContent = `ロケール ${localeId}（×${count}）`;

      const ctrl = document.createElement('div');
      ctrl.className = 'num-control';

      const dec = document.createElement('button');
      dec.textContent = '−';
      const valEl = document.createElement('span');
      valEl.className = 'num-val';
      valEl.textContent = '0';
      const inc = document.createElement('button');
      inc.textContent = '+';

      let localeSel = 0;
      dec.addEventListener('click', () => {
        if (localeSel > 0) {
          localeSel--;
          const pos = selected.lastIndexOf(localeId);
          if (pos !== -1) selected.splice(pos, 1);
          valEl.textContent = String(localeSel);
          remainEl.textContent = `残り選択: ${options.amount - selected.length}`;
        }
      });
      inc.addEventListener('click', () => {
        if (localeSel < count && selected.length < options.amount) {
          localeSel++;
          selected.push(localeId);
          valEl.textContent = String(localeSel);
          remainEl.textContent = `残り選択: ${options.amount - selected.length}`;
        }
      });

      ctrl.appendChild(dec);
      ctrl.appendChild(valEl);
      ctrl.appendChild(inc);
      row.appendChild(lbl);
      row.appendChild(ctrl);
      container.appendChild(row);
    }

    this._appendSubmitBtn(container, '確定', () => {
      // 未選択分は先頭から自動補完
      const filled = [...selected];
      const avail = options.availableTokens || [];
      let ai = 0;
      while (filled.length < options.amount && ai < avail.length) {
        filled.push(avail[ai++]);
      }
      onResponse({ localeIds: filled });
    });
  }

  /**
   * フランス士気回収: フランスが1トークンを回収するロケールを選ぶ。
   * options: { recoverableTokens: [{ localeId, count }] }
   */
  renderFranceMoraleRecovery(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', 'フランス士気回収');
    const instr = this._el('div', 'interruption-instruction',
      '回収するトークンのロケールを選択\n（このターン投入分は除く）');
    container.appendChild(title);
    container.appendChild(instr);

    const recoverableTokens = options.recoverableTokens || [];
    let selectedLocaleId = null;

    for (const { localeId, count } of recoverableTokens) {
      const row = document.createElement('div');
      row.className = 'interruption-option';

      const rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = 'frMoraleRecovery';
      rb.value = String(localeId);
      rb.addEventListener('change', () => { selectedLocaleId = localeId; });

      const lbl = document.createElement('label');
      lbl.textContent = `ロケール ${localeId}${count > 1 ? `（×${count}）` : ''}`;

      row.appendChild(rb);
      row.appendChild(lbl);
      container.appendChild(row);
    }

    const actions = document.createElement('div');
    actions.className = 'interruption-actions';

    const btnConfirm = this._btn('回収する', 'btn-yes', () => {
      if (selectedLocaleId !== null) onResponse({ localeId: selectedLocaleId });
    });
    const btnSkip = this._btn('スキップ', 'btn-no', () => {
      onResponse({ localeId: null });
    });

    actions.appendChild(btnConfirm);
    actions.appendChild(btnSkip);
    container.appendChild(actions);
  }

  /**
   * 急襲後: 攻撃側アプローチ移動オプション UI
   * options: { attackerPieceIds, attackLocaleId, attackEdgeIdx }
   */
  renderAttackerApproach(container, options, gameState, onResponse) {
    container.innerHTML = '';

    const title = this._el('div', 'interruption-title', '急襲後: アプローチ移動');
    const instr = this._el('div', 'interruption-instruction',
      'アプローチに移動する駒を選択（任意）\n移動しない場合は「スキップ」');
    container.appendChild(title);
    container.appendChild(instr);

    const eligible = options.attackerPieceIds || [];
    const checkboxes = this._renderCheckboxList(container, eligible, gameState, eligible.length);

    const actions = document.createElement('div');
    actions.className = 'interruption-actions';

    const btnMove = this._btn('アプローチへ移動', 'btn-yes', () => {
      const selected = checkboxes.filter(c => c.checked).map(c => c.value);
      onResponse({ pieceIds: selected });
    });
    const btnSkip = this._btn('スキップ', 'btn-no', () => {
      onResponse({ pieceIds: [] });
    });

    actions.appendChild(btnMove);
    actions.appendChild(btnSkip);
    container.appendChild(actions);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _el(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  _btn(text, className, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.className = className;
    btn.addEventListener('click', onClick);
    return btn;
  }

  _pieceLabel(pid, piece) {
    const sideStr = piece.side === 'france' ? '仏' : '墺';
    const typeMap = { infantry: '歩兵', cavalry: '騎兵', artillery: '砲兵' };
    const typeStr = piece.type ? (typeMap[piece.type] || piece.type) : '?';
    const str = piece.strength != null ? `戦力${piece.strength}` : '';
    return `${sideStr} ${typeStr} ${str}`.trim();
  }

  _constraintText(approach) {
    if (!approach) return '';
    const parts = [];
    if (approach.width === 'narrow') parts.push('狭路');
    if (approach.cavalryObstacle) parts.push('騎兵障害');
    return parts.length ? `（制限: ${parts.join('、')}）` : '';
  }

  /**
   * Render a checkbox list for piece selection.
   * @param {HTMLElement} container
   * @param {string[]} pieceIds
   * @param {object} gameState
   * @param {number} maxSelect
   * @returns {HTMLInputElement[]} checkboxes
   */
  _renderCheckboxList(container, pieceIds, gameState, maxSelect) {
    const checkboxes = [];

    for (const pid of pieceIds) {
      const piece = gameState && gameState.pieces ? gameState.pieces[pid] : null;
      const label = piece ? this._pieceLabel(pid, piece) : pid;

      const row = document.createElement('div');
      row.className = 'interruption-option';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = pid;

      cb.addEventListener('change', () => {
        const checkedCount = checkboxes.filter(c => c.checked).length;
        checkboxes.forEach(c => {
          if (!c.checked) c.disabled = checkedCount >= maxSelect;
        });
      });

      const lbl = document.createElement('label');
      lbl.textContent = label;

      row.appendChild(cb);
      row.appendChild(lbl);
      container.appendChild(row);
      checkboxes.push(cb);
    }

    return checkboxes;
  }

  _appendSubmitBtn(container, text, onClick) {
    const actions = document.createElement('div');
    actions.className = 'interruption-actions';
    const btn = this._btn(text, 'btn-yes', onClick);
    actions.appendChild(btn);
    container.appendChild(actions);
  }
}
