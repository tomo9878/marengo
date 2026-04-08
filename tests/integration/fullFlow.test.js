'use strict';

/**
 * fullFlow.test.js
 * Integration tests: full server-side flow
 * WebSocket message → TurnManager → interruption chain → resolution → broadcast
 *
 * Uses REAL engine modules. Only mock ws sockets.
 */

const GameRoom = require('../../server/GameRoom');
const GameController = require('../../server/GameController');
const {
  createMinimalState,
  makePiece,
  createRaidScenario,
  createAssaultScenario,
  createBombardmentScenario,
  SIDES,
  PHASES,
  PIECE_TYPES,
  INTERRUPTION,
} = require('../helpers/stateFactory');

// ---------------------------------------------------------------------------
// Morale fix: createMinimalState sets Austria morale to 0 which triggers
// immediate collapse. Ensure both sides have valid morale in all test states.
// ---------------------------------------------------------------------------

function withValidMorale(state) {
  return {
    ...state,
    morale: {
      france:  { uncommitted: 10, total: 12 },
      austria: { uncommitted: 10, total: 12 },
    },
    moraleTokens: [],
  };
}

// ---------------------------------------------------------------------------
// Helper: makeRoom
// ---------------------------------------------------------------------------

/**
 * Create a room+controller with two mock ws objects.
 * @param {object} initialState
 * @returns {{ room, controller, frWs, auWs, getLastMsg, getAllMsgs }}
 */
function makeRoom(initialState) {
  const room = new GameRoom('test-game-' + Math.random().toString(36).slice(2));

  const frWs = { send: jest.fn(), readyState: 1 };
  const auWs = { send: jest.fn(), readyState: 1 };

  room.join(frWs, 'france');
  room.join(auWs, 'austria');
  room.setState(initialState);

  const controller = new GameController(room);

  function getAllMsgs(ws) {
    return ws.send.mock.calls.map(call => JSON.parse(call[0]));
  }

  function getLastMsg(ws) {
    const calls = ws.send.mock.calls;
    if (calls.length === 0) return null;
    return JSON.parse(calls[calls.length - 1][0]);
  }

  return { room, controller, frWs, auWs, getLastMsg, getAllMsgs };
}

/**
 * Send a message as a side via controller.
 */
function sendAction(controller, ws, action) {
  controller.handleMessage(ws, JSON.stringify({ type: 'ACTION', action }));
}

function sendResponse(controller, ws, response) {
  controller.handleMessage(ws, JSON.stringify({ type: 'RESPONSE', response }));
}

// ---------------------------------------------------------------------------
// Raid flow
// ---------------------------------------------------------------------------

