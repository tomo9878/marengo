'use strict';

/**
 * SaveManager.js
 * Manages game save files in server/saves/{gameId}.json
 */

const fs = require('fs');
const path = require('path');
const { serialize, deserialize } = require('./engine/GameState');

const SAVES_DIR = path.join(__dirname, 'saves');

// Ensure saves directory exists
if (!fs.existsSync(SAVES_DIR)) {
  fs.mkdirSync(SAVES_DIR, { recursive: true });
}

/**
 * Save a game state to disk.
 * @param {string} gameId
 * @param {object} state - full game state
 */
function saveGame(gameId, state) {
  const filePath = path.join(SAVES_DIR, `${gameId}.json`);
  const data = {
    gameId,
    savedAt: new Date().toISOString(),
    state: serialize(state),
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Load a game state from disk.
 * @param {string} gameId
 * @returns {object} deserialized game state
 * @throws {Error} if save file not found
 */
function loadGame(gameId) {
  const filePath = path.join(SAVES_DIR, `${gameId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Save not found: ${gameId}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return deserialize(raw.state);
}

/**
 * List all saved games.
 * @returns {Array<{ gameId: string, savedAt: string }>}
 */
function listSaves() {
  if (!fs.existsSync(SAVES_DIR)) return [];
  const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
  return files.map(file => {
    const filePath = path.join(SAVES_DIR, file);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { gameId: raw.gameId, savedAt: raw.savedAt };
    } catch {
      return { gameId: file.replace('.json', ''), savedAt: null };
    }
  });
}

/**
 * Delete a save file.
 * @param {string} gameId
 */
function deleteGame(gameId) {
  const filePath = path.join(SAVES_DIR, `${gameId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = { saveGame, loadGame, listSaves, deleteGame, SAVES_DIR };
