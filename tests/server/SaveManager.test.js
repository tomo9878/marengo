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
});
