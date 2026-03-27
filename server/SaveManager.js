'use strict';

/**
 * SaveManager.js
 * Manages game save files in server/saves/{gameId}.json
 * and game log files in server/logs/{gameId}.log
 */

const fs = require('fs');
const path = require('path');
const { serialize, deserialize } = require('./engine/GameState');

const SAVES_DIR = path.join(__dirname, 'saves');
const LOGS_DIR  = path.join(__dirname, 'logs');

// Ensure directories exist
if (!fs.existsSync(SAVES_DIR)) {
  fs.mkdirSync(SAVES_DIR, { recursive: true });
}
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
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

/**
 * Check if a save file exists for the given gameId.
 * @param {string} gameId
 * @returns {boolean}
 */
function saveExists(gameId) {
  return fs.existsSync(path.join(SAVES_DIR, `${gameId}.json`));
}

/**
 * Delete save files older than maxAgeMs milliseconds.
 * @param {number} [maxAgeMs=86400000] - default 24 hours
 * @returns {number} number of files deleted
 */
function cleanupOldSaves(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(SAVES_DIR)) return 0;
  const now = Date.now();
  let deleted = 0;
  const files = fs.readdirSync(SAVES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const filePath = path.join(SAVES_DIR, file);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const ts = raw.savedAt;
      if (ts && (now - new Date(ts).getTime()) > maxAgeMs) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    } catch { /* skip malformed files */ }
  }
  return deleted;
}

/**
 * Delete log files older than maxAgeMs milliseconds.
 * @param {number} [maxAgeMs=604800000] - default 7 days
 * @returns {number} number of files deleted
 */
function cleanupOldLogs(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(LOGS_DIR)) return 0;
  const now = Date.now();
  let deleted = 0;
  const files = fs.readdirSync(LOGS_DIR).filter(f => !f.startsWith('.'));
  for (const file of files) {
    const filePath = path.join(LOGS_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if ((now - stat.mtimeMs) > maxAgeMs) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    } catch { /* skip */ }
  }
  return deleted;
}

/**
 * Run full cleanup: old saves (24h) + old logs (7 days).
 * @returns {{ savesDeleted: number, logsDeleted: number }}
 */
function runCleanup() {
  const savesDeleted = cleanupOldSaves();
  const logsDeleted  = cleanupOldLogs();
  if (savesDeleted > 0 || logsDeleted > 0) {
    console.log(`[Cleanup] Deleted ${savesDeleted} save(s), ${logsDeleted} log(s)`);
  }
  return { savesDeleted, logsDeleted };
}

module.exports = {
  saveGame, loadGame, listSaves, deleteGame,
  saveExists, cleanupOldSaves, cleanupOldLogs, runCleanup,
  SAVES_DIR, LOGS_DIR,
};