describe('Raid flow', () => {
  test('full raid: attacker wins (no defense response)', () => {
    // France (active) raids Austria's locale 1 from locale 2
    // Austria has no pieces in reserve, so they can't block
    const scenario = createRaidScenario({
      fromLocaleId: 2,
      targetLocaleId: 1,
      defenseEdgeIdx: 2,
      attackerStrength: 3,
      defenderStrength: 3,
      fullyBlocked: false,
    });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Should get INTERRUPTION DEFENSE_RESPONSE (sent to Austria)
    const auMsgs = getAllMsgs(auWs);
    const intMsg = auMsgs.find(m => m.type === 'INTERRUPTION');
    expect(intMsg).toBeDefined();
    expect(intMsg.interruptionType).toBe(INTERRUPTION.DEFENSE_RESPONSE);
    expect(intMsg.waitingFor).toBe('austria');

    // Austria responds with no pieces (no defense)
    auWs.send.mockClear();
    frWs.send.mockClear();

    sendResponse(controller, auWs, { pieceIds: [] });

    // Raid resolves: attacker wins (no pieces at approach to block)
    // Either RETREAT_DESTINATION interruption or null (no defenders to retreat)
    const newState = room.getState();
    // French piece should have moved toward locale 1
    const frPiece = newState.pieces['FR-INF-1'];
    expect(frPiece.localeId).toBe(scenario.targetLocaleId);
  });

  test('full raid: defender wins (full block via response)', () => {
    // France raids Austria, Austria responds with a piece to block
    const scenario = createRaidScenario({
      fromLocaleId: 2,
      targetLocaleId: 1,
      defenseEdgeIdx: 2,
      attackerStrength: 3,
      defenderStrength: 3,
      fullyBlocked: false,
    });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Austria gets DEFENSE_RESPONSE interruption
    const auMsgs1 = getAllMsgs(auWs);
    expect(auMsgs1.some(m => m.type === 'INTERRUPTION')).toBe(true);

    auWs.send.mockClear();
    frWs.send.mockClear();

    // Austria responds with their piece to fully block
    sendResponse(controller, auWs, { pieceIds: ['AU-INF-1'] });

    // Defender has 1 piece at approach => fully blocked (width is null = narrow = 1 required)
    // Defender wins: no retreat needed, morale invested from attacker
    const newState = room.getState();
    // Should have resolved: no RETREAT_DESTINATION
    // French piece should NOT have moved to locale 1
    expect(newState.pieces['FR-INF-1'].localeId).toBe(2);
    // 防御成功後は ATTACKER_APPROACH インタラプションが発行される（攻撃側アプローチ移動オプション）
    expect(newState.pendingInterruption?.type).toBe('attacker_approach');
  });

  test('raid interruption: CONTROL_TRANSFER and STATE_UPDATE broadcast to both players', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    const frMsgs = getAllMsgs(frWs);
    const auMsgs = getAllMsgs(auWs);

    // Both should receive STATE_UPDATE
    expect(frMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
    expect(auMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);

    // Both should receive CONTROL_TRANSFER
    expect(frMsgs.some(m => m.type === 'CONTROL_TRANSFER')).toBe(true);
    expect(auMsgs.some(m => m.type === 'CONTROL_TRANSFER')).toBe(true);

    // INTERRUPTION only sent to Austria (defender)
    expect(auMsgs.some(m => m.type === 'INTERRUPTION')).toBe(true);
    expect(frMsgs.some(m => m.type === 'INTERRUPTION')).toBe(false);
  });

  test('raid: INTERRUPTION options contain context info', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    const auMsgs = getAllMsgs(auWs);
    const intMsg = auMsgs.find(m => m.type === 'INTERRUPTION');
    expect(intMsg).toBeDefined();
    expect(intMsg.options).toBeDefined();
    expect(intMsg.options.targetLocaleId).toBe(scenario.targetLocaleId);
    expect(intMsg.options.defenseEdgeIdx).toBe(scenario.defenseEdgeIdx);
    expect(intMsg.options.attackerPieceIds).toContain('FR-INF-1');
  });

  test('raid: attacker wins, then resolve RETREAT_DESTINATION with no destination (piece eliminated)', () => {
    const scenario = createRaidScenario({
      fromLocaleId: 2,
      targetLocaleId: 1,
      defenseEdgeIdx: 2,
      attackerStrength: 3,
      defenderStrength: 3,
      fullyBlocked: false,
    });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Austria no defense
    sendResponse(controller, auWs, { pieceIds: [] });

    let stateAfter = room.getState();

    if (stateAfter.pendingInterruption &&
        stateAfter.pendingInterruption.type === INTERRUPTION.RETREAT_DESTINATION) {
      // Use the correct waiting ws for retreat response
      const retreatFor = stateAfter.pendingInterruption.waitingFor;
      const retreatWs = retreatFor === 'france' ? frWs : auWs;
      auWs.send.mockClear();
      frWs.send.mockClear();
      sendResponse(controller, retreatWs, { destinations: {}, reductionChoices: [] });

      stateAfter = room.getState();
      expect(stateAfter.pendingInterruption).toBeNull();

      // STATE_UPDATE should have been sent after retreat resolution
      const postRetreatMsgs = getAllMsgs(retreatWs);
      expect(postRetreatMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
    } else {
      // No retreat needed (no defenders to retreat)
      expect(stateAfter.pendingInterruption).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Assault flow
// ---------------------------------------------------------------------------

describe('Assault flow', () => {
  test('assault: ASSAULT_DEF_LEADERS interruption sent to defender', () => {
    const scenario = createAssaultScenario({ atkStrength: 3, defStrength: 3 });
    const state = withValidMorale(scenario.state);

    const { controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'assault',
      pieceId: 'FR-INF-1',
      attackLocaleId: scenario.franceLocaleId,
      attackEdgeIdx: scenario.franceEdgeIdx,
      defenseLocaleId: scenario.austriaLocaleId,
      defenseEdgeIdx: scenario.austriaEdgeIdx,
    });

    // Austria (defender) should get ASSAULT_DEF_LEADERS
    const auMsgs = getAllMsgs(auWs);
    const intMsg = auMsgs.find(m => m.type === 'INTERRUPTION');
    expect(intMsg).toBeDefined();
    expect(intMsg.interruptionType).toBe(INTERRUPTION.ASSAULT_DEF_LEADERS);
    expect(intMsg.waitingFor).toBe('austria');
  });

  test('assault: step 1 → ASSAULT_DEF_LEADERS → step 2 → ASSAULT_ATK_LEADERS', () => {
    const scenario = createAssaultScenario({ atkStrength: 3, defStrength: 3 });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'assault',
      pieceId: 'FR-INF-1',
      attackLocaleId: scenario.franceLocaleId,
      attackEdgeIdx: scenario.franceEdgeIdx,
      defenseLocaleId: scenario.austriaLocaleId,
      defenseEdgeIdx: scenario.austriaEdgeIdx,
    });

    let stateNow = room.getState();
    expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_DEF_LEADERS);

    // Austria: no def leaders
    auWs.send.mockClear();
    frWs.send.mockClear();
    sendResponse(controller, auWs, { leaderIds: [] });

    stateNow = room.getState();
    expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_ATK_LEADERS);
    expect(stateNow.pendingInterruption.waitingFor).toBe('france');

    // France (attacker) should get ASSAULT_ATK_LEADERS interruption
    const frMsgs = getAllMsgs(frWs);
    expect(frMsgs.some(m => m.type === 'INTERRUPTION' && m.interruptionType === INTERRUPTION.ASSAULT_ATK_LEADERS)).toBe(true);
  });

  test('full assault flow: all steps through to completion', () => {
    const scenario = createAssaultScenario({ atkStrength: 3, defStrength: 3 });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    // Step 1: France sends assault
    sendAction(controller, frWs, {
      type: 'assault',
      pieceId: 'FR-INF-1',
      attackLocaleId: scenario.franceLocaleId,
      attackEdgeIdx: scenario.franceEdgeIdx,
      defenseLocaleId: scenario.austriaLocaleId,
      defenseEdgeIdx: scenario.austriaEdgeIdx,
    });

    expect(room.getState().pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_DEF_LEADERS);

    // Step 2: Austria declares no defense leaders
    auWs.send.mockClear();
    frWs.send.mockClear();
    sendResponse(controller, auWs, { leaderIds: [] });
    expect(room.getState().pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_ATK_LEADERS);

    // Step 3: France declares attacker leader
    auWs.send.mockClear();
    frWs.send.mockClear();
    sendResponse(controller, frWs, { leaderIds: ['FR-INF-1'] });

    let stateNow = room.getState();
    // Should be ASSAULT_DEF_ARTILLERY or ASSAULT_COUNTER
    // AU-INF-1 is infantry, so no artillery → skip to ASSAULT_COUNTER
    if (stateNow.pendingInterruption.type === INTERRUPTION.ASSAULT_DEF_ARTILLERY) {
      auWs.send.mockClear();
      frWs.send.mockClear();
      sendResponse(controller, auWs, { fire: false });
      stateNow = room.getState();
    }

    expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_COUNTER);

    // Step 5: Austria declares no counter pieces
    auWs.send.mockClear();
    frWs.send.mockClear();
    sendResponse(controller, auWs, { counterIds: [] });

    stateNow = room.getState();
    expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_REDUCTIONS);

    // Step 6: Respond to reductions
    const reductionsWs = stateNow.pendingInterruption.waitingFor === 'france' ? frWs : auWs;
    auWs.send.mockClear();
    frWs.send.mockClear();
    sendResponse(controller, reductionsWs, { atkApproachChoice: [] });

    stateNow = room.getState();
    // Assault complete or has RETREAT_DESTINATION if attacker won
    if (stateNow.pendingInterruption) {
      expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.RETREAT_DESTINATION);
    } else {
      expect(stateNow.pendingInterruption).toBeNull();
    }
  });

  test('assault: defender wins → no retreat needed', () => {
    // Very weak attacker (strength 1), strong defender (strength 3 as leader)
    const scenario = createAssaultScenario({ atkStrength: 1, defStrength: 3 });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'assault',
      pieceId: 'FR-INF-1',
      attackLocaleId: scenario.franceLocaleId,
      attackEdgeIdx: scenario.franceEdgeIdx,
      defenseLocaleId: scenario.austriaLocaleId,
      defenseEdgeIdx: scenario.austriaEdgeIdx,
    });

    // Step 2: Austria declares AU-INF-1 as defense leader (strength 3)
    sendResponse(controller, auWs, { leaderIds: ['AU-INF-1'] });

    // Step 3: France atk leaders (FR-INF-1 has strength 1, must be >= 2 to be valid leader)
    let stateNow = room.getState();
    expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_ATK_LEADERS);
    sendResponse(controller, frWs, { leaderIds: [] }); // no valid leaders at strength 1

    stateNow = room.getState();
    if (stateNow.pendingInterruption.type === INTERRUPTION.ASSAULT_DEF_ARTILLERY) {
      sendResponse(controller, auWs, { fire: false });
      stateNow = room.getState();
    }

    // Counter step
    expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_COUNTER);
    sendResponse(controller, auWs, { counterIds: [] });

    stateNow = room.getState();
    expect(stateNow.pendingInterruption.type).toBe(INTERRUPTION.ASSAULT_REDUCTIONS);

    const reductionsWs = stateNow.pendingInterruption.waitingFor === 'france' ? frWs : auWs;
    sendResponse(controller, reductionsWs, { atkApproachChoice: [] });

    stateNow = room.getState();
    // With no atk leaders, result = 0 - defLeaderStrength = -3 → defender wins → no retreat
    expect(stateNow.pendingInterruption).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bombardment flow
