/**
 * App.js
 * Main entry point for Triomphe à Marengo client.
 * Initializes all modules, wires events.
 */

import Connection from './Connection.js';
import MapRenderer from './MapRenderer.js';
import InfoPanel from './InfoPanel.js';
import ActionPanel from './ActionPanel.js';
import SavePanel from './SavePanel.js';
import OffMapPanel from './OffMapPanel.js';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let gameState = null;
let myState = { side: null, gameId: null };

let connection = null;
let mapRenderer = null;
let infoPanel = null;
let actionPanel = null;
let savePanel = null;
let offMapPanel = null;
let mapData = null;

let selectedPieceId = null;
let legalMoves = [];
let attackTargets = [];
let serverLegalActions = []; // latest legalActions from server

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const connectModal      = document.getElementById('connectModal');
const inputGameId       = document.getElementById('inputGameId');
const inputSide         = document.getElementById('inputSide');
const connectBtn        = document.getElementById('connectBtn');
const connectError      = document.getElementById('connectError');
const canvas            = document.getElementById('mapCanvas');
const btnSave           = document.getElementById('btnSave');
const btnShowSaveList   = document.getElementById('btnShowSaveList');
const saveListContainer = document.getElementById('saveListContainer');

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

async function init() {
  // Load map data
  try {
    const resp = await fetch('/data/map.json');
    if (resp.ok) {
      mapData = await resp.json();
    }
  } catch (e) {
    console.warn('Could not load map data:', e);
  }

  // Init panels
  infoPanel = new InfoPanel();

  actionPanel = new ActionPanel(
    (action) => handleAction(action),
    ()       => handleTurnEnd()
  );

  offMapPanel = new OffMapPanel();

  // Size canvas
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Init map renderer (with or without map data)
  mapRenderer = new MapRenderer(canvas, mapData || { areas: [], map: { width: 2700, height: 1799 } });
  mapRenderer._onRenderRequest = scheduleRender;
  mapRenderer.onImageLoad = scheduleRender;
  mapRenderer.fitToCanvas();

  // Canvas click: piece / locale selection
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    handleCanvasClick(sx, sy);
  });

  // 右クリックで選択解除
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearSelection();
  });

  // Debug: D key toggles area index display
  window.addEventListener('keydown', (e) => {
    if (e.key === 'd' || e.key === 'D') {
      if (mapRenderer) {
        mapRenderer.showAreaIdx = !mapRenderer.showAreaIdx;
        scheduleRender();
      }
    }
  });

  // Connect modal
  connectBtn.addEventListener('click', handleConnect);
  inputGameId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleConnect();
  });

  // Save panel (created with no gameId initially; updated after connect)
  savePanel = new SavePanel(null, () => {});
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      if (savePanel) savePanel.toggle();
    });
  }

  // Resume from save: show save list in connect modal
  if (btnShowSaveList) {
    btnShowSaveList.addEventListener('click', async () => {
      if (!saveListContainer) return;
      saveListContainer.style.display = 'block';
      saveListContainer.innerHTML = '<div style="color:#aaa;font-size:11px;">読み込み中...</div>';
      try {
        const resp = await fetch('/saves');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const saves = await resp.json();
        if (saves.length === 0) {
          saveListContainer.innerHTML = '<div style="color:#555;font-size:11px;font-style:italic;">セーブデータなし</div>';
          return;
        }
        saveListContainer.innerHTML = '';
        saves.forEach(entry => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid #0f3460;cursor:pointer;';
          const savedAt = entry.savedAt ? new Date(entry.savedAt).toLocaleString('ja-JP') : '—';
          row.innerHTML = `<span style="font-size:11px;color:#ccc;">${entry.gameId} — ${savedAt}</span>
            <span style="font-size:10px;color:#4ecca3;margin-left:6px;">選択</span>`;
          row.addEventListener('click', () => {
            if (inputGameId) inputGameId.value = entry.gameId;
            saveListContainer.style.display = 'none';
          });
          saveListContainer.appendChild(row);
        });
      } catch (e) {
        saveListContainer.innerHTML = `<div style="color:#e94560;font-size:11px;">エラー: ${e.message}</div>`;
      }
    });
  }

  // Initial render
  scheduleRender();
}

