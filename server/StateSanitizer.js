'use strict';

/**
 * StateSanitizer.js
 * Sanitize game state for a specific player.
 * Enemy face-down pieces are anonymized.
 */

/**
 * Sanitize a full game state for the given viewer.
 * @param {object} fullState
 * @param {string} viewerSide - 'france' | 'austria' | 'spectator'
 * @returns {object} sanitized state (pieces anonymized as needed)
 */
function sanitize(fullState, viewerSide) {
  const sanitized = JSON.parse(JSON.stringify(fullState, (key, val) => {
    if (val instanceof Set) return { __type: 'Set', values: [...val] };
    return val;
  }));

  // Restore Set if serialized
  if (sanitized.actedPieceIds && sanitized.actedPieceIds.__type === 'Set') {
    sanitized.actedPieceIds = sanitized.actedPieceIds.values;
  }

  if (viewerSide === 'spectator') {
    // 観戦者: 全駒フル情報（faceUpを無視）
    const result = {};
    for (const [id, piece] of Object.entries(fullState.pieces)) {
      result[id] = { ...piece };
    }
    sanitized.pieces = result;
  } else {
    sanitized.pieces = sanitizePieces(fullState.pieces, viewerSide);
  }

  return sanitized;
}

/**
 * Sanitize the pieces map for the given viewer.
 * Own pieces: full info.
 * Enemy faceUp=true: full info.
 * Enemy faceUp=false: anonymized with stable hidden IDs.
 *
 * Stable hidden IDs: sort enemy hidden pieces by localeId then position,
 * assign hidden_0, hidden_1, etc.
 *
 * @param {object} pieces - map of pieceId → piece state
 * @param {string} viewerSide - 'france' | 'austria'
 * @returns {object} sanitized pieces map (keyed by original or hidden id)
 */
function sanitizePieces(pieces, viewerSide) {
  const result = {};

  // Separate visible and hidden enemy pieces
  const hiddenEnemyPieces = [];

  for (const [pieceId, piece] of Object.entries(pieces)) {
    if (piece.side === viewerSide) {
      // Own piece: always full info
      result[pieceId] = { ...piece };
    } else if (piece.faceUp) {
      // Enemy face-up: full info
      result[pieceId] = { ...piece };
    } else {
      // Enemy face-down: will be anonymized
      hiddenEnemyPieces.push(piece);
    }
  }

  // Sort hidden pieces for stable ID assignment: by localeId, then position
  hiddenEnemyPieces.sort((a, b) => {
    const localeCompare = String(a.localeId ?? '').localeCompare(String(b.localeId ?? ''));
    if (localeCompare !== 0) return localeCompare;
    return String(a.position ?? '').localeCompare(String(b.position ?? ''));
  });

  // Assign stable hidden IDs
  hiddenEnemyPieces.forEach((piece, idx) => {
    const hiddenId = `hidden_${idx}`;
    result[hiddenId] = {
      id: hiddenId,
      type: null,
      strength: null,
      maxStrength: null,
      faceUp: false,
      localeId: piece.localeId,
      position: piece.position,
      side: piece.side,
      disordered: piece.disordered,  // 混乱状態は敵側にも公開（視覚マーカー表示用）
      // entryArea は公開情報（増援の時間帯）。フランス増援の待機駒表示に使用
      entryArea: piece.entryArea ?? null,
    };
  });

  return result;
}

module.exports = { sanitize, sanitizePieces };
