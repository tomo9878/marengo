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
let legalMovesCp0 = []; // CP0（主要道路・無料）
let legalMovesCp1 = []; // CP1（細い道・1司令）
let attackTargets = [];
let serverLegalActions = []; // latest legalActions from server

// Solo / spectator mode flags
let isSoloMode = false;
let isSpectatorMode = false;
let soloConnections = null; // { france: Connection, austria: Connection }

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

let _audioCtx = null;

function playTurnPing() {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // AudioContext unavailable
  }
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const connectModal      = document.getElementById('connectModal');
const startSection      = document.getElementById('startSection');
const joinSection       = document.getElementById('joinSection');
const btnCreateGame     = document.getElementById('btnCreateGame');
const createError       = document.getElementById('createError');
const displayGameId     = document.getElementById('displayGameId');
const shareUrlArea      = document.getElementById('shareUrlArea');
const shareUrlInput     = document.getElementById('shareUrlInput');
const btnCopyUrl        = document.getElementById('btnCopyUrl');
const copyFeedback      = document.getElementById('copyFeedback');
const btnBackToStart    = document.getElementById('btnBackToStart');
const inputSide         = document.getElementById('inputSide');
const connectBtn        = document.getElementById('connectBtn');
const connectError      = document.getElementById('connectError');
const canvas            = document.getElementById('mapCanvas');
const btnSave           = document.getElementById('btnSave');
const btnShowSaveList   = document.getElementById('btnShowSaveList');
const saveListContainer = document.getElementById('saveListContainer');
const soloIndicatorEl   = document.getElementById('soloIndicator');
const soloActiveSideEl  = document.getElementById('soloActiveSide');

// Currently pending game ID (set by create or URL param)
let pendingGameId = null;

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

  // Connect modal — create game
  if (btnCreateGame) {
    btnCreateGame.addEventListener('click', handleCreateGame);
  }

  // Connect modal — back to start
  if (btnBackToStart) {
    btnBackToStart.addEventListener('click', () => {
      pendingGameId = null;
      if (startSection) startSection.style.display = '';
      if (joinSection) joinSection.style.display = 'none';
    });
  }

  // Connect modal — copy share URL
  if (btnCopyUrl && shareUrlInput) {
    btnCopyUrl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(shareUrlInput.value);
        if (copyFeedback) {
          copyFeedback.textContent = 'コピーしました！';
          setTimeout(() => { if (copyFeedback) copyFeedback.textContent = ''; }, 2000);
        }
      } catch {
        shareUrlInput.select();
        document.execCommand('copy');
      }
    });
  }

  // Connect modal — connect button
  connectBtn.addEventListener('click', handleConnect);

  // Save panel (created with no gameId initially; updated after connect)
  savePanel = new SavePanel(null, () => {});
  if (btnSave) {
    btnSave.addEventListener('click', () => {
      if (savePanel) savePanel.toggle();
    });
  }

  // Resume from save: show save list, clicking an entry goes to join section
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
            showJoinSection(entry.gameId, false);
            saveListContainer.style.display = 'none';
          });
          saveListContainer.appendChild(row);
        });
      } catch (e) {
        saveListContainer.innerHTML = `<div style="color:#e94560;font-size:11px;">エラー: ${e.message}</div>`;
      }
    });
  }

  // URLパラメータからゲームIDとモードを事前入力
  const urlParams = new URLSearchParams(window.location.search);
  const urlGameId = urlParams.get('gameId');
  const urlSolo   = urlParams.get('solo') === 'true';
  const urlSide   = urlParams.get('side');
  if (urlGameId) showJoinSection(urlGameId, false);
  if (urlSolo && inputSide) inputSide.value = 'solo';
  else if (urlSide && inputSide) inputSide.value = urlSide;

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
      mapRenderer.render(gameState, selectedPieceId, legalMovesCp0, legalMovesCp1, attackTargets, myState);
    }
  });
}

// ---------------------------------------------------------------------------
// Solo mode helpers
// ---------------------------------------------------------------------------

/**
 * ソロモード: 現在アクティブな接続（controlToken.holderの接続）を返す。
 */
