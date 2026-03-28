# Triomphe à Marengo v1.6 — 開発状況サマリ

**更新日: 2026-03-27**

---

## プロジェクト概要

「マレンゴの戦い（1800年6月14日）」を題材にしたボードウォーゲームのWebオンライン対戦実装。

- **スタック**: Node.js（サーバー）/ Vanilla JS（クライアント）/ WebSocket（リアルタイム通信）
- **設計原則**: Authoritative Server（サーバーが唯一の正状態）、イミュータブル状態更新
- **ルールブック参照**: `TRIOMPHE_A_MARENGO_JP.pdf`

---

## アーキテクチャ

```
server/
  index.js            — WebSocket サーバー起動
  GameRoom.js         — ルーム管理（2プレイヤー）
  GameController.js   — クライアント通信・インタラプション通知
  SaveManager.js      — JSON セーブ/ロード
  StateSanitizer.js   — クライアントへの状態送信（情報隠蔽）
  engine/
    GameState.js      — 状態定義・生成・クローン・シリアライズ
    MapGraph.js       — マップグラフ（隣接・横断・アプローチ幅・障害物）
    MoveValidator.js  — 合法アクション生成（行軍・道路行軍・急襲・砲撃・増援）
    TurnManager.js    — アクション実行・インタラプション処理・ターン進行
    CombatResolver.js — 戦闘解決（急襲・突撃・退却・砲撃）
    MoraleManager.js  — 士気変動（投入・減少・クリーンアップ・崩壊判定）

client/js/
  App.js            — 初期化・イベントバインド
  Connection.js     — WebSocket 通信
  MapRenderer.js    — マップ描画（Canvas）
  ActionPanel.js    — アクションボタン UI
  CombatDialog.js   — インタラプション UI（急襲応答・突撃各ステップ・退却先選択）
  InfoPanel.js      — 士気・CP・ログ表示
  OffMapPanel.js    — オフマップ駒表示
  SavePanel.js      — セーブ/ロード UI

data/
  map.json          — マップデータ（90エリア・43道路セグメント・横断定義）
  pieces.json       — 駒定義（オーストリア・フランス）
  scenarios.json    — シナリオ設定（初期士気・タイムトラック・増援スケジュール）
```

---

## 実装済み機能

### コアゲームエンジン

| 機能 | 状態 | 備考 |
|------|------|------|
| 行軍（March） | ✅ | 通常行軍・道路行軍・大道路行軍 |
| 急襲（Raid） | ✅ | 防御応答・完全ブロック判定・士気投入 |
| 道路行軍急襲（Road March Raid） | ✅ | 騎兵専用・横断指定・勝利=継続行軍可・敗北=行軍終了 |
| 突撃（Assault） | ✅ | 5ステップフロー（DefLeaders→AtkLeaders→DefArtillery→Counter→Reductions） |
| 砲撃（Bombardment） | ✅ | 宣言・完遂・キャンセル |
| 退却（Retreat） | ✅ | 人間選択 UI・退却先バリデーション |
| 増援進入（Entry） | ✅ | 交通制限・進入ロケール保護 |
| シャッフル | ✅ | 同一ポジション内の駒順序入れ替え |

### 士気システム

| 機能 | 状態 | 備考 |
|------|------|------|
| 急襲防御成功 → 士気投入（1 or 2個） | ✅ | wide+2攻撃+最初の急襲で2個 |
| 突撃勝利 → 防御側が先導/カウンター数だけ投入 | ✅ | `processAssaultReductions` |
| オーストリア退却 → 退却駒数だけ投入 | ✅ | `resolveRetreat` |
| 戦力減少 → 士気低下（敗者のみ） | ✅ | 勝者は `reduceMorale` されない |
| 士気クリーンアップ（ターン終了） | ✅ | 最後の占拠者が敵なら除去 |
| MORALE_TOKEN_REMOVAL インタラプション | ✅ | uncommitted 不足時、相手がマップ駒を選んで除去 |
| FRANCE_MORALE_RECOVERY（ラウンド1〜10） | ✅ | 直前の敵ターン置きトークンは対象外 |
| 士気崩壊（≤0）→ 即時ゲーム終了 | ✅ | `checkMoraleCollapse` / `checkVictory` |
| 周期的士気更新（タイムトラック） | ✅ | `periodicMoraleUpdate` |

