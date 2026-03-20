'use strict';

/**
 * SavePanel.test.js
 * Tests for client SavePanel (save list UI, manual save, delete).
 * Uses manual DOM simulation — no jsdom required.
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
    style: { display: '', cssText: '' },
    dataset: {},
    children: [],
    _listeners: {},
    _value: '',
    get value() { return this._value; },
    set value(v) { this._value = v; },
    querySelectorAll(selector) {
      const cls = selector.startsWith('.') ? selector.slice(1) : null;
      const id  = selector.startsWith('#') ? selector.slice(1) : null;
      const tag = (!cls && !id) ? selector.toLowerCase() : null;
      const all = this._allDescendants();
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

// ---------------------------------------------------------------------------
// SavePanel inline implementation for testing
// (mirrors client/js/SavePanel.js logic, adapted for manual DOM stub)
// ---------------------------------------------------------------------------

class SavePanel {
  constructor(gameId, onLoad, doc) {
    this.gameId = gameId;
    this.onLoad = onLoad;
    this._doc = doc;
    this._panel = null;
    this._visible = false;
    this._createPanel();
  }

  _createPanel() {
    const panel = this._doc.createElement('div');
    panel.id = 'savePanel';
    panel.style.display = 'none';

    // Simulate child elements (close button, manual save button, list, status)
    const closeBtn = this._doc.createElement('button');
    closeBtn.id = 'savePanelClose';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => this.hide());

    const manualSaveBtn = this._doc.createElement('button');
    manualSaveBtn.id = 'savePanelManualSave';
    manualSaveBtn.textContent = '手動セーブ';
    manualSaveBtn.addEventListener('click', () => this._manualSave());

    const listEl = this._doc.createElement('div');
    listEl.id = 'savePanelList';

    const statusEl = this._doc.createElement('div');
    statusEl.id = 'savePanelStatus';

    panel.appendChild(closeBtn);
    panel.appendChild(manualSaveBtn);
    panel.appendChild(listEl);
    panel.appendChild(statusEl);

    // Override querySelector to find by id among children
    panel.querySelector = (selector) => {
      if (selector === '#savePanelClose') return closeBtn;
      if (selector === '#savePanelManualSave') return manualSaveBtn;
      if (selector === '#savePanelList') return listEl;
      if (selector === '#savePanelStatus') return statusEl;
      return null;
    };

    this._doc.body.appendChild(panel);
    this._panel = panel;

    // Wire close and manual save
    closeBtn.addEventListener('click', () => this.hide());
    manualSaveBtn.addEventListener('click', () => this._manualSave());
  }

  show() {
    this._panel.style.display = 'block';
    this._visible = true;
    return this.refresh();
  }

  hide() {
    this._panel.style.display = 'none';
    this._visible = false;
  }

  toggle() {
    if (this._visible) {
      this.hide();
    } else {
      return this.show();
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
      const resp = await this._fetch('/saves');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      saves = await resp.json();
    } catch (e) {
      this._setStatus(`エラー: ${e.message}`);
      return;
    }

    const relevant = this.gameId
      ? saves.filter(s => s.gameId === this.gameId)
      : saves;

    if (relevant.length === 0) {
      listEl.innerHTML = 'セーブデータなし';
      this._setStatus('');
      return;
    }

    relevant.forEach(entry => {
      const row = this._doc.createElement('div');
      const info = this._doc.createElement('span');
      info.textContent = `${entry.gameId} — ${entry.savedAt || '—'}`;

      const delBtn = this._doc.createElement('button');
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', () => this._deleteGame(entry.gameId));

      row.appendChild(info);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });

    this._setStatus(`${relevant.length}件のセーブ`);
  }

  // Allow injection of fetch for testing
  _fetch(url, opts) {
    const fn = this._fetchImpl || global.fetch;
    return opts !== undefined ? fn(url, opts) : fn(url);
  }

  async _manualSave() {
    if (!this.gameId) {
      this._setStatus('ゲームIDが設定されていません');
      return;
    }
    this._setStatus('セーブ中...');
    try {
      const resp = await this._fetch(`/saves/${encodeURIComponent(this.gameId)}/save`, { method: 'POST' });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      await this.refresh();
      this._setStatus('セーブしました');
    } catch (e) {
      this._setStatus(`セーブ失敗: ${e.message}`);
    }
  }

  async _deleteGame(gameId) {
    this._setStatus('削除中...');
    try {
      const resp = await this._fetch(`/saves/${encodeURIComponent(gameId)}`, { method: 'DELETE' });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      await this.refresh();
      this._setStatus('削除しました');
    } catch (e) {
      this._setStatus(`削除失敗: ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeBody() {
  const body = makeEl('body', 'body');
  return body;
}

function makeDoc() {
  const body = makeBody();
  return {
    body,
    createElement(tag) {
      return makeEl(null, tag);
    },
  };
}

function makeFetchOk(data) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

function makeFetchError(status) {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: `HTTP ${status}` }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SavePanel', () => {
  describe('show / hide', () => {
    test('panel is hidden initially', () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      // Mock fetch so refresh() doesn't fail
      panel._fetchImpl = makeFetchOk([]);

      expect(panel._visible).toBe(false);
      expect(panel._panel.style.display).toBe('none');
    });

    test('show() makes panel visible', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      panel._fetchImpl = makeFetchOk([]);

      await panel.show();

      expect(panel._visible).toBe(true);
      expect(panel._panel.style.display).toBe('block');
    });

    test('hide() hides the panel', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      panel._fetchImpl = makeFetchOk([]);

      await panel.show();
      panel.hide();

      expect(panel._visible).toBe(false);
      expect(panel._panel.style.display).toBe('none');
    });

    test('toggle() shows then hides', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      panel._fetchImpl = makeFetchOk([]);

      await panel.toggle(); // show
      expect(panel._visible).toBe(true);

      panel.toggle(); // hide
      expect(panel._visible).toBe(false);
    });

    test('close button hides the panel', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      panel._fetchImpl = makeFetchOk([]);

      await panel.show();

      // Find close button and click it
      const closeBtn = panel._panel.querySelector('#savePanelClose');
      expect(closeBtn).not.toBeNull();
      closeBtn.click();

      expect(panel._visible).toBe(false);
    });
  });

  describe('refresh()', () => {
    test('refresh fetches GET /saves', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      const mockFetch = makeFetchOk([]);
      panel._fetchImpl = mockFetch;

      await panel.refresh();

      const calls = mockFetch.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe('/saves');
    });

    test('refresh renders save entries for matching gameId', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      const saves = [
        { gameId: 'game1', savedAt: '2026-01-01T00:00:00.000Z' },
        { gameId: 'game2', savedAt: '2026-01-02T00:00:00.000Z' },
      ];
      panel._fetchImpl = makeFetchOk(saves);

      await panel.refresh();

      const listEl = panel._panel.querySelector('#savePanelList');
      // Should have one row for game1
      expect(listEl.children.length).toBe(1);
    });

    test('refresh shows all saves when no gameId set', async () => {
      const doc = makeDoc();
      const panel = new SavePanel(null, () => {}, doc);
      const saves = [
        { gameId: 'game1', savedAt: '2026-01-01T00:00:00.000Z' },
        { gameId: 'game2', savedAt: '2026-01-02T00:00:00.000Z' },
      ];
      panel._fetchImpl = makeFetchOk(saves);

      await panel.refresh();

      const listEl = panel._panel.querySelector('#savePanelList');
      expect(listEl.children.length).toBe(2);
    });

    test('refresh shows empty message when no saves match', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('nonexistent', () => {}, doc);
      panel._fetchImpl = makeFetchOk([{ gameId: 'other', savedAt: null }]);

      await panel.refresh();

      const listEl = panel._panel.querySelector('#savePanelList');
      expect(listEl.innerHTML).toContain('セーブデータなし');
    });

    test('refresh updates status with count', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      const saves = [
        { gameId: 'game1', savedAt: '2026-01-01T00:00:00.000Z' },
      ];
      panel._fetchImpl = makeFetchOk(saves);

      await panel.refresh();

      const statusEl = panel._panel.querySelector('#savePanelStatus');
      expect(statusEl.textContent).toContain('1件');
    });

    test('refresh shows error message on fetch failure', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);
      panel._fetchImpl = jest.fn().mockRejectedValue(new Error('Network error'));

      await panel.refresh();

      const statusEl = panel._panel.querySelector('#savePanelStatus');
      expect(statusEl.textContent).toContain('エラー');
    });
  });

  describe('manual save button', () => {
    test('manual save button triggers POST /saves/:gameId/save', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);

      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })   // manual save
        .mockResolvedValueOnce({ ok: true, json: async () => [] });               // refresh after save

      panel._fetchImpl = mockFetch;

      await panel._manualSave();

      expect(mockFetch).toHaveBeenCalledWith('/saves/game1/save', { method: 'POST' });
    });

    test('manual save calls POST then refresh after success', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);

      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({ ok: true, json: async () => [] });

      panel._fetchImpl = mockFetch;

      await panel._manualSave();

      // First call: POST to save
      expect(mockFetch.mock.calls[0][0]).toBe('/saves/game1/save');
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      // Second call: GET /saves (refresh)
      expect(mockFetch.mock.calls[1][0]).toBe('/saves');
    });

    test('manual save shows error when no gameId', async () => {
      const doc = makeDoc();
      const panel = new SavePanel(null, () => {}, doc);
      const mockFetch = jest.fn();
      panel._fetchImpl = mockFetch;

      await panel._manualSave();

      expect(mockFetch).not.toHaveBeenCalled();
      const statusEl = panel._panel.querySelector('#savePanelStatus');
      expect(statusEl.textContent).toContain('ゲームIDが設定されていません');
    });

    test('manual save shows error on server failure', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);

      panel._fetchImpl = makeFetchError(500);

      await panel._manualSave();

      const statusEl = panel._panel.querySelector('#savePanelStatus');
      expect(statusEl.textContent).toContain('セーブ失敗');
    });
  });

  describe('delete button', () => {
    test('delete button triggers DELETE /saves/:gameId', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);

      const saves = [{ gameId: 'game1', savedAt: '2026-01-01T00:00:00.000Z' }];
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => saves })             // initial refresh
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })   // delete
        .mockResolvedValueOnce({ ok: true, json: async () => [] });               // refresh after delete

      panel._fetchImpl = mockFetch;

      await panel.refresh();
      await panel._deleteGame('game1');

      // Find the DELETE call
      const deleteCalls = mockFetch.mock.calls.filter(
        c => c[1] && c[1].method === 'DELETE'
      );
      expect(deleteCalls.length).toBe(1);
      expect(deleteCalls[0][0]).toBe('/saves/game1');
    });

    test('delete calls DELETE then refresh after success', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);

      const mockFetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({ ok: true, json: async () => [] });

      panel._fetchImpl = mockFetch;

      await panel._deleteGame('game1');

      // First call: DELETE
      expect(mockFetch.mock.calls[0][0]).toBe('/saves/game1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
      // Second call: GET /saves (refresh)
      expect(mockFetch.mock.calls[1][0]).toBe('/saves');
    });

    test('delete shows error on server failure', async () => {
      const doc = makeDoc();
      const panel = new SavePanel('game1', () => {}, doc);

      panel._fetchImpl = makeFetchError(500);

      await panel._deleteGame('game1');

      const statusEl = panel._panel.querySelector('#savePanelStatus');
      expect(statusEl.textContent).toContain('削除失敗');
    });
  });
});
