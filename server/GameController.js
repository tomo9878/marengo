'use strict';

/**
 * GameController.js
 * Handles all incoming messages for a game room.
 * Stateless class — the room holds the state.
 */

const TurnManager = require('./engine/TurnManager');
const { checkVictory } = require('./engine/TurnManager');
const SaveManager = require('./SaveManager');
const { sanitize } = require('./StateSanitizer');
const { INTERRUPTION } = require('./engine/GameState');
const { getValidRetreatDestinations } = require('./engine/CombatResolver');
const { getAllLegalActions } = require('./engine/MoveValidator');

const INTERRUPTION_TIMEOUT_MS = 120000; // 2 minutes

class GameController {
  /**
   * @param {GameRoom} room
   */
  constructor(room) {
    this.room = room;
    this._interruptionTimer = null;
  }

  /**
   * Parse and dispatch an incoming raw message.
   * @param {object} ws
   * @param {string|Buffer} rawMessage
   */
  handleMessage(ws, rawMessage) {
    let msg;
    try {
      msg = JSON.parse(rawMessage.toString());
    } catch {
      this._sendError(ws, 'PARSE_ERROR', 'Invalid JSON');
      return;
    }

    const side = this.room.getSide(ws);
    if (!side) {
      this._sendError(ws, 'NOT_IN_ROOM', 'You are not in this room');
      return;
    }

    // 観戦者はアクション不可
    if (side === 'spectator') {
      this._sendError(ws, 'SPECTATOR_NO_ACTION', 'Spectators cannot perform actions');
      return;
    }

    switch (msg.type) {
      case 'ACTION':
        this._handleAction(ws, side, msg.action);
        break;
      case 'RESPONSE':
        this._handleResponse(ws, side, msg.response);
        break;
      default:
        this._sendError(ws, 'UNKNOWN_MESSAGE', `Unknown message type: ${msg.type}`);
    }
  }

