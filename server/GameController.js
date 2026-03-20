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

class GameController {
  /**
   * @param {GameRoom} room
   */
  constructor(room) {
    this.room = room;
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

    // Broadcast sanitized state to both players
    this.room.broadcastSanitized(newState);

    // Send interruption or control transfer
    if (interruption) {
      // Send INTERRUPTION to the waiting player
      const waitingFor = interruption.waitingFor;
      const waitingState = sanitize(newState, waitingFor);
      this.room.sendTo(waitingFor, {
        type: 'INTERRUPTION',
        interruptionType: interruption.type,
        waitingFor: interruption.waitingFor,
        options: interruption.context,
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
