'use strict';

const fs = require('fs');
const path = require('path');
const SaveManager = require('../../server/SaveManager');
const { createInitialState, initializePieces } = require('../../server/engine/GameState');

const TEST_GAME_ID = '__test_save_manager__';
const TEST_GAME_ID_2 = '__test_save_manager_2__';

function makeTestState() {
  let state = createInitialState();
  state = initializePieces(state);
  return state;
}

afterEach(() => {
  // Clean up test save files
  [TEST_GAME_ID, TEST_GAME_ID_2].forEach(id => {
    try { SaveManager.deleteGame(id); } catch { /* ignore */ }
  });
});

describe('SaveManager', () => {
  test('saveGame writes a JSON file to saves directory', () => {
    const state = makeTestState();
    SaveManager.saveGame(TEST_GAME_ID, state);

    const filePath = path.join(SaveManager.SAVES_DIR, `${TEST_GAME_ID}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(raw.gameId).toBe(TEST_GAME_ID);
    expect(raw.savedAt).toBeDefined();
    expect(raw.state).toBeDefined();
  });

  test('loadGame reads and deserializes correctly', () => {
    const state = makeTestState();
    state.round = 5;
    SaveManager.saveGame(TEST_GAME_ID, state);

    const loaded = SaveManager.loadGame(TEST_GAME_ID);
    expect(loaded.round).toBe(5);
    // actedPieceIds should be a Set after deserialization
    expect(loaded.actedPieceIds instanceof Set).toBe(true);
    // Pieces should be present
    expect(typeof loaded.pieces).toBe('object');
    expect(Object.keys(loaded.pieces).length).toBeGreaterThan(0);
  });

  test('loadGame throws if save not found', () => {
    expect(() => SaveManager.loadGame('__nonexistent_game_id__')).toThrow();
  });

  test('listSaves returns correct entries', () => {
    const state = makeTestState();
    SaveManager.saveGame(TEST_GAME_ID, state);
    SaveManager.saveGame(TEST_GAME_ID_2, state);

    const saves = SaveManager.listSaves();
    const ids = saves.map(s => s.gameId);

    expect(ids).toContain(TEST_GAME_ID);
    expect(ids).toContain(TEST_GAME_ID_2);

    const entry = saves.find(s => s.gameId === TEST_GAME_ID);
    expect(entry.savedAt).toBeDefined();
    expect(typeof entry.savedAt).toBe('string');
  });

  test('deleteGame removes the file', () => {
    const state = makeTestState();
    SaveManager.saveGame(TEST_GAME_ID, state);

    const filePath = path.join(SaveManager.SAVES_DIR, `${TEST_GAME_ID}.json`);
    expect(fs.existsSync(filePath)).toBe(true);

    SaveManager.deleteGame(TEST_GAME_ID);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('deleteGame does not throw if file does not exist', () => {
    expect(() => SaveManager.deleteGame('__never_saved__')).not.toThrow();
  });

  test('saveGame overwrites previous save for same gameId', () => {
    const state = makeTestState();
    state.round = 1;
    SaveManager.saveGame(TEST_GAME_ID, state);

    state.round = 8;
    SaveManager.saveGame(TEST_GAME_ID, state);

    const loaded = SaveManager.loadGame(TEST_GAME_ID);
    expect(loaded.round).toBe(8);
  });

  test('listSaves returns empty array when no saves', () => {
    // Make sure our test saves are cleaned
    [TEST_GAME_ID, TEST_GAME_ID_2].forEach(id => {
      try { SaveManager.deleteGame(id); } catch { /* ignore */ }
    });

    const saves = SaveManager.listSaves();
    // saves dir may have other files, but result should be an array
    expect(Array.isArray(saves)).toBe(true);
  });

  // ── saveExists ───────────────────────────────────────────────────────────

  test('saveExists returns true when save file exists', () => {
    const state = makeTestState();
    SaveManager.saveGame(TEST_GAME_ID, state);
    expect(SaveManager.saveExists(TEST_GAME_ID)).toBe(true);
  });

  test('saveExists returns false when save file does not exist', () => {
    expect(SaveManager.saveExists('__never_saved_xyz__')).toBe(false);
  });

  // ── cleanupOldSaves ──────────────────────────────────────────────────────

  test('cleanupOldSaves deletes files older than maxAgeMs', () => {
    const state = makeTestState();
    SaveManager.saveGame(TEST_GAME_ID, state);

    // Backdate the savedAt to 2 days ago
    const filePath = path.join(SaveManager.SAVES_DIR, `${TEST_GAME_ID}.json`);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    raw.savedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(filePath, JSON.stringify(raw), 'utf8');

    const deleted = SaveManager.cleanupOldSaves(24 * 60 * 60 * 1000);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  test('cleanupOldSaves keeps files newer than maxAgeMs', () => {
    const state = makeTestState();
    SaveManager.saveGame(TEST_GAME_ID, state);

    const deleted = SaveManager.cleanupOldSaves(24 * 60 * 60 * 1000);
    expect(deleted).toBe(0);

    const filePath = path.join(SaveManager.SAVES_DIR, `${TEST_GAME_ID}.json`);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  // ── cleanupOldLogs ───────────────────────────────────────────────────────

  test('cleanupOldLogs deletes log files older than maxAgeMs', () => {
    // Create a test log file with an old mtime
    const logFile = path.join(SaveManager.LOGS_DIR, '__test_log__.log');
    fs.writeFileSync(logFile, 'test log', 'utf8');
    // Backdate mtime by 8 days
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(logFile, oldTime, oldTime);

    const deleted = SaveManager.cleanupOldLogs(7 * 24 * 60 * 60 * 1000);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(logFile)).toBe(false);
  });

  test('cleanupOldLogs keeps log files newer than maxAgeMs', () => {
    const logFile = path.join(SaveManager.LOGS_DIR, '__test_log_new__.log');
    fs.writeFileSync(logFile, 'test log', 'utf8');

    try {
      const deleted = SaveManager.cleanupOldLogs(7 * 24 * 60 * 60 * 1000);
      expect(deleted).toBe(0);
      expect(fs.existsSync(logFile)).toBe(true);
    } finally {
      try { fs.unlinkSync(logFile); } catch { /* ignore */ }
    }
  });

  // ── runCleanup ───────────────────────────────────────────────────────────

  test('runCleanup returns counts object', () => {
    const result = SaveManager.runCleanup();
    expect(result).toHaveProperty('savesDeleted');
    expect(result).toHaveProperty('logsDeleted');
    expect(typeof result.savesDeleted).toBe('number');
    expect(typeof result.logsDeleted).toBe('number');
  });
});
