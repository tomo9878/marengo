/**
 * SavePanel.js
 * Save/load UI panel for Triomphe à Marengo.
 */

export default class SavePanel {
  /**
   * @param {string} gameId - current game ID
   * @param {function} onLoad - called with gameState when a save is loaded
   */
  constructor(gameId, onLoad) {
    this.gameId = gameId;
    this.onLoad = onLoad;
    this._panel = null;
    this._visible = false;
    this._createPanel();
  }

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'savePanel';
    panel.style.cssText = [
      'position:fixed',
      'top:60px',
      'right:10px',
      'width:300px',
      'background:#16213e',
      'border:1px solid #0f3460',
      'border-radius:6px',
      'padding:14px',
      'z-index:500',
      'color:#eee',
      'font-family:inherit',
      'font-size:13px',
      'display:none',
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    ].join(';');

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <span style="font-weight:bold;color:#4ecca3;">セーブ一覧</span>
        <button id="savePanelClose" style="background:#0f3460;border:1px solid #1a4a80;border-radius:4px;color:#eee;font-size:12px;padding:3px 8px;cursor:pointer;">閉じる</button>
      </div>
      <div style="margin-bottom:10px;">
        <button id="savePanelManualSave" style="display:block;width:100%;padding:7px 8px;background:#0f3460;border:1px solid #4ecca3;border-radius:4px;color:#4ecca3;font-size:12px;font-weight:bold;cursor:pointer;">手動セーブ</button>
      </div>
      <div id="savePanelList" style="max-height:240px;overflow-y:auto;"></div>
      <div id="savePanelStatus" style="margin-top:8px;font-size:11px;color:#aaa;min-height:16px;"></div>
    `;

    document.body.appendChild(panel);
    this._panel = panel;

    panel.querySelector('#savePanelClose').addEventListener('click', () => this.hide());
    panel.querySelector('#savePanelManualSave').addEventListener('click', () => this._manualSave());
  }

  show() {
    this._panel.style.display = 'block';
    this._visible = true;
    this.refresh();
  }

  hide() {
    this._panel.style.display = 'none';
    this._visible = false;
  }

  toggle() {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  _setStatus(msg) {
    const el = this._panel.querySelector('#savePanelStatus');
    if (el) el.textContent = msg;
  }

  async refresh() {
    this._setStatus('読み込み中...');
    const listEl = this._panel.querySelector('#savePanelList');
    if (!listEl) return;
    listEl.innerHTML = '';

    let saves;
    try {
      const resp = await fetch('/saves');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      saves = await resp.json();
    } catch (e) {
      this._setStatus(`エラー: ${e.message}`);
      return;
    }

    // Filter to entries relevant to this gameId (show all if no gameId)
    const relevant = this.gameId
      ? saves.filter(s => s.gameId === this.gameId)
      : saves;

    if (relevant.length === 0) {
      listEl.innerHTML = '<div style="color:#555;font-style:italic;font-size:12px;">セーブデータなし</div>';
      this._setStatus('');
      return;
    }

    relevant.forEach(entry => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid #0f3460;';

      const savedAt = entry.savedAt
        ? new Date(entry.savedAt).toLocaleString('ja-JP')
        : '—';

      const info = document.createElement('span');
      info.style.cssText = 'font-size:11px;color:#ccc;flex:1;';
      info.textContent = `${entry.gameId} — ${savedAt}`;

      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.style.cssText = 'background:#3a1020;border:1px solid #e94560;border-radius:3px;color:#e94560;font-size:11px;padding:2px 6px;cursor:pointer;margin-left:6px;';
      delBtn.addEventListener('click', () => this._deleteGame(entry.gameId));

      row.appendChild(info);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });

    this._setStatus(`${relevant.length}件のセーブ`);
  }

  async _manualSave() {
    if (!this.gameId) {
      this._setStatus('ゲームIDが設定されていません');
      return;
    }
    this._setStatus('セーブ中...');
    try {
      const resp = await fetch(`/saves/${encodeURIComponent(this.gameId)}/save`, { method: 'POST' });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      this._setStatus('セーブしました');
      await this.refresh();
    } catch (e) {
      this._setStatus(`セーブ失敗: ${e.message}`);
    }
  }

  async _deleteGame(gameId) {
    this._setStatus('削除中...');
    try {
      const resp = await fetch(`/saves/${encodeURIComponent(gameId)}`, { method: 'DELETE' });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      this._setStatus('削除しました');
      await this.refresh();
    } catch (e) {
      this._setStatus(`削除失敗: ${e.message}`);
    }
  }
}
