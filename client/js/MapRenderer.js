/**
 * MapRenderer.js
 * Canvas-based map renderer for Triomphe à Marengo.
 *
 * Coordinate system: map coords (0..2700 x 0..1799).
 * Camera: pan offset (cx, cy) and zoom factor.
 * Screen coords = (mapX * zoom + cx, mapY * zoom + cy).
 */

// Terrain fill colors (fallback to area color from mapData)
const TERRAIN_COLORS = {
  village:  '#4a3a2a',
  forest:   '#1a3a1a',
  marsh:    '#2a3a2a',
  hill:     '#4a4a3a',
  road:     '#6a5a3a',
  plain:    '#2a3a2a',
  '':       '#1e3a1e',
};

const FR_COLOR  = '#3a7bd5';
const AU_COLOR  = '#c0392b';
const PIECE_W   = 30;
const PIECE_H   = 20;

export default class MapRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} mapData  - parsed map.json
   */
  constructor(canvas, mapData) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mapData = mapData;

    // Camera state
    this._zoom = 0.5;
    this._cx = 0;   // canvas offset x
    this._cy = 0;   // canvas offset y

    // Precompute polygon centroids
    this._centroids = this._computeCentroids();

    // Interaction callbacks
    this.onLocaleClick = null;
    this.onPieceClick = null;
    // Called after a piece image finishes loading so the caller can re-render
    this.onImageLoad = null;

    // Preload piece images
    this._images = {};
    this._loadImages();

    // Bind canvas events
    this._bindEvents();
  }

  _loadImages() {
    const names = [
      'FRINF1', 'FRINF2', 'FRINF3',
      'FRCAV1', 'FRCAV2',
      'FRART1',
      'FRback',
      'AUINF1', 'AUINF2', 'AUINF3',
      'AUCAV1', 'AUCAV2',
      'AUART1',
      'AUback',
    ];
    for (const name of names) {
      const img = new Image();
      img.onload = () => {
        this._images[name] = img;
        if (this.onImageLoad) this.onImageLoad();
      };
      img.src = `/assets/images/${name}.png`;
    }

    // Board background image (2700×1799 — same coordinate space as map.json)
    this._boardImg = new Image();
    this._boardImg.onload = () => {
      if (this.onImageLoad) this.onImageLoad();
    };
    this._boardImg.src = '/assets/images/Triomphe-a-Marengo.BOARD.BIG.jpg';
  }

  /** Return the image key for a piece based on side, type, and current strength. */
  _getPieceImageKey(piece) {
    if (!piece.type) {
      // Face-down enemy piece
      return piece.side === 'france' ? 'FRback' : 'AUback';
    }
    const pre = piece.side === 'france' ? 'FR' : 'AU';
    const s = Math.max(1, piece.strength || 1);
    if (piece.type === 'infantry') {
      return `${pre}INF${Math.min(3, s)}`;
    } else if (piece.type === 'cavalry') {
      return `${pre}CAV${Math.min(2, s)}`;
    } else {
      // artillery always strength 1 image
      return `${pre}ART1`;
    }
  }

  // ---------------------------------------------------------------------------
  // Core rendering
  // ---------------------------------------------------------------------------

  /**
   * Full render pass.
   * @param {object|null} gameState
   * @param {string|null} selectedPieceId
   * @param {number[]} legalMoves - array of locale indices
   * @param {number[]} attackTargets - array of locale indices
   * @param {object} myState - { side }
   */
  render(gameState, selectedPieceId, legalMoves, attackTargets, myState) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0f1e';
    ctx.fillRect(0, 0, W, H);

    if (!this.mapData || !this.mapData.areas) return;

    // 1. Draw board image
    if (this._boardImg && this._boardImg.complete && this._boardImg.naturalWidth > 0) {
      const [x0, y0] = this._toScreen(0, 0);
      const [x1, y1] = this._toScreen(2700, 1799);
      ctx.drawImage(this._boardImg, x0, y0, x1 - x0, y1 - y0);
    }

    const areas = this.mapData.areas;

    // 2. Draw locale overlays (semi-transparent highlights only)
    for (const area of areas) {
      this._drawLocale(area, legalMoves, attackTargets, selectedPieceId, gameState);
    }

    // 3. Draw objective line
    this._drawObjectiveLine();

    // 3. Draw pieces
    if (gameState && gameState.pieces) {
      this._drawPieces(gameState, selectedPieceId, myState);
    }

    // 4. Draw morale tokens
    if (gameState && gameState.moraleTokens) {
      this._drawMoraleTokens(gameState.moraleTokens);
    }

    // 5. Draw crossing traffic indicators (step slots 1/2/3 on road edges)
    if (gameState) {
      this._drawCrossingTraffic(gameState);
    }
  }

  _drawLocale(area, legalMoves, attackTargets, selectedPieceId, gameState) {
    const ctx = this.ctx;
    const poly = area.polygon;
    if (!poly || poly.length < 2) return;

    ctx.save();
    ctx.beginPath();
    const [sx, sy] = this._toScreen(poly[0][0], poly[0][1]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < poly.length; i++) {
      const [px, py] = this._toScreen(poly[i][0], poly[i][1]);
      ctx.lineTo(px, py);
    }
    ctx.closePath();

    // Overlay fill: only for legal moves / attack targets (board image is the base)
    const isLegalMove    = legalMoves && legalMoves.includes(area.idx);
    const isAttackTarget = attackTargets && attackTargets.includes(area.idx);

    if (isLegalMove) {
      ctx.fillStyle = 'rgba(78, 204, 163, 0.30)';
      ctx.fill();
    } else if (isAttackTarget) {
      ctx.fillStyle = 'rgba(233, 69, 96, 0.30)';
      ctx.fill();
    }

    // Stroke (subtle border so areas are still clickable/visible)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Selection glow
    if (selectedPieceId && gameState) {
      const piece = gameState.pieces[selectedPieceId];
      if (piece && piece.localeId === area.idx) {
        ctx.strokeStyle = '#4ecca3';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#4ecca3';
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    ctx.restore();

    // Area label
    if (this._zoom >= 0.4) {
      const [cx, cy] = this._centroids[area.idx] || this._calcCentroid(poly);
      const [scx, scy] = this._toScreen(cx, cy);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (this.showAreaIdx) {
        // Debug: show idx number with dark background for readability
        const label = String(area.idx);
        ctx.font = `bold ${Math.max(9, 11 * this._zoom)}px sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        const tw = ctx.measureText(label).width;
        ctx.fillRect(scx - tw / 2 - 3, scy - 8 * this._zoom, tw + 6, 14 * this._zoom);
        ctx.fillStyle = '#ffe44d';
        ctx.fillText(label, scx, scy);
      } else if (area.historicalName && this._zoom >= 0.6) {
        ctx.font = `${Math.max(8, 9 * this._zoom)}px sans-serif`;
        ctx.fillStyle = 'rgba(220,220,220,0.7)';
        ctx.fillText(area.historicalName, scx, scy);
      }

      ctx.restore();
    }
  }

  _drawObjectiveLine() {
    if (!this.mapData || !this.mapData.map) return;
    // Draw a vertical blue line at x=1350 (center of 2700px wide map) as placeholder
    // Real objective x would come from map data
    const objX = this.mapData.objectiveLineX || 1350;
    const [sx] = this._toScreen(objX, 0);
    const [, sy0] = this._toScreen(0, 0);
    const [, sy1] = this._toScreen(0, this.mapData.map.height || 1799);

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(58, 123, 213, 0.5)';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([6, 4]);
    this.ctx.beginPath();
    this.ctx.moveTo(sx, sy0);
    this.ctx.lineTo(sx, sy1);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  /**
   * 駒の描画位置を計算する（横並びレイアウト）。
   * @returns {Object} pieceId → { x, y, pw, ph }
   */
  _computePiecePositions(gameState) {
    const GAP = 2 * this._zoom;
    const pw = PIECE_W * this._zoom;
    const ph = PIECE_H * this._zoom;
    const positions = {};

    // Group pieces by (localeId, position)
    const groups = {};
    for (const [pid, piece] of Object.entries(gameState.pieces)) {
      if (piece.localeId == null) continue;
      const key = `${piece.localeId}:${piece.position || 'reserve'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push([pid, piece]);
    }

    for (const [key, piecePairs] of Object.entries(groups)) {
      const [localeId, position] = key.split(':');
      const lidx = Number(localeId);
      const basePos = this._getPieceScreenPos(lidx, position);
      if (!basePos) continue;

      const [bx, by] = basePos;
      const n = piecePairs.length;
      const totalW = n * pw + (n - 1) * GAP;
      const startX = bx - totalW / 2 + pw / 2;

      piecePairs.forEach(([pid], i) => {
        positions[pid] = { x: startX + i * (pw + GAP), y: by, pw, ph };
      });
    }

    return positions;
  }

  _drawPieces(gameState, selectedPieceId, myState) {
    const positions = this._computePiecePositions(gameState);
    for (const [pid, piece] of Object.entries(gameState.pieces)) {
      const pos = positions[pid];
      if (!pos) continue;

      // アプローチ駒は矢印を先に描画（駒の下）
      const approachMatch = piece.position && piece.position.match(/^approach_(\d+)$/);
      if (approachMatch && piece.localeId != null) {
        const edgeIdx = Number(approachMatch[1]);
        this._drawApproachArrow(piece.localeId, edgeIdx, pos.x, pos.y, pos.pw);
      }

      this._drawPieceToken(pid, piece, pos.x, pos.y, pos.pw, pos.ph, pid === selectedPieceId);
    }
  }

  _drawPieceToken(pid, piece, x, y, pw, ph, isSelected) {
    const ctx = this.ctx;
    ctx.save();

    const rx = x - pw / 2;
    const ry = y - ph / 2;
    const radius = 2;

    const imgKey = this._getPieceImageKey(piece);
    const img = this._images[imgKey];
    const imgReady = img && img.complete && img.naturalWidth > 0;

    if (imgReady) {
      // Draw block image scaled to piece size
      ctx.drawImage(img, rx, ry, pw, ph);
    } else {
      // Fallback: solid color + text until images load
      const bgColor = piece.side === 'france' ? FR_COLOR : AU_COLOR;
      ctx.fillStyle = bgColor;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(rx, ry, pw, ph, radius) : ctx.rect(rx, ry, pw, ph);
      ctx.fill();

      if (this._zoom >= 0.35) {
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!piece.type) {
          ctx.font = `bold ${Math.max(7, 10 * this._zoom)}px sans-serif`;
          ctx.fillText('？', x, y);
        } else {
          const icon = { infantry: '歩', cavalry: '騎', artillery: '砲' }[piece.type] || '?';
          ctx.font = `bold ${Math.max(5, 8 * this._zoom)}px sans-serif`;
          ctx.fillText(icon, x, y);
        }
      }
    }

    // Selection / disorder border overlay (always on top)
    if (isSelected) {
      ctx.shadowColor = '#4ecca3';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = '#4ecca3';
      ctx.lineWidth = Math.max(1.5, 2 * this._zoom);
    } else if (piece.disordered) {
      ctx.shadowColor = '#f0c040';
      ctx.shadowBlur = 4;
      ctx.strokeStyle = '#f0c040';
      ctx.lineWidth = Math.max(1, 1.5 * this._zoom);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 0.5;
    }
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(rx, ry, pw, ph, radius) : ctx.rect(rx, ry, pw, ph);
    ctx.stroke();

    // 混乱インジケーター（オレンジ×印）
    if (piece.disordered) {
      ctx.save();
      ctx.strokeStyle = '#ff8c00';
      ctx.lineWidth = Math.max(1.5, pw * 0.07);
      ctx.globalAlpha = 0.9;
      const pad = pw * 0.12;
      ctx.beginPath();
      ctx.moveTo(rx + pad,      ry + pad);
      ctx.lineTo(rx + pw - pad, ry + ph - pad);
      ctx.moveTo(rx + pw - pad, ry + pad);
      ctx.lineTo(rx + pad,      ry + ph - pad);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawMoraleTokens(moraleTokens) {
    for (const token of moraleTokens) {
      const centroid = this._centroids[token.localeId];
      if (!centroid) continue;
      const [sx, sy] = this._toScreen(centroid[0], centroid[1] + 15);
      const r = Math.max(3, 5 * this._zoom);

      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(sx, sy, r, 0, Math.PI * 2);
      this.ctx.fillStyle = token.side === 'france' ? FR_COLOR : AU_COLOR;
      this.ctx.fill();
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 0.5;
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------
  // 横断トラフィック表示
  // ---------------------------------------------------------------------------

  /**
   * 全道路エッジの境界線中点に、ステップスロット(1/2/3)のバッジを描画する。
   * 使用済み→赤、空き→緑。トラフィックがないエッジは薄く表示。
   */
  _drawCrossingTraffic(gameState) {
    if (!this.mapData || !this.mapData.areas) return;
    if (this._zoom < 0.35) return; // 縮小時は非表示

    const traffic = gameState.crossingTraffic || {};
    const drawn = new Set(); // 同じ横断を2重描画しない

    for (const area of this.mapData.areas) {
      const poly = area.polygon;
      if (!poly || poly.length < 2) continue;

      for (let ei = 0; ei < area.edges.length; ei++) {
        const edge = area.edges[ei];
        if (!edge.road_type || edge.road_type === 'none') continue;
        if (edge.adj_area_idx === null || edge.adj_area_idx === undefined) continue;
        if (!edge.id) continue;

        // canonical ID（辞書順で小さい方）で重複排除
        const myId    = edge.id;
        const theirId = edge.shared_with;
        const canonId = (!theirId || myId < theirId) ? myId : theirId;
        if (drawn.has(canonId)) continue;
        drawn.add(canonId);

        // エッジ中点を計算
        const p0 = poly[ei];
        const p1 = poly[(ei + 1) % poly.length];
        if (!p0 || !p1) continue;
        const mx = (p0[0] + p1[0]) / 2;
        const my = (p0[1] + p1[1]) / 2;
        const [sx, sy] = this._toScreen(mx, my);

        const usedSteps  = new Set((traffic[canonId] || []).map(t => t.steps));
        const hasTraffic = usedSteps.size > 0;

        this._drawStepBadges(sx, sy, usedSteps, edge.road_type, hasTraffic);
      }
    }
  }

  /**
   * 1・2・3 のステップバッジを1組描画する。
   * @param {number} sx - スクリーンX
   * @param {number} sy - スクリーンY
   * @param {Set<number>} usedSteps - 使用済みステップ番号
   * @param {'thick'|'thin'} roadType
   * @param {boolean} hasTraffic - いずれかのスロットが使用中か
   */
  _drawStepBadges(sx, sy, usedSteps, roadType, hasTraffic) {
    const ctx  = this.ctx;
    const r    = Math.max(5, 7 * this._zoom);   // バッジ半径
    const gap  = Math.max(12, 16 * this._zoom); // バッジ間隔
    const alpha = hasTraffic ? 0.95 : 0.40;     // トラフィックなしは薄く

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${Math.max(6, 8 * this._zoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let step = 1; step <= 3; step++) {
      const bx = sx + (step - 2) * gap; // step2 が中心
      const occupied = usedSteps.has(step);

      // 背景丸
      ctx.beginPath();
      ctx.arc(bx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = occupied ? '#c0392b' : '#27ae60';
      ctx.fill();

      // 枠線（太道路=金、細道=白）
      ctx.strokeStyle = roadType === 'thick' ? '#f1c40f' : 'rgba(255,255,255,0.7)';
      ctx.lineWidth   = occupied ? 1.5 : 0.8;
      ctx.stroke();

      // ステップ番号
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(step), bx, sy);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Camera / zoom
  // ---------------------------------------------------------------------------

  setZoom(factor) {
    this._zoom = Math.max(0.3, Math.min(2.0, factor));
  }

  pan(dx, dy) {
    this._cx += dx;
    this._cy += dy;
  }

  centerOn(localeIdx) {
    const centroid = this._centroids[localeIdx];
    if (!centroid) return;
    this._cx = this.canvas.width  / 2 - centroid[0] * this._zoom;
    this._cy = this.canvas.height / 2 - centroid[1] * this._zoom;
  }

  /**
   * Convert canvas (screen) coords to map coords.
   */
  screenToMap(sx, sy) {
    return [
      (sx - this._cx) / this._zoom,
      (sy - this._cy) / this._zoom,
    ];
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  /**
   * Return locale index at canvas point, or null.
   */
  getLocaleAt(sx, sy) {
    if (!this.mapData || !this.mapData.areas) return null;
    const [mx, my] = this.screenToMap(sx, sy);
    for (const area of this.mapData.areas) {
      if (area.polygon && this._pointInPolygon(mx, my, area.polygon)) {
        return area.idx;
      }
    }
    return null;
  }

  /**
   * Return pieceId at canvas point, or null.
   */
  getPieceAt(sx, sy, gameState) {
    if (!gameState || !gameState.pieces) return null;
    const positions = this._computePiecePositions(gameState);

    // 後から描かれた駒を優先（逆順）
    const pids = Object.keys(gameState.pieces).reverse();
    for (const pid of pids) {
      const pos = positions[pid];
      if (!pos) continue;
      const { x, y, pw, ph } = pos;
      if (sx >= x - pw / 2 && sx <= x + pw / 2 &&
          sy >= y - ph / 2 && sy <= y + ph / 2) {
        return pid;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private utilities
  // ---------------------------------------------------------------------------

  _toScreen(mx, my) {
    return [mx * this._zoom + this._cx, my * this._zoom + this._cy];
  }

  _computeCentroids() {
    const result = {};
    if (!this.mapData || !this.mapData.areas) return result;
    for (const area of this.mapData.areas) {
      if (area.polygon) {
        result[area.idx] = this._calcCentroid(area.polygon);
      }
    }
    return result;
  }

  _calcCentroid(poly) {
    let sx = 0, sy = 0;
    for (const [x, y] of poly) { sx += x; sy += y; }
    return [sx / poly.length, sy / poly.length];
  }

  /**
   * Get screen position for a piece given its locale index and position string.
   * position: 'reserve' | 'approach_N'
   */
  _getPieceScreenPos(localeIdx, position) {
    const area = this.mapData && this.mapData.areas
      ? this.mapData.areas.find(a => a.idx === localeIdx)
      : null;

    if (!area || !area.polygon) return null;

    if (!position || position === 'reserve') {
      const c = this._centroids[localeIdx];
      if (!c) return null;
      return this._toScreen(c[0], c[1]);
    }

    // approach_N: 重心からエッジ中点の75%地点に配置（ズーム非依存）
    const match = position.match(/^approach_(\d+)$/);
    if (!match) return null;
    const edgeIdx = Number(match[1]);
    const poly = area.polygon;
    const n = poly.length;
    if (edgeIdx >= n) return null;

    const p0 = poly[edgeIdx];
    const p1 = poly[(edgeIdx + 1) % n];
    const midX = (p0[0] + p1[0]) / 2;
    const midY = (p0[1] + p1[1]) / 2;

    // 重心からエッジ中点に向かって 75% の地点（明確にエッジ側）
    const c = this._centroids[localeIdx] || this._calcCentroid(poly);
    const t = 0.75;
    const ox = c[0] + t * (midX - c[0]);
    const oy = c[1] + t * (midY - c[1]);

    return this._toScreen(ox, oy);
  }

  /**
   * アプローチ駒の方向矢印を描画する（駒からエッジ方向へ）。
   */
  _drawApproachArrow(localeIdx, edgeIdx, sx, sy, pw) {
    const area = this.mapData && this.mapData.areas
      ? this.mapData.areas.find(a => a.idx === localeIdx)
      : null;
    if (!area || !area.polygon) return;

    const poly = area.polygon;
    if (edgeIdx >= poly.length) return;

    const p0 = poly[edgeIdx];
    const p1 = poly[(edgeIdx + 1) % poly.length];
    const midX = (p0[0] + p1[0]) / 2;
    const midY = (p0[1] + p1[1]) / 2;
    const c = this._centroids[localeIdx] || this._calcCentroid(poly);

    // 重心→エッジ方向の単位ベクトル
    const dx = midX - c[0];
    const dy = midY - c[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    const arrowLen = (pw / 2) * 1.5;
    const ctx = this.ctx;
    const ax = sx + nx * (pw / 2 + 1);
    const ay = sy + ny * (pw / 2 + 1);
    const ex = ax + nx * arrowLen;
    const ey = ay + ny * arrowLen;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 210, 40, 0.9)';
    ctx.lineWidth = Math.max(1.5, 2 * this._zoom);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.stroke();

    // 矢印先端
    const hw = Math.max(3, 4 * this._zoom);
    ctx.fillStyle = 'rgba(255, 210, 40, 0.9)';
    ctx.beginPath();
    ctx.moveTo(ex + nx * hw, ey + ny * hw);
    ctx.lineTo(ex - nx * hw - ny * hw / 1.5, ey - ny * hw + nx * hw / 1.5);
    ctx.lineTo(ex - nx * hw + ny * hw / 1.5, ey - ny * hw - nx * hw / 1.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Ray-casting point-in-polygon test.
   */
  _pointInPolygon(px, py, poly) {
    let inside = false;
    const n = poly.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Fit the map to the canvas on initial load.
   */
  fitToCanvas() {
    if (!this.mapData || !this.mapData.map) return;
    const mapW = this.mapData.map.width  || 2700;
    const mapH = this.mapData.map.height || 1799;
    const scaleX = this.canvas.width  / mapW;
    const scaleY = this.canvas.height / mapH;
    this._zoom = Math.min(scaleX, scaleY, 1.0);
    this._cx = (this.canvas.width  - mapW * this._zoom) / 2;
    this._cy = (this.canvas.height - mapH * this._zoom) / 2;
  }

  // ---------------------------------------------------------------------------
  // Event binding (zoom, pan)
  // ---------------------------------------------------------------------------

  _bindEvents() {
    const canvas = this.canvas;

    // Wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const prevZoom = this._zoom;
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      this._zoom = Math.max(0.3, Math.min(2.0, this._zoom * delta));

      // Zoom toward mouse position
      this._cx = mouseX - (mouseX - this._cx) * (this._zoom / prevZoom);
      this._cy = mouseY - (mouseY - this._cy) * (this._zoom / prevZoom);

      if (this._onRenderRequest) this._onRenderRequest();
    }, { passive: false });

    // Pan (drag)
    let dragging = false;
    let lastX = 0, lastY = 0;

    canvas.addEventListener('mousedown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.pan(dx, dy);
      if (this._onRenderRequest) this._onRenderRequest();
    });

    canvas.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('mouseleave', () => { dragging = false; });

    // Click → locale / piece selection
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (this.onPieceClick) {
        // piece click is handled by App.js via getPieceAt
      }
      if (this.onLocaleClick) {
        const idx = this.getLocaleAt(sx, sy);
        this.onLocaleClick(idx, sx, sy);
      }
    });
  }
}