### マップ・地形

| 機能 | 状態 | 備考 |
|------|------|------|
| アプローチ幅（narrow/wide） | ✅ | wide は2体で完全ブロック |
| 障害物ペナルティ（inf_obstacle/cav_obstacle） | ✅ | 突撃結果計算に反映 |
| 騎兵通行不可（cav_impassable） | ✅ | 急襲・突撃先導・カウンター全て禁止 |
| 複数横断（locales 9-10など） | ✅ | 交通制限が横断ごとに独立 |

### インタラプションフロー

全インタラプション種別が実装済み:
- `DEFENSE_RESPONSE` — 急襲防御応答（通常・道路行軍急襲）
- `ASSAULT_DEF_LEADERS` / `ASSAULT_ATK_LEADERS` — 突撃先導駒選択
- `ASSAULT_DEF_ARTILLERY` — 防御砲撃宣言
- `ASSAULT_COUNTER` — カウンター駒選択
- `ASSAULT_REDUCTIONS` — 戦力減少割り当て
- `BOMBARDMENT_REDUCTION` — 砲撃被弾駒選択
- `RETREAT_DESTINATION` — 退却先選択（人間選択 UI）
- `ATTACKER_APPROACH` — 急襲後の攻撃側アプローチ移動オプション
- `MORALE_TOKEN_REMOVAL` — マップ士気トークン除去選択
- `FRANCE_MORALE_RECOVERY` — フランス士気トークン回収選択

---

## テストスイート（2026-03-28時点）

全20ファイル、**299アサーション全パス**（morale_interruptions.js は既知クラッシュで除外）。

```
assault_blocked_approach.js    20 passed  突撃敗北後のアプローチ封鎖
assault_patterns.js            39 passed  突撃全パターン（7シナリオ）
bombardment_cancel.js          11 passed  砲撃宣言キャンセル
cav_impassable.js               6 passed  騎兵通行不可（急襲/先導/カウンター禁止）
cav_obstacle_leaders.js         6 passed  騎兵障害物（先導駒・カウンター禁止）
continuation_march.js          21 passed  継続行軍（騎兵・道路/悪路別）
entry_crossing_traffic.js      19 passed  増援進入時の交通制限
entry_locale_protection.js      8 passed  進入ロケール保護
entry_march_integrated.js      25 passed  増援進入+道路行軍一体化
france_morale_recovery_enemy_turn.js  9 passed  フランス回収・敵ターン置き除外
france_round1_no_block.js       7 passed  ラウンド1フランス混乱（ブロック不可）
group_march.js                 29 passed  グループ悪路行軍（セクション7）
morale_cleanup_last_occupant.js 9 passed  士気クリーンアップ（最後の占拠者条件）
morale_combat.js               28 passed  戦闘6パターン士気変動
morale_interruptions.js        ❌ クラッシュ（既知・未修正）
multiple_crossings.js          12 passed  複数横断の独立交通制限
obstacle_penalty.js             7 passed  障害物ペナルティ計算
raid_cavalry_obstacle.js        6 passed  急襲騎兵障害物チェック
raid_morale_first.js            9 passed  急襲士気2トークン「最初の急襲」条件
road_march_raid.js             18 passed  道路行軍急襲（セクション8）
shuffle.js                     10 passed  シャッフルアクション
```

テスト実行: `node tests/<ファイル名>.js`

---

## 未実装・既知の制限

### IMPLEMENTATION_CHECKLIST.md の未チェック項目

- [ ] **#9: 道路行軍急襲のクライアント側 UI**
  - エンジン側は完全実装済み。`getLegalRoadMoves` が `raidTargetLocaleId` / `raidDefenseEdgeIdx` / `raidCrossingId` を返す
  - クライアント側で「この道路行軍は急襲を含む」と明示する UI が未実装

### マップデータの未設定辺

以下のアプローチは `width` 未設定（narrow/wide が不明）:
`e4-0, e5-2, e10-3, e10-4, e11-4, e14-2, e34-3, e41-2, e70-2`

### 退却先バリデーション

`getValidRetreatDestinations` の `can_retreat_through` シンボルチェックは未実装。
現在は隣接ロケールを全て有効退却先として返す。

### エリア名