function getActiveConn() {
  if (isSoloMode && soloConnections) {
    const side = gameState?.controlToken?.holder || 'france';
    return soloConnections[side] || soloConnections.france;
  }
  return connection;
}

/**
 * 指定サイドの接続を返す（インタラプション応答用）。
 */
function getConnForSide(side) {
  if (isSoloMode && soloConnections) {
    return soloConnections[side] || soloConnections.france;
  }
  return connection;
}

/**
 * ソロモードインジケーターを更新する。
 */
function updateSoloIndicator() {
  if (!soloIndicatorEl) return;
  if (!isSoloMode) {
    soloIndicatorEl.style.display = 'none';
    return;
  }
  soloIndicatorEl.style.display = '';
  if (soloActiveSideEl) {
    const side = myState.side;
    soloActiveSideEl.textContent = side === 'france' ? 'フランス(仏)' : 'オーストリア(墺)';
  }
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Apply a state update from the server.
 * @param {object} newState
 */
function applyState(newState) {
  const prevHolder = gameState?.controlToken?.holder ?? null;
  gameState = newState;

  // 自分のターン開始時にPing音を鳴らす（ソロ・観戦は除外）
  if (!isSoloMode && !isSpectatorMode) {
    const newHolder = gameState?.controlToken?.holder;
    if (newHolder === myState.side && newHolder !== prevHolder) {
      playTurnPing();
    }
  }

  // Update UI
  infoPanel.updateHeader(gameState, myState.side);
  infoPanel.updateMorale(gameState);

  // Flush log entries
  if (gameState.log && Array.isArray(gameState.log)) {
    const last = gameState.log[gameState.log.length - 1];
    if (last) {
      const text = typeof last === 'string' ? last : `[R${last.round} ${last.time}] ${last.message}`;
      infoPanel.addLog(text);
    }
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
  const conn = getActiveConn();
  if (!conn) return;
  conn.sendAction({ type: 'ENTER_MAP', pieceId });
}

/**
 * Handle an interruption from the server.
 */
function showInterruption(interruptionType, options, waitingFor) {
  if (isSpectatorMode) {
    // 観戦者: ログ表示のみ、UI不要（サーバーはINTERRUPTIONを送らないが念のため）
    const label = waitingFor === 'france' ? 'フランス(仏)' : 'オーストリア(墺)';
    infoPanel.addLog(`インタラプション: ${interruptionType} — ${label}応答待ち`);
    infoPanel.updateHeader(gameState, myState.side);
    scheduleRender();
    return;
  }

  if (isSoloMode || waitingFor === myState.side) {
    // ソロモード: 常にUI表示。waitingForの接続で応答を送る
    if (isSoloMode) {
      myState.side = waitingFor; // 応答する側に切り替え
      updateSoloIndicator();
    }
    actionPanel.setInterruptionMode(
      interruptionType,
      options,
      gameState,
      (response) => {
        getConnForSide(waitingFor).sendResponse(response);
      }
    );
  } else {
    // 相手の応答待ち
    infoPanel.addLog(`応答待ち: ${interruptionType} (相手)`);
  }
  infoPanel.updateHeader(gameState, myState.side);
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Action handling
// ---------------------------------------------------------------------------

function handleAction(action) {
  const conn = getActiveConn();
  if (!conn) return;

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
        conn.sendAction({ type: 'reorganize', pieceIds, localeId: reorgAction.localeId });
        clearSelection();
      },
      () => {
        refreshActionPanel();
      }
    );
    return;
  }

  // 行軍アクション: 目的地クリックが必要
  if (action._mapSelect) {
    const piece = selectedPieceId ? gameState.pieces[selectedPieceId] : null;
    const approachActions = piece ? serverLegalActions.filter(a =>
      a.pieceId === selectedPieceId &&
      a.to && a.to.localeId === piece.localeId &&
      a.to.position && a.to.position.startsWith('approach_')
    ) : [];

    if (approachActions.length > 0) {
      actionPanel.showApproachDialog(approachActions, piece.localeId, mapData,
        (act) => { conn.sendAction({ ...act }); clearSelection(); },
        () => refreshActionPanel(),
        gameState
      );
      return;
    }

    infoPanel.addLog('移動先をマップ上でクリックしてください');
    return;
  }

  // 攻撃アクション
  if (['raid', 'assault', 'bombardment_declare'].includes(action.type)) {
    const candidates = serverLegalActions.filter(
      a => a.type === action.type && a.pieceId === selectedPieceId
    );
    if (candidates.length === 0) {
      infoPanel.addLog('このアクションは現在実行できません');
      return;
    }
    if (candidates.length === 1) {
      conn.sendAction(candidates[0]);
      return;
    }
    infoPanel.addLog('攻撃対象をマップ上でクリックしてください');
    return;
  }

  // Enrich action with selected piece
  if (selectedPieceId && !action.pieceId) {
    action.pieceId = selectedPieceId;
  }
  conn.sendAction(action);
}