  /**
   * Handle reconnection for a side: re-send state and any pending interruption.
   * @param {string} side - 'france' | 'austria'
   */
  handleReconnect(side) {
    const state = this.room.getState();
    if (!state) return;

    // Re-send current sanitized state
    const sanitizedState = sanitize(state, side);
    this.room.sendTo(side, {
      type: 'STATE_UPDATE',
      gameState: sanitizedState,
    });

    // If there is a pending interruption waiting for the reconnected side, re-send it
    if (state.pendingInterruption && state.pendingInterruption.waitingFor === side) {
      const waitingState = sanitize(state, side);
      this.room.sendTo(side, {
        type: 'INTERRUPTION',
        interruptionType: state.pendingInterruption.type,
        waitingFor: state.pendingInterruption.waitingFor,
        options: state.pendingInterruption.context,
        gameState: waitingState,
      });
    }

    // Send CONTROL_TRANSFER
    this.room.sendTo(side, {
      type: 'CONTROL_TRANSFER',
      holder: state.controlToken.holder,
      reason: state.controlToken.reason,
    });
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Handle an ACTION message from a player.
   * @param {object} ws
   * @param {string} side
   * @param {object} action
   */
  _handleAction(ws, side, action) {
    const state = this.room.getState();

    if (!state) {
      this._sendError(ws, 'NO_STATE', 'Game state not initialized');
      return;
    }

    // Check control token
    if (state.controlToken.holder !== side) {
      this._sendError(ws, 'NOT_YOUR_TURN', 'It is not your turn');
      return;
    }

    // Check no pending interruption
    if (state.pendingInterruption) {
      this._sendError(ws, 'AWAITING_RESPONSE', 'Waiting for interruption response');
      return;
    }

    let result;
    try {
      result = TurnManager.executeAction(action, state);
    } catch (err) {
      this._sendError(ws, 'ACTION_ERROR', err.message);
      return;
    }

    this._afterStateChange(result.newState, result.interruption);
  }

  /**
   * Handle a RESPONSE message from a player.
   * @param {object} ws
   * @param {string} side
   * @param {object} response
   */
  _handleResponse(ws, side, response) {
    const state = this.room.getState();

    if (!state) {
      this._sendError(ws, 'NO_STATE', 'Game state not initialized');
      return;
    }

    // Check there is a pending interruption
    if (!state.pendingInterruption) {
      this._sendError(ws, 'NO_INTERRUPTION', 'No pending interruption');
      return;
    }

    // Check it's the right player responding
    if (state.pendingInterruption.waitingFor !== side) {
      this._sendError(ws, 'NOT_YOUR_RESPONSE', 'This interruption is not waiting for you');
      return;
    }

    let result;
    try {
      result = TurnManager.processInterruption(response, state);
    } catch (err) {
      this._sendError(ws, 'RESPONSE_ERROR', err.message);
      return;
    }

    this._clearInterruptionTimeout();
    this._afterStateChange(result.newState, result.interruption);
  }

  // ---------------------------------------------------------------------------
  // Timeout handling
  // ---------------------------------------------------------------------------

  /**
   * Start a timeout for interruption response. Clears any existing timer.
   * @param {number} [ms]
   */
  _startInterruptionTimeout(ms = INTERRUPTION_TIMEOUT_MS) {
    this._clearInterruptionTimeout();
    this._interruptionTimer = setTimeout(() => {
      this._handleInterruptionTimeout();
    }, ms);
  }

  /**
   * Clear any pending interruption timeout.
   */
  _clearInterruptionTimeout() {
    if (this._interruptionTimer !== null) {
      clearTimeout(this._interruptionTimer);
      this._interruptionTimer = null;
    }
  }

  /**
   * Auto-respond to an interruption after timeout.
   */
  _handleInterruptionTimeout() {
    this._interruptionTimer = null;
    const state = this.room.getState();
    if (!state || !state.pendingInterruption) return;

    const intType = state.pendingInterruption.type;
    const ctx = state.pendingInterruption.context;
    let autoResponse;

    switch (intType) {
      case INTERRUPTION.DEFENSE_RESPONSE:
        // Auto: defender declines (no pieces)
        autoResponse = { pieceIds: [] };
        break;

      case INTERRUPTION.ASSAULT_DEF_LEADERS:
        // Auto: no leaders
        autoResponse = { leaderIds: [] };
        break;

      case INTERRUPTION.ASSAULT_ATK_LEADERS:
        // Auto: first eligible piece from atkAssaultIds
        autoResponse = { leaderIds: ctx.atkAssaultIds && ctx.atkAssaultIds.length > 0
          ? [ctx.atkAssaultIds[0]]
          : [] };
        break;

      case INTERRUPTION.ASSAULT_DEF_ARTILLERY:
        // Auto: don't fire
        autoResponse = { fire: false };
        break;

      case INTERRUPTION.ASSAULT_COUNTER:
        // Auto: no counter pieces
        autoResponse = { counterIds: [] };
        break;

      case INTERRUPTION.ASSAULT_REDUCTIONS: {
        // Auto: default distribution (no custom choice)
        autoResponse = { atkApproachChoice: [] };
        break;
      }

      case INTERRUPTION.BOMBARDMENT_REDUCTION: {
        // Auto: first available target
        const firstTarget = ctx.availableTargets && ctx.availableTargets.length > 0
          ? ctx.availableTargets[0]
          : null;
        autoResponse = { targetPieceId: firstTarget };
        break;
      }

      case INTERRUPTION.RETREAT_DESTINATION: {
        // Auto: first valid destination per piece
        const destinations = {};
        const pieces = state.pieces || {};
        const losingLocaleId = ctx.losingLocaleId;
        const losingSide = ctx.losingSide || ctx.losingside;

        for (const piece of Object.values(pieces)) {
          if (piece.localeId === losingLocaleId && piece.side === losingSide && piece.strength > 0) {
            const validDests = getValidRetreatDestinations(piece.id, losingLocaleId, ctx.attackInfo, state);
            if (validDests.length > 0) {
              destinations[piece.id] = validDests[0];
            }
          }
        }
        autoResponse = { destinations };
        break;
      }

      case INTERRUPTION.ATTACKER_APPROACH:
        // Auto: 全駒をアプローチへ移動（戦略的に有利）
        autoResponse = { pieceIds: ctx.attackerPieceIds || [] };
        break;

      case INTERRUPTION.MORALE_TOKEN_REMOVAL:
        // Auto: 指定数のトークンを先頭ロケールから除去
        autoResponse = {
          localeIds: (ctx.availableTokens || []).slice(0, ctx.amount),
        };
        break;

      case INTERRUPTION.FRANCE_MORALE_RECOVERY:
        // Auto: スキップ（回収しない）
        autoResponse = { localeId: null };
        break;

      default:
        // Unknown type, just respond with empty object
        autoResponse = {};
    }

    // Add to game log
    const logMsg = `[AUTO] Timeout auto-response for ${intType}`;
    const stateWithLog = { ...state, log: [...(state.log || []), { round: state.round, message: logMsg }] };
    this.room.setState(stateWithLog);

    // Process the auto-response
    let result;
    try {
      result = TurnManager.processInterruption(autoResponse, stateWithLog);
    } catch (err) {
      // If processing fails, just log and move on
      return;
    }

    this._afterStateChange(result.newState, result.interruption);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Post-state-change logic: update room, check victory, broadcast.
   * @param {object} newState
   * @param {object|null} interruption
   */
  _afterStateChange(newState, interruption) {
    this.room.setState(newState);

    // Check victory
    const victory = checkVictory(newState);
    if (victory) {
      // Save the final state
      try {
        SaveManager.saveGame(this.room.gameId, newState);
      } catch {
        // Non-fatal
      }
      // Broadcast sanitized state, then game over
      this.room.broadcastSanitized(newState);
      this.room.broadcast({
        type: 'GAME_OVER',
        winner: victory.winner,
        winType: victory.type,
      });
      return;
    }

    // Auto-save after every state change (non-fatal)
    try {
      SaveManager.saveGame(this.room.gameId, newState);
    } catch (e) {
      console.warn('Auto-save failed:', e.message);
    }

    // Compute legal actions for the control token holder and include in STATE_UPDATE
    let legalActions = [];
    try { legalActions = getAllLegalActions(newState); } catch { /* non-fatal */ }
    const holder = newState.controlToken && newState.controlToken.holder;
    const extraFrance  = holder === 'france'  ? { legalActions } : { legalActions: [] };
    const extraAustria = holder === 'austria' ? { legalActions } : { legalActions: [] };

    // Broadcast sanitized state to both players
    this.room.broadcastSanitized(newState, extraFrance, extraAustria);

    // Send interruption or control transfer
    if (interruption) {
      // Start timeout waiting for response
      this._startInterruptionTimeout();

      // Send INTERRUPTION to the waiting player
      const waitingFor = interruption.waitingFor;
      const waitingState = sanitize(newState, waitingFor);

      // Enrich RETREAT_DESTINATION options with per-piece valid destinations
      let interruptionOptions = interruption.context;
      if (interruption.type === INTERRUPTION.RETREAT_DESTINATION) {
        const ctx = interruption.context;
        const losingLocaleId = ctx.losingLocaleId;
        const losingSide = ctx.losingSide || ctx.losingside;
        const pieces = Object.values(newState.pieces)
          .filter(p => p.localeId === losingLocaleId && p.side === losingSide && p.strength > 0)
          .map(p => ({
            pieceId: p.id,
            validDestinations: getValidRetreatDestinations(p.id, losingLocaleId, ctx.attackInfo, newState),
          }));
        interruptionOptions = { ...ctx, pieces };
      }

      this.room.sendTo(waitingFor, {
        type: 'INTERRUPTION',
        interruptionType: interruption.type,
        waitingFor: interruption.waitingFor,
        options: interruptionOptions,
        gameState: waitingState,
      });

      // Send CONTROL_TRANSFER to both
      this.room.broadcast({
        type: 'CONTROL_TRANSFER',
        holder: newState.controlToken.holder,
        reason: newState.controlToken.reason,
      });
    } else {
      // Send CONTROL_TRANSFER to both
      this.room.broadcast({
        type: 'CONTROL_TRANSFER',
        holder: newState.controlToken.holder,
        reason: newState.controlToken.reason,
      });
    }
  }

  /**
   * Send an error message to a specific WebSocket.
   * @param {object} ws
   * @param {string} code
   * @param {string} message
   */
  _sendError(ws, code, message) {
    try {
      ws.send(JSON.stringify({ type: 'ERROR', code, message }));
    } catch {
      // Ignore
    }
  }
}

module.exports = GameController;