function resizeCanvas() {
  const container = document.getElementById('mapContainer');
  if (!container) return;
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
  if (mapRenderer) {
    mapRenderer.fitToCanvas();
    scheduleRender();
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let _renderPending = false;

function scheduleRender() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(() => {
    _renderPending = false;
    if (mapRenderer) {
      mapRenderer.render(gameState, selectedPieceId, legalMoves, attackTargets, myState);
    }
  });
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Apply a state update from the server.
 * @param {object} newState
 */
function applyState(newState) {
  gameState = newState;

  // Update UI
  infoPanel.updateHeader(gameState, myState.side);
  infoPanel.updateMorale(gameState);

  // Flush log entries
  if (gameState.log && Array.isArray(gameState.log)) {
    // Add only new entries (server sends full log; show last added)
    // For simplicity, show only the last entry if present
    const last = gameState.log[gameState.log.length - 1];
    if (last) infoPanel.addLog(last);
  }

  // Update off-map panel
  if (offMapPanel) {
    offMapPanel.update(gameState, myState?.side, handleEntryAction);
  }

  // Recompute legal actions for selected piece
  refreshActionPanel();
  scheduleRender();
}

/**
 * オーストリア入場アクションを送信する。
 * @param {string} pieceId
 */
function handleEntryAction(pieceId) {
  if (!connection) return;
  connection.sendAction({ type: 'ENTER_MAP', pieceId });
}

/**
 * Handle an interruption from the server.
 */
function showInterruption(interruptionType, options, waitingFor) {
  if (waitingFor === myState.side) {
    // It's our turn to respond
    actionPanel.setInterruptionMode(
      interruptionType,
      options,
      gameState,
      (response) => {
        connection.sendResponse(response);
      }
    );
  } else {
    // Waiting for the other player — show info only
    infoPanel.addLog(`応答待ち: ${interruptionType} (相手)`);
  }
  infoPanel.updateHeader(gameState, myState.side);
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Action handling
// ---------------------------------------------------------------------------

function handleAction(action) {
  if (!connection) return;

  // 再編成: ダイアログを表示して駒選択
  if (action.type === 'reorganize') {
    if (!selectedPieceId || !gameState) return;
    const piece = gameState.pieces[selectedPieceId];
    if (!piece) return;

    // serverLegalActions から該当ロケールの再編成アクションを検索
    const reorgAction = serverLegalActions.find(
      a => a.type === 'reorganize' && a.localeId === piece.localeId
    );
    if (!reorgAction) {
      infoPanel.addLog('このロケールに再編成可能な駒がありません');
      return;
    }

    actionPanel.showReorganizeDialog(
      reorgAction,
      gameState,
      mapData,
      (pieceIds) => {
        connection.sendAction({ type: 'reorganize', pieceIds, localeId: reorgAction.localeId });
        clearSelection(); // 再編成後はニュートラルに戻す（誤移動防止）
      },
      () => {
        refreshActionPanel(); // キャンセル → 元に戻す
      }
    );
    return;
  }

  // 行軍アクション: 目的地クリックが必要
  if (action._mapSelect) {
    infoPanel.addLog('移動先をマップ上でクリックしてください');
    return;
  }

  // Enrich action with selected piece
  if (selectedPieceId && !action.pieceId) {
    action.pieceId = selectedPieceId;
  }
  connection.sendAction(action);
}

function handleTurnEnd() {
  if (!connection) return;
  connection.sendAction({ type: 'end_turn' });
}

function refreshActionPanel() {
  if (!gameState) return;
  const isMyTurn = gameState.controlToken &&
                   gameState.controlToken.holder === myState.side &&
                   !gameState.pendingInterruption;

  // Use server-authoritative legal actions for selected piece when available
  const legalActions = selectedPieceId && serverLegalActions.length
    ? serverLegalActions.filter(a => {
        if (a.pieceId === selectedPieceId) return true;
        // 再編成アクションは pieceId がなく localeId で判定
        if (a.type === 'reorganize') {
          const piece = gameState.pieces[selectedPieceId];
          return piece && a.localeId === piece.localeId;
        }
        return false;
      })
    : computeLegalActionsForPiece(selectedPieceId, gameState);

  if (!actionPanel._interruptionActive) {
    actionPanel.showActions(legalActions, gameState.commandPoints, isMyTurn, myState.side);
  }

  // Update piece info
  const piece = selectedPieceId && gameState.pieces ? gameState.pieces[selectedPieceId] : null;
  actionPanel.updatePieceInfo(piece, mapData);
}

/**
 * Simple heuristic: all action types potentially available for a piece.
 * Server enforces actual legality.
 */
function computeLegalActionsForPiece(pieceId, state) {
  if (!pieceId || !state || !state.pieces) return [];
  const piece = state.pieces[pieceId];
  if (!piece) return [];

  // Only own pieces
  if (piece.side !== myState.side) return [];

  const actions = [];

  if (piece.position === 'reserve' || piece.position === null) {
    actions.push({ type: 'cross_country_march' });
    actions.push({ type: 'road_march' });
  } else {
    actions.push({ type: 'cross_country_march' });
    actions.push({ type: 'road_march' });
    actions.push({ type: 'raid' });
    actions.push({ type: 'assault' });
    if (piece.type === 'artillery') {
      actions.push({ type: 'bombardment_declare' });
    }
    if (piece.disordered) {
      actions.push({ type: 'reorganize' });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Canvas interaction
// ---------------------------------------------------------------------------

function handleCanvasClick(sx, sy) {
  if (!gameState) return;

  // Try piece first
  const pid = mapRenderer.getPieceAt(sx, sy, gameState);
  if (pid) {
    selectPiece(pid);
    return;
  }

  // Then locale
  const localeIdx = mapRenderer.getLocaleAt(sx, sy);
  if (localeIdx != null) {
    handleLocaleClick(localeIdx);
  }
}

function clearSelection() {
  selectedPieceId = null;
  legalMoves = [];
  attackTargets = [];
  refreshActionPanel();
  scheduleRender();
}

function selectPiece(pid) {
  selectedPieceId = pid;
  legalMoves = [];
  attackTargets = [];
  updateLegalHighlights();
  refreshActionPanel();
  scheduleRender();
}

/**
 * Populate legalMoves / attackTargets from serverLegalActions for the selected piece.
 */
function updateLegalHighlights() {
  legalMoves = [];
  attackTargets = [];
  if (!selectedPieceId || !serverLegalActions.length) return;

  for (const action of serverLegalActions) {
    if (action.pieceId !== selectedPieceId) continue;

    // Attack actions use different field names for target locale
    if (action.type === 'raid' || action.type === 'bombardment_declare') {
      const dest = action.targetLocaleId;
      if (dest != null && !attackTargets.includes(dest)) attackTargets.push(dest);
    } else if (action.type === 'assault') {
      const dest = action.defenseLocaleId;
      if (dest != null && !attackTargets.includes(dest)) attackTargets.push(dest);
    } else if (action.to && action.to.localeId != null) {
      // March / continuation actions
      const dest = action.to.localeId;
      if (!legalMoves.includes(dest)) legalMoves.push(dest);
    }
  }
}

function handleLocaleClick(localeIdx) {
  if (selectedPieceId) {
    // 行軍系アクション（to.localeId が一致するもの）
    const marchActions = serverLegalActions.filter(a =>
      a.pieceId === selectedPieceId && a.to && a.to.localeId === localeIdx
    );

    if (marchActions.length > 0) {
      // 移動確認ダイアログを表示
      const piece = gameState.pieces[selectedPieceId];
      actionPanel.showMoveConfirmDialog(
        marchActions,
        piece.localeId,
        localeIdx,
        mapData,
        (action) => {
          connection.sendAction({ ...action });
          clearSelection();
        },
        () => refreshActionPanel()
      );
      return;
    }

    // 攻撃系アクション（即時実行）
    const attackAction = serverLegalActions.find(a => {
      if (a.pieceId !== selectedPieceId) return false;
      if ((a.type === 'raid' || a.type === 'bombardment_declare') && a.targetLocaleId === localeIdx) return true;
      if (a.type === 'assault' && a.defenseLocaleId === localeIdx) return true;
      return false;
    });
    if (attackAction) {
      connection.sendAction({ ...attackAction });
      clearSelection();
      scheduleRender();
      return;
    }
  }

  // エリアクリック: そのロケールに自軍駒があれば選択してアクションパネルを更新
  if (gameState && myState.side) {
    const pieceInLocale = Object.values(gameState.pieces).find(
      p => p.localeId === localeIdx && p.side === myState.side && p.strength > 0
    );
    if (pieceInLocale) {
      selectPiece(pieceInLocale.id);
      return;
    }
  }

  scheduleRender();
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function handleConnect() {
  const gameId = inputGameId.value.trim();
  const side   = inputSide.value;
  connectError.textContent = '';

  if (!gameId) {
    connectError.textContent = 'ゲームIDを入力してください';
    return;
  }

  myState = { side, gameId };

  // Update savePanel with the new gameId
  if (savePanel) {
    savePanel.gameId = gameId;
  }

  connection = new Connection(gameId, side, {
    onJoined(s, gId, gs) {
      myState.side   = s;
      myState.gameId = gId;
      if (savePanel) savePanel.gameId = gId;
      connectModal.classList.add('hidden');
      applyState(gs);
      infoPanel.addLog(`ゲームに参加しました (${s === 'france' ? 'フランス' : 'オーストリア'})`);
    },

    onState(gs, la) {
      serverLegalActions = la || [];
      actionPanel.clearInterruptionMode();
      applyState(gs);
      updateLegalHighlights();
    },

    onInterruption(type, options, waitingFor) {
      showInterruption(type, options, waitingFor);
    },

    onControlTransfer(holder, reason) {
      if (gameState) {
        gameState = { ...gameState, controlToken: { holder, reason } };
      }
      infoPanel.updateHeader(gameState, myState.side);
      refreshActionPanel();
      const holderLabel = holder === myState.side ? 'あなた' : '相手';
      infoPanel.addLog(`制御権: ${holderLabel} (${reason})`);
    },

    onGameOver(winner, reason) {
      const label = winner === myState.side ? 'あなたの勝利！' : '相手の勝利';
      infoPanel.addLog(`ゲーム終了: ${label} — ${reason}`);
      if (actionPanel) {
        const el = document.getElementById('actionPanel');
        if (el) {
          el.innerHTML = `<div style="color:#4ecca3;padding:12px;font-size:14px;font-weight:bold;">
            ゲーム終了<br>${label}
          </div>`;
        }
      }
    },

    onError(code, message) {
      infoPanel.addLog(`エラー [${code}]: ${message}`);
      if (connectModal && !connectModal.classList.contains('hidden')) {
        connectError.textContent = message;
      }
    },
  });

  connection.connect();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init().catch(console.error);