function handleTurnEnd() {
  const conn = getActiveConn();
  if (!conn) return;
  conn.sendAction({ type: 'end_turn' });
}

function refreshActionPanel() {
  if (!gameState) return;

  // 観戦者: 操作不可メッセージ
  if (isSpectatorMode) {
    actionPanel.showSpectatorMessage();
    return;
  }

  const isMyTurn = isSoloMode
    ? !gameState.pendingInterruption  // ソロ: インタラプションなければ常に手番
    : gameState.controlToken &&
      gameState.controlToken.holder === myState.side &&
      !gameState.pendingInterruption;

  // Use server-authoritative legal actions for selected piece when available
  const legalActions = selectedPieceId && serverLegalActions.length
    ? serverLegalActions.filter(a => {
        if (a.pieceId === selectedPieceId) return true;
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

  // 観戦者・ソロ以外は自駒のみ
  if (!isSoloMode && !isSpectatorMode && piece.side !== myState.side) return [];

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
  legalMovesCp0 = [];
  legalMovesCp1 = [];
  attackTargets = [];
  refreshActionPanel();
  scheduleRender();
}

function selectPiece(pid) {
  selectedPieceId = pid;
  legalMovesCp0 = [];
  legalMovesCp1 = [];
  attackTargets = [];
  updateLegalHighlights();
  refreshActionPanel();
  scheduleRender();
}

/**
 * Populate legalMovesCp0 / legalMovesCp1 / attackTargets from serverLegalActions for the selected piece.
 */
function updateLegalHighlights() {
  legalMovesCp0 = [];
  legalMovesCp1 = [];
  attackTargets = [];
  if (!selectedPieceId || !serverLegalActions.length) return;

  for (const action of serverLegalActions) {
    if (action.pieceId !== selectedPieceId) continue;

    if (action.type === 'raid' || action.type === 'bombardment_declare') {
      const dest = action.targetLocaleId;
      if (dest != null && !attackTargets.includes(dest)) attackTargets.push(dest);
    } else if (action.type === 'assault') {
      const dest = action.defenseLocaleId;
      if (dest != null && !attackTargets.includes(dest)) attackTargets.push(dest);
    } else if (action.to && action.to.localeId != null) {
      const dest = action.to.localeId;
      const cost = action.commandCost ?? 1;
      if (cost === 0) {
        if (!legalMovesCp0.includes(dest)) legalMovesCp0.push(dest);
      } else {
        if (!legalMovesCp0.includes(dest) && !legalMovesCp1.includes(dest)) legalMovesCp1.push(dest);
      }
    }
  }
}

function handleLocaleClick(localeIdx) {
  const conn = getActiveConn();

  if (selectedPieceId && conn) {
    // 行軍系アクション
    const marchActions = serverLegalActions.filter(a =>
      a.pieceId === selectedPieceId && a.to && a.to.localeId === localeIdx
    );

    if (marchActions.length > 0) {
      const piece = gameState.pieces[selectedPieceId];
      actionPanel.showMoveConfirmDialog(
        marchActions,
        piece.localeId,
        localeIdx,
        mapData,
        (action) => {
          conn.sendAction({ ...action });
          clearSelection();
        },
        () => refreshActionPanel(),
        gameState
      );
      return;
    }

    // 攻撃系アクション
    const attackAction = serverLegalActions.find(a => {
      if (a.pieceId !== selectedPieceId) return false;
      if ((a.type === 'raid' || a.type === 'bombardment_declare') && a.targetLocaleId === localeIdx) return true;
      if (a.type === 'assault' && a.defenseLocaleId === localeIdx) return true;
      return false;
    });
    if (attackAction) {
      conn.sendAction({ ...attackAction });
      clearSelection();
      scheduleRender();
      return;
    }
  }

  // エリアクリック: 駒選択
  // ソロ・観戦者は両軍の駒を選択可能
  if (gameState) {
    const canSelectBothSides = isSoloMode || isSpectatorMode;
    const pieceInLocale = Object.values(gameState.pieces).find(p => {
      if (p.localeId !== localeIdx || p.strength <= 0) return false;
      if (canSelectBothSides) return true;
      return myState.side && p.side === myState.side;
    });
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

/**
 * Show the join section with a given gameId.
 * @param {string} gameId
 * @param {boolean} showShare - whether to display the share URL area
 */
function showJoinSection(gameId, showShare) {
  pendingGameId = gameId;
  if (displayGameId) displayGameId.textContent = gameId;
  if (shareUrlArea) {
    if (showShare) {
      if (shareUrlInput) shareUrlInput.value = `${location.origin}/?gameId=${gameId}`;
      shareUrlArea.style.display = '';
    } else {
      shareUrlArea.style.display = 'none';
    }
  }
  if (startSection) startSection.style.display = 'none';
  if (joinSection) joinSection.style.display = '';
}

/**
 * POST /games → get a new auto-generated game ID, then show join section.
 */
async function handleCreateGame() {
  if (createError) createError.textContent = '';
  if (btnCreateGame) btnCreateGame.disabled = true;
  try {
    const resp = await fetch('/games', { method: 'POST' });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${resp.status}`);
    }
    const { gameId } = await resp.json();
    showJoinSection(gameId, true);
  } catch (e) {
    if (createError) createError.textContent = `エラー: ${e.message}`;
  } finally {
    if (btnCreateGame) btnCreateGame.disabled = false;
  }
}

function handleConnect() {
  const gameId = pendingGameId;
  const side   = inputSide.value;
  if (connectError) connectError.textContent = '';

  if (!gameId) {
    if (connectError) connectError.textContent = 'ゲームIDがありません';
    return;
  }

  isSoloMode      = (side === 'solo');
  isSpectatorMode = (side === 'spectator');

  // Update savePanel with the new gameId
  if (savePanel) savePanel.gameId = gameId;

  if (isSoloMode) {
    _connectSolo(gameId);
  } else {
    _connectSingle(gameId, side);
  }
}

/**
 * 通常接続（france / austria / spectator）
 */
function _connectSingle(gameId, side) {
  myState = { side, gameId };

  connection = new Connection(gameId, side, {
    onJoined(s, gId, gs) {
      myState.side   = s;
      myState.gameId = gId;
      if (savePanel) savePanel.gameId = gId;
      connectModal.classList.add('hidden');
      applyState(gs);
      const label = s === 'france' ? 'フランス' : s === 'austria' ? 'オーストリア' : '観戦';
      infoPanel.addLog(`ゲームに参加しました (${label})`);
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
      if (!isSpectatorMode) {
        const holderLabel = holder === myState.side ? 'あなた' : '相手';
        infoPanel.addLog(`制御権: ${holderLabel} (${reason})`);
      } else {
        const label = holder === 'france' ? 'フランス' : 'オーストリア';
        infoPanel.addLog(`制御権: ${label} (${reason})`);
      }
    },

    onGameOver(winner, reason) {
      const label = isSpectatorMode
        ? (winner === 'france' ? 'フランス勝利' : 'オーストリア勝利')
        : (winner === myState.side ? 'あなたの勝利！' : '相手の勝利');
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

/**
 * ソロモード接続（france + austria の2本のWS接続）
 */
function _connectSolo(gameId) {
  myState = { side: 'france', gameId };
  let joinedCount = 0;

  /**
   * 各サイド用ハンドラを生成。
   * - connSide: 'france' | 'austria'（このハンドラを持つ接続のサイド）
   */
  function makeHandlers(connSide) {
    return {
      onJoined(s, gId, gs) {
        joinedCount++;
        myState.gameId = gId;
        if (joinedCount === 1) {
          connectModal.classList.add('hidden');
          infoPanel.addLog(`ソロモード: ${connSide}側 接続中...`);
        } else {
          infoPanel.addLog('ソロモード開始 — 両陣営が接続されました');
        }
        if (savePanel) savePanel.gameId = gId;

        // 制御権を持つサイドの接続からstateを適用する。
        // そのサイドのJOINED stateはフル情報（strength等）を持つため、
        // France sanitized stateによるOffMapPanel空白を防ぐ。
        // 最初の接続か、またはこの接続が制御権サイドの場合にのみ適用。
        const activeHolder = gs.controlToken?.holder || 'france';
        if (joinedCount === 1 || connSide === activeHolder) {
          myState.side = activeHolder;
          applyState(gs);
          updateSoloIndicator();
        }
      },

      onState(gs, la) {
        if (la && la.length > 0) {
          // legalActionsあり = このサイドのターン（通常ケース）
          serverLegalActions = la;
          myState.side = gs.controlToken?.holder || myState.side;
          actionPanel.clearInterruptionMode();
          applyState(gs);
          updateLegalHighlights();
          updateSoloIndicator();
        } else if (gs.pendingInterruption) {
          // インタラプション中: controlToken.holderがconnSideのときだけ更新
          if (gs.controlToken?.holder === connSide) {
            actionPanel.clearInterruptionMode();
            applyState(gs);
          }
        } else if (gs.activePlayer === connSide) {
          // la=[] かつ pendingInterruption なし だが自分のターン
          // （全駒アクション済み・CP不足等でlegalActionsが空のケース）
          // → 自サイドのstate（フルpiece情報）でOffMapPanelを必ず更新する
          serverLegalActions = [];
          myState.side = gs.controlToken?.holder || myState.side;
          applyState(gs);
          updateSoloIndicator();
        }
      },

      onInterruption(type, options, waitingFor) {
        // ソロモード: このconnSideがwaitingForの場合のみUIを表示
        // （サーバーはwaitingFor側にしかINTERRUPTIONを送らない）
        showInterruption(type, options, waitingFor);
      },

      onControlTransfer(holder, reason) {
        if (gameState) gameState = { ...gameState, controlToken: { holder, reason } };
        // フランス側ハンドラのみログ出力（重複防止）
        if (connSide === 'france') {
          myState.side = holder;
          updateSoloIndicator();
          infoPanel.updateHeader(gameState, myState.side);
          refreshActionPanel();
          const label = holder === 'france' ? 'フランス' : 'オーストリア';
          infoPanel.addLog(`制御権: ${label} (${reason})`);
        }
      },

      onGameOver(winner, reason) {
        if (connSide === 'france') { // 重複防止
          const label = winner === 'france' ? 'フランス勝利' : 'オーストリア勝利';
          infoPanel.addLog(`ゲーム終了: ${label} — ${reason}`);
          const el = document.getElementById('actionPanel');
          if (el) {
            el.innerHTML = `<div style="color:#4ecca3;padding:12px;font-size:14px;font-weight:bold;">
              ゲーム終了<br>${label}
            </div>`;
          }
        }
      },

      onError(code, message) {
        infoPanel.addLog(`エラー[${connSide}][${code}]: ${message}`);
        if (connectModal && !connectModal.classList.contains('hidden')) {
          connectError.textContent = message;
        }
      },
    };
  }

  const franceConn  = new Connection(gameId, 'france',  makeHandlers('france'));
  const austriaConn = new Connection(gameId, 'austria', makeHandlers('austria'));
  soloConnections = { france: franceConn, austria: austriaConn };

  franceConn.connect();
  austriaConn.connect();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

init().catch(console.error);
