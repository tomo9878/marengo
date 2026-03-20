/**
 * Connection.js
 * WebSocket connection management for Triomphe à Marengo client.
 *
 * Handlers:
 *   onState(gameState)
 *   onInterruption(interruptionType, options, waitingFor)
 *   onControlTransfer(holder, reason)
 *   onError(code, message)
 *   onGameOver(winner, reason)
 *   onJoined(side, gameId, gameState)
 */

export default class Connection {
  /**
   * @param {string} gameId
   * @param {string} side  - 'france' | 'austria'
   * @param {object} handlers
   */
  constructor(gameId, side, handlers) {
    this.gameId = gameId;
    this.side = side;
    this.handlers = handlers || {};
    this.ws = null;
    this._reconnectAttempts = 0;
    this._maxReconnects = 5;
    this._reconnectDelay = 2000;
    this._intentionalClose = false;
  }

  /**
   * Open WebSocket connection to the server.
   * URL: ws://same-host/?gameId=X&side=Y
   */
  connect() {
    this._intentionalClose = false;
    const host = window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${host}/?gameId=${encodeURIComponent(this.gameId)}&side=${encodeURIComponent(this.side)}`;

    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this._reconnectAttempts = 0;
    });

    this.ws.addEventListener('message', (event) => {
      this._handleMessage(event.data);
    });

    this.ws.addEventListener('close', () => {
      if (this._intentionalClose) return;
      this._scheduleReconnect();
    });

    this.ws.addEventListener('error', (err) => {
      if (this.handlers.onError) {
        this.handlers.onError('WS_ERROR', 'WebSocket error');
      }
    });
  }

  /**
   * Send a message to the server.
   * @param {string} type
   * @param {object} payload
   */
  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = { type, gameId: this.gameId, ...payload };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send an ACTION message.
   * @param {object} action
   */
  sendAction(action) {
    this.send('ACTION', { action });
  }

  /**
   * Send a RESPONSE message (for interruptions).
   * @param {object} response
   */
  sendResponse(response) {
    this.send('RESPONSE', { response });
  }

  /**
   * Intentionally close the connection.
   */
  disconnect() {
    this._intentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  _handleMessage(rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'JOINED':
        if (this.handlers.onJoined) {
          this.handlers.onJoined(msg.side, msg.gameId, msg.gameState);
        }
        break;

      case 'STATE_UPDATE':
        if (this.handlers.onState) {
          this.handlers.onState(msg.gameState, msg.legalActions || []);
        }
        break;

      case 'INTERRUPTION':
        if (this.handlers.onInterruption) {
          this.handlers.onInterruption(msg.interruptionType, msg.options, msg.waitingFor);
        }
        break;

      case 'CONTROL_TRANSFER':
        if (this.handlers.onControlTransfer) {
          this.handlers.onControlTransfer(msg.holder, msg.reason);
        }
        break;

      case 'GAME_OVER':
        if (this.handlers.onGameOver) {
          this.handlers.onGameOver(msg.winner, msg.reason);
        }
        break;

      case 'ERROR':
        if (this.handlers.onError) {
          this.handlers.onError(msg.code, msg.message);
        }
        break;

      default:
        break;
    }
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnects) return;
    this._reconnectAttempts++;
    setTimeout(() => {
      if (!this._intentionalClose) {
        this.connect();
      }
    }, this._reconnectDelay);
  }
}
