#!/usr/bin/env node
'use strict';

/**
 * scripts/build-map.js
 *
 * marengo_areas_v4.json（エディタの出力）から data/map.json を再構築する。
 *
 * 使い方:
 *   npm run build-map
 *
 * 道路情報（road_type, roadsセグメント）は常に v4 から上書き。
 * 手動入力フィールド（historicalName, capacity, eastOfObjective,
 * setupZone, width, symbols, crossings）は既存の map.json を優先して保持する。
 *
 * つまり:
 *   area_editor.html で道路を修正 → marengo_areas_v4.json を保存
 *   → npm run build-map → data/map.json に反映
 *   手動入力した地名・幅・シンボルは上書きされない。
 */

const fs   = require('fs');
const path = require('path');

const ROOT    = path.resolve(__dirname, '..');
const SRC     = path.join(ROOT, 'marengo_areas_v4.json');
const DEST    = path.join(ROOT, 'data', 'map.json');

// ---------------------------------------------------------------------------
// ファイル読み込み
// ---------------------------------------------------------------------------

if (!fs.existsSync(SRC)) {
  console.error(`ERROR: ソースファイルが見つかりません: ${SRC}`);
  process.exit(1);
}

const v4 = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// 既存の map.json があれば読み込んで手動入力値を引き継ぐ
let existing = null;
if (fs.existsSync(DEST)) {
  try {
    existing = JSON.parse(fs.readFileSync(DEST, 'utf8'));
    console.log('既存の map.json を読み込みました（手動入力値を引き継ぎます）');
  } catch (e) {
    console.warn('既存の map.json の読み込みに失敗しました。新規作成します。');
  }
}

// 既存エリアデータを idx でインデックス化
const existingAreas = new Map(
  (existing?.areas ?? []).map(a => [a.idx, a])
);
const existingCrossings = existing?.crossings ?? [];

// ---------------------------------------------------------------------------
// エリアの変換
// ---------------------------------------------------------------------------

const areas = v4.areas.map(srcArea => {
  const prev = existingAreas.get(srcArea.idx) ?? {};

  const edges = srcArea.edges.map((srcEdge, i) => {
    const prevEdge = prev.edges?.[i] ?? {};
    return {
      id:           srcEdge.id,
      shared_with:  srcEdge.shared_with,
      adj_area_idx: srcEdge.adj_area_idx,
      adj_area_name:srcEdge.adj_area_name,
      // ▼ 常にエディタの値で上書き（道路情報）
      road_type:    srcEdge.road_type,
      mp_cost:      srcEdge.mp_cost,
      // ▼ 手動入力値を引き継ぐ（未設定なら null）
      width:        prevEdge.width   ?? null,
      symbols:      prevEdge.symbols ?? [],
    };
  });

  return {
    idx:             srcArea.idx,
    id:              srcArea.id,
    // ▼ 手動入力値を引き継ぐ
    name:            prev.historicalName ?? srcArea.name,  // historicalName があればそちらを表示名に
    historicalName:  prev.historicalName ?? null,
    color:           srcArea.color,
    capacity:        prev.capacity        ?? srcArea.capacity ?? null,
    eastOfObjective: prev.eastOfObjective ?? null,
    setupZone:       prev.setupZone       ?? null,
    terrain:         srcArea.terrain ?? '',
    mp_cost:         srcArea.mp_cost ?? 1,
    note:            srcArea.note ?? '',
    polygon:         srcArea.polygon,
    edges,
  };
});

// ---------------------------------------------------------------------------
// 統計レポート
// ---------------------------------------------------------------------------

const totalEdges = areas.reduce((s, a) => s + a.edges.length, 0);
const adjEdges   = areas.reduce((s, a) => s + a.edges.filter(e => e.adj_area_idx !== null).length, 0);
const namedAreas = areas.filter(a => a.historicalName).length;
const widthSet   = areas.reduce((s, a) => s + a.edges.filter(e => e.width !== null).length, 0);
const symSet     = areas.reduce((s, a) => s + a.edges.filter(e => e.symbols.length > 0).length, 0);

const roadTypeCounts = { thick: 0, thin: 0, none: 0, null: 0 };
for (const a of areas) {
  for (const e of a.edges) {
    const key = e.road_type ?? 'null';
    roadTypeCounts[key] = (roadTypeCounts[key] ?? 0) + 1;
  }
}

// ---------------------------------------------------------------------------
// 出力
// ---------------------------------------------------------------------------

const output = {
  version: 4,
  meta: {
    description:  'Triomphe à Marengo - map data',
    generatedAt:  new Date().toISOString(),
    source:       'marengo_areas_v4.json',
    todo: [
      namedAreas < areas.length
        ? `historicalName: ${areas.length - namedAreas}/${areas.length} エリアが未設定`
        : 'historicalName: 全エリア設定済み ✅',
      widthSet < adjEdges
        ? `width: ${adjEdges - widthSet}/${adjEdges} 隣接エッジが未設定`
        : 'width: 全隣接エッジ設定済み ✅',
      symSet === 0
        ? 'symbols: アプローチシンボル未設定（地形情報なし）'
        : `symbols: ${symSet} エッジに設定済み`,
      existingCrossings.length === 0
        ? 'crossings: 横断ポイント未設定'
        : `crossings: ${existingCrossings.length} 件設定済み`,
    ],
  },
  map:       v4.map,
  areas,
  roads:     v4.roads ?? [],
  crossings: existingCrossings,
};

fs.writeFileSync(DEST, JSON.stringify(output, null, 2), 'utf8');

// ---------------------------------------------------------------------------
// サマリー表示
// ---------------------------------------------------------------------------

console.log('\n✅ data/map.json を生成しました\n');
console.log('  エリア数       :', areas.length);
console.log('  roadsセグメント:', output.roads.length);
console.log('  road_type      :', JSON.stringify(roadTypeCounts));
console.log('  横断(crossings):', existingCrossings.length, '件');
console.log('\n--- TODO ---');
output.meta.todo.forEach(t => console.log(' ', t));
console.log('');