全90エリアが「エリア_N」のままで正式名称未入力（ユーザー確認済みで現状維持）。

---

## 直近のセッションで実装した内容

### 2026-03-28（今セッション）
- **急襲防御成功後 ATTACKER_APPROACH インタラプション生成**
  - `processDefenseResponse` で防御側勝利時に `ATTACKER_APPROACH` を発行
  - 攻撃側はアプローチへの移動を選択できるようになった
  - `morale_combat.js` 2件修正（26→28 passed）
  - テスト: `entry_march_integrated.js`（25件）新規作成

- **オーストリア増援進入と道路行軍の一体化**
  - `GameState.enteredThisTurn` 新フィールド（入場後の残行軍ステップ管理）
  - `TurnManager.executeEnterMap`: 入場順に残ステップ付与（1駒目→2、2駒目→1、3/4駒目→0）
  - `TurnManager.executeMarch`: 入場直後駒の行軍完了で actedPieceIds に追加
  - `MoveValidator`: 入場直後駒は道路行軍のみ可（悪路/急襲/突撃/砲撃不可）
  - `GameState.resetCommandPoints`: ターン開始時に `enteredThisTurn` クリア

- **フランス混乱駒の disorder マーカーをオーストリア側に公開**
  - `StateSanitizer.sanitizePieces`: 隠蔽駒の `disordered` を実値で送信（`false` 固定から変更）

- **ターン開始 Ping 音**
  - `App.js`: Web Audio API で 880Hz サイン波（0.35秒）
  - `applyState()` で制御トークンが自側に移ったとき再生（ソロ/観戦除外）

### 2026-03-27
- **騎兵通行不可（`cav_impassable`）エンジンサポート**
  - `MapGraph.isCavalryImpassable()` 追加
  - `MoveValidator.getLegalRaids` でブロック
  - `CombatResolver.getValidCounterPieces` でフィルタ
  - `TurnManager` の突撃先導駒処理3箇所でフィルタ
  - テスト: `tests/cav_impassable.js`（6件）

- **退却先の人間選択 UI**
  - `GameController._afterStateChange` でリトリートインタラプションに `pieces[].validDestinations` を付与
  - `CombatDialog.renderRetreatDestination` でドロップダウン UI 実装
  - 退却先 null（消滅）対応、文字列→整数変換修正

- **道路行軍急襲（セクション8）完全実装**
  - `MoveValidator.getLegalRoadMoves` で騎兵 + 敵ロケール + 横断空き条件を判定しアクション生成
  - `TurnManager.executeMarchRaid` 新設（CP消費・横断記録・DEFENSE_RESPONSE発行）
  - `processDefenseResponse` に `isRoadMarchRaid` 分岐追加
  - `GameState.roadMarchRaidCrossings` 新フィールド追加
  - テスト: `tests/road_march_raid.js`（18件）

- **士気テストカバレッジ分析 → 新規テスト作成**
  - 既存士気テストのカバレッジ調査
  - `tests/morale_combat.js` 新規作成（28件）
    - 急襲1/2トークン投入、突撃投入、退却投入、敗者のみ士気低下、士気崩壊

---

## 開発メモ

### 状態管理の注意点
- `actedPieceIds` は `Set` → JSON シリアライズ時に `cloneState` / `serialize` / `deserialize` でケア済み
- `morale[side].uncommitted` は `investMorale` で減少し、マップトークンとして外に出る
- 道路行軍急襲勝利は `actedPieceIds` に追加しない（継続行軍可能）

### テスト記述パターン
```js
// baseState: createInitialState() + pieces設定 + morale上書き
// TurnManager.executeAction(action, state) → { newState, interruption }
// TurnManager.processInterruption(response, state) → { newState, interruption }
// インタラプションを全部処理してから状態を検証する
```

### 主要ロケール（テストで頻用）
- `locale3 → locale5`: ATK_EDGE=2, DEF_EDGE=4, narrow, `["inf_obstacle"]`
- `locale8 → locale9`: wide, `["inf_obstacle"]`（道路行軍急襲・2トークン条件のテストに使用）
- `locale2 → locale4`: thick road, `["inf_obstacle"]`（道路行軍急襲テスト）
- `locale4 → locale5`: DEF_EDGE=0, narrow（道路行軍急襲敗北テスト）