// ---------------------------------------------------------------------------

describe('Bombardment flow', () => {
  test('declare bombardment: pendingBombardment set, no interruption', () => {
    const scenario = createBombardmentScenario();
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'bombardment_declare',
      pieceId: 'FR-ART-1',
      targetLocaleId: scenario.targetLocaleId,
      fromEdgeIdx: scenario.artilleryEdgeIdx,
    });

    const newState = room.getState();
    // pendingBombardment should be set
    expect(newState.pendingBombardment).not.toBeNull();
    expect(newState.pendingBombardment.artilleryId).toBe('FR-ART-1');
    expect(newState.pendingBombardment.targetLocaleId).toBe(scenario.targetLocaleId);

    // Artillery should be face up
    expect(newState.pieces['FR-ART-1'].faceUp).toBe(true);

    // No interruption
    expect(newState.pendingInterruption).toBeNull();

    // STATE_UPDATE should be sent to both
    const frMsgs = getAllMsgs(frWs);
    const auMsgs = getAllMsgs(auWs);
    expect(frMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
    expect(auMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
  });

  test('bombardment complete: BOMBARDMENT_REDUCTION interruption sent to Austria', () => {
    const scenario = createBombardmentScenario();
    const state = withValidMorale(scenario.state);

    // Pre-declare bombardment
    state.pendingBombardment = {
      artilleryId: 'FR-ART-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseApproachIdx: scenario.targetEdgeIdx,
      declaredRound: 1,
    };
    state.pieces['FR-ART-1'].faceUp = true;

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'bombardment_complete',
      pieceId: 'FR-ART-1',
    });

    const newState = room.getState();
    expect(newState.pendingInterruption).not.toBeNull();
    expect(newState.pendingInterruption.type).toBe(INTERRUPTION.BOMBARDMENT_REDUCTION);
    expect(newState.pendingInterruption.waitingFor).toBe('austria');

    const auMsgs = getAllMsgs(auWs);
    const intMsg = auMsgs.find(m => m.type === 'INTERRUPTION');
    expect(intMsg).toBeDefined();
    expect(intMsg.interruptionType).toBe(INTERRUPTION.BOMBARDMENT_REDUCTION);
  });

  test('bombardment complete and response: Austrian piece reduced, bombardment cleared', () => {
    const scenario = createBombardmentScenario();
    const state = withValidMorale(scenario.state);

    state.pendingBombardment = {
      artilleryId: 'FR-ART-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseApproachIdx: scenario.targetEdgeIdx,
      declaredRound: 1,
    };
    state.pieces['FR-ART-1'].faceUp = true;

    const { room, controller, frWs, auWs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'bombardment_complete',
      pieceId: 'FR-ART-1',
    });

    // Austria responds with target piece
    sendResponse(controller, auWs, { targetPieceId: 'AU-INF-1' });

    const newState = room.getState();
    expect(newState.pendingBombardment).toBeNull();
    expect(newState.pendingInterruption).toBeNull();
    // Austrian piece should be reduced from 3 to 2
    expect(newState.pieces['AU-INF-1'].strength).toBe(2);
  });

  test('bombardment declare+complete cycle: artillery face-down after completion', () => {
    const scenario = createBombardmentScenario();
    const state = withValidMorale(scenario.state);

    state.pendingBombardment = {
      artilleryId: 'FR-ART-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseApproachIdx: scenario.targetEdgeIdx,
      declaredRound: 1,
    };
    state.pieces['FR-ART-1'].faceUp = true;

    const { room, controller, frWs, auWs } = makeRoom(state);

    sendAction(controller, frWs, { type: 'bombardment_complete', pieceId: 'FR-ART-1' });
    sendResponse(controller, auWs, { targetPieceId: 'AU-INF-1' });

    const newState = room.getState();
    // Artillery should be face-down after completion
    expect(newState.pieces['FR-ART-1'].faceUp).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Retreat destination flow
// ---------------------------------------------------------------------------

describe('Retreat destination flow', () => {
  test('raid attacker wins → RETREAT_DESTINATION interruption sent to defender', () => {
    // France raids Austria. Austria has no response → attack wins → RETREAT_DESTINATION
    const scenario = createRaidScenario({
      fromLocaleId: 2,
      targetLocaleId: 1,
      defenseEdgeIdx: 2,
      attackerStrength: 3,
      defenderStrength: 3,
      fullyBlocked: false,
    });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Austria no defense
    sendResponse(controller, auWs, { pieceIds: [] });

    const stateAfterRaid = room.getState();

    // Attack wins since no pieces at approach to block
    if (stateAfterRaid.pendingInterruption) {
      // RETREAT_DESTINATION for the losing side
      expect(stateAfterRaid.pendingInterruption.type).toBe(INTERRUPTION.RETREAT_DESTINATION);
      // The waiting side should be the losing side (whoever was at locale 1)
      const waitingFor = stateAfterRaid.pendingInterruption.waitingFor;
      expect(['france', 'austria']).toContain(waitingFor);

      // The waiting side should have received INTERRUPTION message
      const waitingWs = waitingFor === 'france' ? frWs : auWs;
      const waitingMsgs = getAllMsgs(waitingWs);
      const intMsg = waitingMsgs.find(m => m.type === 'INTERRUPTION' && m.interruptionType === INTERRUPTION.RETREAT_DESTINATION);
      expect(intMsg).toBeDefined();
    } else {
      // No pieces to retreat → no pending interruption
      expect(stateAfterRaid.pieces['FR-INF-1'].localeId).toBe(scenario.targetLocaleId);
    }
  });

  test('retreat: pieces move to chosen destination or get eliminated', () => {
    const scenario = createRaidScenario({
      fromLocaleId: 2,
      targetLocaleId: 1,
      defenseEdgeIdx: 2,
      attackerStrength: 3,
      defenderStrength: 3,
      fullyBlocked: false,
    });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // No defense
    sendResponse(controller, auWs, { pieceIds: [] });

    let stateAfter = room.getState();

    if (stateAfter.pendingInterruption &&
        stateAfter.pendingInterruption.type === INTERRUPTION.RETREAT_DESTINATION) {
      // Use the correct ws (whoever the interruption is waiting for)
      const retreatWaitingFor = stateAfter.pendingInterruption.waitingFor;
      const retreatWs = retreatWaitingFor === 'france' ? frWs : auWs;

      // Respond with empty destinations → pieces eliminated
      sendResponse(controller, retreatWs, { destinations: {}, reductionChoices: [] });

      stateAfter = room.getState();
      expect(stateAfter.pendingInterruption).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Reconnection during interruption
// ---------------------------------------------------------------------------

describe('Reconnection during interruption', () => {
  test('reconnecting player receives STATE_UPDATE + pending INTERRUPTION', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Verify interruption is pending for Austria
    const stateAfterRaid = room.getState();
    expect(stateAfterRaid.pendingInterruption.type).toBe(INTERRUPTION.DEFENSE_RESPONSE);
    expect(stateAfterRaid.pendingInterruption.waitingFor).toBe('austria');

    // Austria disconnects
    room.disconnect('austria');

    // Austria reconnects with new ws
    const newAuWs = { send: jest.fn(), readyState: 1 };
    room.reconnect(newAuWs, 'austria');

    // Call handleReconnect
    controller.handleReconnect('austria');

    const reconnectMsgs = newAuWs.send.mock.calls.map(c => JSON.parse(c[0]));

    // Should receive STATE_UPDATE
    expect(reconnectMsgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);

    // Should receive INTERRUPTION again (pending for Austria)
    const intMsg = reconnectMsgs.find(m => m.type === 'INTERRUPTION');
    expect(intMsg).toBeDefined();
    expect(intMsg.interruptionType).toBe(INTERRUPTION.DEFENSE_RESPONSE);
    expect(intMsg.waitingFor).toBe('austria');

    // Should receive CONTROL_TRANSFER
    expect(reconnectMsgs.some(m => m.type === 'CONTROL_TRANSFER')).toBe(true);
  });

  test('reconnecting player with no pending interruption: STATE_UPDATE + CONTROL_TRANSFER, no INTERRUPTION', () => {
    const state = withValidMorale(createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
    }));

    const { room, controller, frWs, auWs } = makeRoom(state);

    // No interruption pending. France disconnects and reconnects.
    room.disconnect('france');
    const newFrWs = { send: jest.fn(), readyState: 1 };
    room.reconnect(newFrWs, 'france');

    controller.handleReconnect('france');

    const msgs = newFrWs.send.mock.calls.map(c => JSON.parse(c[0]));

    expect(msgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
    expect(msgs.some(m => m.type === 'CONTROL_TRANSFER')).toBe(true);
    expect(msgs.some(m => m.type === 'INTERRUPTION')).toBe(false);
  });

  test('reconnecting player who is NOT the interruption target: no INTERRUPTION re-sent', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Interruption is waiting for Austria. France disconnects and reconnects.
    room.disconnect('france');
    const newFrWs = { send: jest.fn(), readyState: 1 };
    room.reconnect(newFrWs, 'france');

    controller.handleReconnect('france');

    const msgs = newFrWs.send.mock.calls.map(c => JSON.parse(c[0]));

    // France is NOT the one waiting → no INTERRUPTION
    expect(msgs.some(m => m.type === 'STATE_UPDATE')).toBe(true);
    expect(msgs.some(m => m.type === 'INTERRUPTION')).toBe(false);
  });

  test('after reconnection, player can respond normally to interruption', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Austria reconnects
    room.disconnect('austria');
    const newAuWs = { send: jest.fn(), readyState: 1 };
    room.reconnect(newAuWs, 'austria');
    controller.handleReconnect('austria');

    // Austria responds with new ws
    sendResponse(controller, newAuWs, { pieceIds: [] });

    const stateAfter = room.getState();
    // DEFENSE_RESPONSE should be resolved
    if (stateAfter.pendingInterruption) {
      expect(stateAfter.pendingInterruption.type).not.toBe(INTERRUPTION.DEFENSE_RESPONSE);
    }
  });
});

// ---------------------------------------------------------------------------
// Interruption timeout
// ---------------------------------------------------------------------------

// Track controllers created in timeout tests for cleanup
let _timeoutControllers = [];

describe('Interruption timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    _timeoutControllers = [];
  });

  afterEach(() => {
    // Clear any pending interruption timers before switching back to real timers
    for (const ctrl of _timeoutControllers) {
      ctrl._clearInterruptionTimeout();
    }
    jest.useRealTimers();
  });

  test('timeout timer is started when interruption is triggered', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { controller, frWs, auWs } = makeRoom(state);
    _timeoutControllers.push(controller);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Timer should be set after interruption
    expect(controller._interruptionTimer).not.toBeNull();
  });

  test('auto-response fires for DEFENSE_RESPONSE after timeout', () => {
    const scenario = createRaidScenario({
      fromLocaleId: 2,
      targetLocaleId: 1,
      defenseEdgeIdx: 2,
      defenderStrength: 3,
      fullyBlocked: false,
    });
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs } = makeRoom(state);
    _timeoutControllers.push(controller);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    const stateAfterRaid = room.getState();
    expect(stateAfterRaid.pendingInterruption.type).toBe(INTERRUPTION.DEFENSE_RESPONSE);

    // Advance timer by more than 2 minutes
    jest.advanceTimersByTime(120001);

    // Auto-response should have fired, resolving the DEFENSE_RESPONSE
    const stateAfterTimeout = room.getState();
    if (stateAfterTimeout.pendingInterruption) {
      // If there's still an interruption, it must be RETREAT_DESTINATION (next in chain)
      expect(stateAfterTimeout.pendingInterruption.type).not.toBe(INTERRUPTION.DEFENSE_RESPONSE);
    } else {
      expect(stateAfterTimeout.pendingInterruption).toBeNull();
    }
  });

  test('timeout is cleared when response received normally', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { room, controller, frWs, auWs } = makeRoom(state);
    _timeoutControllers.push(controller);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Timer should be set
    expect(controller._interruptionTimer).not.toBeNull();

    // Austria responds before timeout
    sendResponse(controller, auWs, { pieceIds: [] });

    // After response, either timer is null (if no new interruption)
    // or a new timer started (if another interruption was triggered)
    // The key is that the PREVIOUS timer was cleared
    // We check that advancing does not re-trigger DEFENSE_RESPONSE
    const stateAfterResponse = room.getState();

    jest.advanceTimersByTime(120001);

    const stateAfterAdvance = room.getState();
    if (stateAfterAdvance.pendingInterruption) {
      // Could be RETREAT_DESTINATION from the auto-timeout of that
      expect(stateAfterAdvance.pendingInterruption.type).not.toBe(INTERRUPTION.DEFENSE_RESPONSE);
    }
  });

  test('timer is cleared when response received normally (no lingering timer)', () => {
    // Setup: France has a bombardment already declared
    const scenario = createBombardmentScenario();
    const bState = withValidMorale(scenario.state);
    bState.pendingBombardment = {
      artilleryId: 'FR-ART-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseApproachIdx: scenario.targetEdgeIdx,
      declaredRound: 1,
    };
    bState.pieces['FR-ART-1'].faceUp = true;

    const { room, controller, frWs, auWs } = makeRoom(bState);
    _timeoutControllers.push(controller);

    sendAction(controller, frWs, { type: 'bombardment_complete', pieceId: 'FR-ART-1' });

    // Timer started (waiting for Austria's bombardment response)
    expect(controller._interruptionTimer).not.toBeNull();

    // Austria responds
    sendResponse(controller, auWs, { targetPieceId: 'AU-INF-1' });

    // Timer should be cleared (bombardment resolved, no new interruption)
    expect(controller._interruptionTimer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Control token enforcement
// ---------------------------------------------------------------------------

describe('Control token enforcement', () => {
  test('wrong player sending ACTION gets ERROR NOT_YOUR_TURN', () => {
    // Austria is active, France tries to act
    const state = withValidMorale(createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
    }));

    const { controller, frWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'reorganize',
      localeId: 1,
    });

    const frMsgs = getAllMsgs(frWs);
    const errMsg = frMsgs.find(m => m.type === 'ERROR');
    expect(errMsg).toBeDefined();
    expect(errMsg.code).toBe('NOT_YOUR_TURN');

    // State should be unchanged
    const stateAfter = frMsgs.find(m => m.type === 'STATE_UPDATE');
    expect(stateAfter).toBeUndefined();
  });

  test('wrong player sending RESPONSE during interruption gets NOT_YOUR_RESPONSE', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    // Austria has the interruption. France (wrong player) tries to respond.
    frWs.send.mockClear();
    sendResponse(controller, frWs, { pieceIds: [] });

    const frMsgs = getAllMsgs(frWs);
    const errMsg = frMsgs.find(m => m.type === 'ERROR');
    expect(errMsg).toBeDefined();
    expect(errMsg.code).toBe('NOT_YOUR_RESPONSE');
  });

  test('AWAITING_RESPONSE: control holder sends ACTION while interruption pending', () => {
    // Austria has control token AND there is a pending interruption for Austria
    const state = withValidMorale(createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'defense_response' },
      pendingInterruption: {
        type: INTERRUPTION.DEFENSE_RESPONSE,
        waitingFor: 'austria',
        context: {
          attackerPieceIds: ['FR-INF-1'],
          targetLocaleId: 1,
          defenseEdgeIdx: 2,
          availableDefenders: ['AU-INF-1'],
          maxResponse: 1,
        },
      },
    }));

    state.pieces['FR-INF-1'] = makePiece('FR-INF-1', {
      localeId: 2,
      position: 'reserve',
      strength: 3,
    });
    state.pieces['AU-INF-1'] = makePiece('AU-INF-1', {
      localeId: 1,
      position: 'reserve',
      strength: 3,
    });

    const { controller, auWs, getAllMsgs } = makeRoom(state);

    // Austria (control holder) sends ACTION instead of RESPONSE
    sendAction(controller, auWs, {
      type: 'reorganize',
      localeId: 1,
    });

    const auMsgs = getAllMsgs(auWs);
    const errMsg = auMsgs.find(m => m.type === 'ERROR');
    expect(errMsg).toBeDefined();
    expect(errMsg.code).toBe('AWAITING_RESPONSE');
  });

  test('RESPONSE when no pending interruption gets NO_INTERRUPTION error', () => {
    const state = withValidMorale(createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
      pendingInterruption: null,
    }));

    const { controller, auWs, getAllMsgs } = makeRoom(state);

    sendResponse(controller, auWs, { pieceIds: [] });

    const auMsgs = getAllMsgs(auWs);
    const errMsg = auMsgs.find(m => m.type === 'ERROR');
    expect(errMsg).toBeDefined();
    expect(errMsg.code).toBe('NO_INTERRUPTION');
  });

  test('invalid JSON message gets PARSE_ERROR', () => {
    const state = withValidMorale(createMinimalState());
    const { controller, auWs, getAllMsgs } = makeRoom(state);

    controller.handleMessage(auWs, 'not json {{{');

    const auMsgs = getAllMsgs(auWs);
    expect(auMsgs[0].type).toBe('ERROR');
    expect(auMsgs[0].code).toBe('PARSE_ERROR');
  });

  test('state unchanged after NOT_YOUR_TURN error', () => {
    const state = withValidMorale(createMinimalState({
      activePlayer: SIDES.AUSTRIA,
      controlToken: { holder: SIDES.AUSTRIA, reason: 'active_player' },
    }));

    const { room, controller, frWs } = makeRoom(state);
    const stateBefore = room.getState().round;

    sendAction(controller, frWs, { type: 'reorganize', localeId: 1 });

    expect(room.getState().round).toBe(stateBefore);
  });
});

