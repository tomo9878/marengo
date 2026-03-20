/**
 * App.js
 * Main entry point for Triomphe à Marengo client.
 * Initializes all modules, wires events.
 */

import Connection from './Connection.js';
import MapRenderer from './MapRenderer.js';
import InfoPanel from './InfoPanel.js';
import ActionPanel from './ActionPanel.js';

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

let gameState = null;
let myState = { side: null, gameId: null };

let connection = null;
let mapRenderer = null;
let infoPanel = null;
let actionPanel = null;
let mapData = null;

let selectedPieceId = null;
let legalMoves = [];
let attackTargets = [];

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const connectModal   = document.getElementById('connectModal');
const inputGameId    = document.getElementById('inputGameId');
const inputSide      = document.getElementById('inputSide');
const connectBtn     = document.getElementById('connectBtn');
const connectError   = document.getElementById('connectError');
const canvas         = document.getElementById('mapCanvas');

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

  // Size canvas
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Init map renderer (with or without map data)
  mapRenderer = new MapRenderer(canvas, mapData || { areas: [], map: { width: 2700, height: 1799 } });
  mapRenderer._onRenderRequest = scheduleRender;
  mapRenderer.fitToCanvas();

  // Canvas click: piece / locale selection
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    handleCanvasClick(sx, sy);
  });

  // Connect modal
  connectBtn.addEventListener('click', handleConnect);
  inputGameId.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleConnect();
  });

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

  // Recompute legal actions for selected piece
  refreshActionPanel();
  scheduleRender();
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

  // Determine legal actions for selected piece
  // (Server enforces legality; client shows what's plausible based on piece state)
  const legalActions = computeLegalActionsForPiece(selectedPieceId, gameState);

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
    actions.push({ type: 'rough_march' });
    actions.push({ type: 'road_march' });
  } else {
    actions.push({ type: 'rough_march' });
    actions.push({ type: 'road_march' });
    actions.push({ type: 'raid' });
    actions.push({ type: 'assault' });
    if (piece.type === 'artillery') {
      actions.push({ type: 'bombardment' });
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

function selectPiece(pid) {
  selectedPieceId = pid;
  legalMoves = [];
  attackTargets = [];
  refreshActionPanel();
  scheduleRender();
}

function handleLocaleClick(localeIdx) {
  // If we have a selected piece and this locale is a legal move destination,
  // trigger move action
  if (selectedPieceId && legalMoves.includes(localeIdx)) {
    handleAction({ type: 'rough_march', targetLocaleId: localeIdx });
    legalMoves = [];
    attackTargets = [];
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

  connection = new Connection(gameId, side, {
    onJoined(s, gId, gs) {
      myState.side   = s;
      myState.gameId = gId;
      connectModal.classList.add('hidden');
      applyState(gs);
      infoPanel.addLog(`ゲームに参加しました (${s === 'france' ? 'フランス' : 'オーストリア'})`);
    },

    onState(gs) {
      actionPanel.clearInterruptionMode();
      applyState(gs);
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
