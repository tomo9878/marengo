'use strict';

/**
 * GameRoom.js
 * Manages one game room (2 players: france and austria).
 */

const { sanitize } = require('./StateSanitizer');

class GameRoom {
  /**
   * @param {string} gameId
   */
  constructor(gameId) {
    this.gameId = gameId;
    this._state = null;
    this._players = {
      france: null,   // WebSocket or null
      austria: null,
    };
    this._connected = {
      france: false,
      austria: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  /**
   * Register a player's WebSocket connection.
   * @param {object} ws - WebSocket instance
   * @param {string} side - 'france' | 'austria'
   * @returns {string|null} error string if can't join, null on success
   */
  join(ws, side) {
    if (side !== 'france' && side !== 'austria') {
      return 'Invalid side';
    }
    if (this._connected[side] && this._players[side] && this._players[side] !== ws) {
      return `Side ${side} is already taken`;
    }
    this._players[side] = ws;
    this._connected[side] = true;
    return null;
  }

  /**
   * Mark a player as disconnected (keep state for reconnection).
   * @param {string} side
   */
  disconnect(side) {
    this._connected[side] = false;
    // Keep _players[side] reference for reconnect detection, but ws is closed
  }

  /**
   * Reattach ws for a reconnecting player.
   * @param {object} ws
   * @param {string} side
   */
  reconnect(ws, side) {
    this._players[side] = ws;
    this._connected[side] = true;
  }

  /**
   * Returns true if both sides are connected.
   * @returns {boolean}
   */
  isReady() {
    return this._connected.france && this._connected.austria;
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /**
   * Send a JSON message to one player.
   * @param {string} side
   * @param {object} message
   */
  sendTo(side, message) {
    const ws = this._players[side];
    if (ws && this._connected[side]) {
      try {
        ws.send(JSON.stringify(message));
      } catch (e) {
        // Ignore send errors (connection may be closing)
      }
    }
  }

  /**
   * Send the same message to both players.
   * @param {object} message
   */
  broadcast(message) {
    this.sendTo('france', message);
    this.sendTo('austria', message);
  }

  /**
   * Send sanitized state to each player.
   * Optionally merge extra fields into each player's message.
   * @param {object} fullState
   * @param {object} [extraFrance] - extra fields merged into france's message
   * @param {object} [extraAustria] - extra fields merged into austria's message
   */
  broadcastSanitized(fullState, extraFrance = {}, extraAustria = {}) {
    const franceSanitized = sanitize(fullState, 'france');
    const austriaSanitized = sanitize(fullState, 'austria');

    this.sendTo('france', {
      type: 'STATE_UPDATE',
      gameState: franceSanitized,
      ...extraFrance,
    });
    this.sendTo('austria', {
      type: 'STATE_UPDATE',
      gameState: austriaSanitized,
      ...extraAustria,
    });
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /**
   * Get the current game state.
   * @returns {object|null}
   */
  getState() {
    return this._state;
  }

  /**
   * Set the current game state.
   * @param {object} newState
   */
  setState(newState) {
    this._state = newState;
  }

  /**
   * Get the side for a given WebSocket connection.
   * @param {object} ws
   * @returns {'france'|'austria'|null}
   */
  getSide(ws) {
    if (this._players.france === ws) return 'france';
    if (this._players.austria === ws) return 'austria';
    return null;
  }
}

module.exports = GameRoom;