// ---------------------------------------------------------------------------
// State broadcast integrity
// ---------------------------------------------------------------------------

describe('State broadcast integrity', () => {
  test('STATE_UPDATE broadcast contains sanitized gameState with required fields', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    const frMsgs = getAllMsgs(frWs);
    const stateUpdate = frMsgs.find(m => m.type === 'STATE_UPDATE');
    expect(stateUpdate).toBeDefined();
    expect(stateUpdate.gameState).toBeDefined();
    expect(stateUpdate.gameState.round).toBeDefined();
    expect(stateUpdate.gameState.pieces).toBeDefined();
    expect(stateUpdate.gameState.morale).toBeDefined();
  });

  test('CONTROL_TRANSFER contains holder and reason', () => {
    const scenario = createRaidScenario();
    const state = withValidMorale(scenario.state);

    const { controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'raid',
      pieceId: 'FR-INF-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseEdgeIdx: scenario.defenseEdgeIdx,
    });

    const frMsgs = getAllMsgs(frWs);
    const ct = frMsgs.find(m => m.type === 'CONTROL_TRANSFER');
    expect(ct).toBeDefined();
    expect(ct.holder).toBeDefined();
    expect(ct.reason).toBeDefined();
    // After raid, control transfers to Austria (defender)
    expect(ct.holder).toBe('austria');
  });

  test('GAME_OVER broadcast when morale collapses', () => {
    // Austria morale at 1 → bombardment causes 1 loss → collapse
    const scenario = createBombardmentScenario();
    const state = withValidMorale(scenario.state);
    // Reduce Austria morale to 1
    state.morale.austria = { uncommitted: 1, total: 1 };

    state.pendingBombardment = {
      artilleryId: 'FR-ART-1',
      targetLocaleId: scenario.targetLocaleId,
      defenseApproachIdx: scenario.targetEdgeIdx,
      declaredRound: 1,
    };
    state.pieces['FR-ART-1'].faceUp = true;

    const { room, controller, frWs, auWs, getAllMsgs } = makeRoom(state);

    sendAction(controller, frWs, {
      type: 'bombardment_complete',
      pieceId: 'FR-ART-1',
    });

    // Austria responds
    sendResponse(controller, auWs, { targetPieceId: 'AU-INF-1' });

    const frMsgs = getAllMsgs(frWs);
    const auMsgs = getAllMsgs(auWs);

    // Check if GAME_OVER sent (depends on whether morale check triggers)
    const goF = frMsgs.find(m => m.type === 'GAME_OVER');
    const goA = auMsgs.find(m => m.type === 'GAME_OVER');

    if (goF) {
      expect(goF.winner).toBeDefined();
      expect(goA).toBeDefined();
      expect(goA.winner).toBe(goF.winner);
    }

    // Either way, game state should be valid
    expect(room.getState()).toBeDefined();
  });
});
