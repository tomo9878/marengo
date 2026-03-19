# Triomphe à Marengo — Web実装計画

最終更新: 2026-03-20

---

## アーキテクチャ方針

### 基本設計
1. **オンライン同時対戦**（リアルタイム WebSocket）
2. **厳密なアクション制御** — サーバーが唯一の正となる状態を保持（Authoritative Server）
3. **インタラプション制御** — 宣言で確定するまで手番を渡さない。防御応答が必要な場面では一時的に相手に制御を渡す
4. **セーブ機能** — サーバー側でゲーム状態をJSON保存、再開可能
5. **将来構想（今回は設計のみ）** — ログイン形式＋非同期ターンベース（メール通知型）

---

## システム構成図

```
┌─────────────────┐   WebSocket   ┌──────────────────────┐   WebSocket   ┌─────────────────┐
│  Client         │◄─────────────►│  Game Server         │◄─────────────►│  Client         │
│  (France)       │               │  (Node.js)           │               │  (Austria)      │
│                 │               │                      │               │                 │
│ - マップ描画     │               │ - 状態の正（唯一）    │               │ - マップ描画     │
│ - アクション入力 │               │ - アクション検証      │               │ - アクション入力 │
│ - 制御権の表示   │               │ - インタラプション管理 │               │ - 制御権の表示   │
└─────────────────┘               │ - セーブ/ロード       │               └─────────────────┘
                                  └──────────┬───────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  GameState      │
                                    │  (JSON / File)  │
                                    └─────────────────┘
```

---

## インタラプション制御の設計

### 制御トークンの状態機械

```
ACTIVE_PLAYER_ACTING
  │ アクション宣言（急襲・突撃・砲撃完遂など）
  ▼
WAITING_FOR_INTERRUPTION  ◄─── 相手プレイヤーが応答を求められる
  │ 相手が応答（or タイムアウト）
  ▼
SERVER_RESOLVING          ◄─── サーバーが解決・状態更新
  │
  ▼
ACTIVE_PLAYER_ACTING      ◄─── 司令残があれば継続、なければターン終了
```

### インタラプション発生ポイント一覧

| タイミング | 宣言側 | 割り込み内容 | 応答側 |
|---|---|---|---|
| 急襲宣言後 | アクティブ | 防御対応（リザーブ→アプローチ移動） | 相手 |
| 突撃①先導駒宣言 | 相手 | 防御先導駒の選択 | 相手 |
| 突撃②攻撃先導駒宣言 | アクティブ | 宣言確認 | アクティブ |
| 突撃③防御砲撃 | 相手 | 砲撃するか選択 | 相手 |
| 突撃④カウンター攻撃 | 相手 | カウンター駒の選択 | 相手 |
| 突撃⑤戦力減少割振り | 相手 | 減少する駒を選択 | 相手 |
| 砲撃完遂 | 相手 | 減少する駒を選択（優先順あり） | 相手 |
| 退却先選択 | 相手 | 退却先ロケールを選択 | 相手 |
| 騎兵継続行軍 | アクティブ | 使用するか選択 | アクティブ |

### メッセージプロトコル（WebSocket）

```javascript
// クライアント → サーバー
{ type: 'ACTION', payload: { actionType, pieceIds, targetLocaleId, ... } }
{ type: 'INTERRUPTION_RESPONSE', payload: { ... } }
{ type: 'CONFIRM_TURN_END' }

// サーバー → 両クライアント
{ type: 'STATE_UPDATE', payload: { gameState } }         // 全状態同期
{ type: 'CONTROL_TRANSFER', payload: { to: 'austria', reason: 'defense_response' } }
{ type: 'INTERRUPTION_REQUEST', payload: { type, options } }  // 応答を求める
{ type: 'RESOLVE_RESULT', payload: { result, log } }
{ type: 'GAME_OVER', payload: { winner, type } }
```

---

## フォルダ構成

```
triomphe/
├── server/
│   ├── index.js              WebSocketサーバー起動
│   ├── GameRoom.js           ルーム管理（接続・切断）
│   ├── GameController.js     アクション受信・検証・実行の統括
│   ├── engine/
│   │   ├── GameState.js      状態定義・クローン・シリアライズ
│   │   ├── MapGraph.js       隣接・道路・アプローチ計算
│   │   ├── MoveValidator.js  合法アクション検証
│   │   ├── CombatResolver.js 急襲・突撃・砲撃の解決
│   │   ├── MoraleManager.js  士気管理
│   │   └── TurnManager.js    フェーズ・ターン・ラウンド進行
│   └── saves/                セーブファイル置き場（JSON）
│
├── client/
│   ├── index.html            メインゲーム画面
│   ├── js/
│   │   ├── Connection.js     WebSocket接続管理
│   │   ├── MapRenderer.js    Canvas描画
│   │   ├── ActionPanel.js    アクションUI（制御権に応じて有効/無効）
│   │   ├── CombatDialog.js   インタラプション応答モーダル
│   │   └── InfoPanel.js      士気・時間・ログ
│   └── assets/
│       └── (images/より移動)
│
└── data/
    ├── map.json              マップデータ（marengo_areas_v4.jsonを整備）
    ├── pieces.json           ユニット定義
    └── scenarios.json        タイムトラック・増援タイミング
```

---

## 将来構想（設計メモのみ・今回は実装しない）

### ログイン＋非同期ターンベース

```
将来のシステム追加要素:
├── accounts/
│   ├── UserStore.js          ユーザーアカウント管理（DB）
│   └── AuthMiddleware.js     認証（JWTまたはセッション）
│
├── games/
│   ├── GameStore.js          進行中ゲームのDB永続化
│   └── NotificationService.js 「あなたのターンです」通知（メール/Push）
│
└── lobby/
    └── LobbyManager.js       ゲームの作成・参加・マッチング
```

**非同期対戦の変更点（リアルタイム対戦との差分）:**
- WebSocket → HTTP + ポーリング or SSE（常時接続不要）
- GameRoom（揮発性） → GameStore（DB永続）
- インタラプション → 応答期限タイマー（例: 24時間）
- セーブ機能は自動化（毎アクション後に永続化）

---

## 進捗サマリー

| Phase | 内容 | 状態 |
|---|---|---|
| Phase 0 | マップデータ入力（手作業） | ✅ 完了 |
| Phase 1 | データ層整備 | ⬜ 未着手 |
| Phase 2 | ゲームエンジンコア（サーバー側） | ⬜ 未着手 |
| Phase 3 | WebSocketサーバー＋接続管理 | ⬜ 未着手 |
| Phase 4 | クライアントUI | ⬜ 未着手 |
| Phase 5 | インタラプション制御の結合 | ⬜ 未着手 |
| Phase 6 | セーブ/ロード | ⬜ 未着手 |
| 将来構想 | ログイン＋非同期ターンベース | 📝 設計メモのみ |

---

## Phase 0: マップデータ入力 ✅

- [x] 主要道路・側道の全区間入力（marengo_areas_v4.json）
- [x] roads配列 43セグメント
- [x] エッジのroad_type（thick/thin/none）設定済み

---

## Phase 1: データ層整備

### 1-A. map.json スキーマ拡張（marengo_areas_v4.json ベース）
- [ ] 全90エリアに歴史的地名を付ける
- [ ] 各ロケールに以下フィールドを追加
  ```
  name              歴史的地名
  capacity          ロケール制限（null=無制限）
  eastOfObjective   作戦目標ライン東側か（boolean）
  setupZone         "french_start"|"french_renfort_500"|"french_renfort_1100"|"french_renfort_1600"|"austrian"|null
  ```
- [ ] 各エッジ（アプローチ）に以下フィールドを追加
  ```
  width     "narrow" | "wide"
  symbols   ["inf_penalty","cav_obstacle","artillery_penalty","impassable"]
  ```
- [ ] crossings（横断）情報を追加
  ```json
  "crossings": [ { "localeA": 5, "localeB": 12, "edgeIdxA": 2, "edgeIdxB": 0 } ]
  ```

### 1-B. pieces.json 作成
- [ ] フランス軍ユニット定義（AU DÉBUT 11駒 + RENFORTS 8駒）
  - `id, type(infantry/cavalry/artillery), maxStrength, startArea`
- [ ] オーストリア軍ユニット定義（全駒）

### 1-C. scenarios.json 作成
- [ ] タイムトラック（16ラウンド分の士気補充値）
- [ ] 初期士気: フランス=12（未投入3）、オーストリア=12
- [ ] 増援の進入タイム・進入道路（仏: 5AM/11AM/4PM、墺: Bormida川）

---

## Phase 2: ゲームエンジンコア（サーバー側）

### 2-A. GameState.js
- [ ] 状態型定義
  ```
  round, activePlayer, phase, commandPoints
  controlToken: { holder: 'austria'|'france', reason: string }
  pendingInterruption: null | { type, options, waitingFor }
  morale: { france: {uncommitted, mapTokens[]}, austria: {...} }
  pieces: { [id]: { localeId, position, strength, faceUp, disordered, acted } }
  pendingBombardment: null | { pieceId, approachId }
  crossingTraffic: { [crossingId]: [{pieceId, steps}] }
  log: []
  ```
- [ ] `createInitialState()`
- [ ] `cloneState(state)`
- [ ] `serialize / deserialize` — JSON保存/復元

### 2-B. MapGraph.js
- [ ] `getAdjacentLocales(localeId)`
- [ ] `getOppositeApproach(localeId, edgeIdx)`
- [ ] `getApproachWidth(localeId, edgeIdx)`
- [ ] `getApproachSymbols(localeId, edgeIdx)`
- [ ] `isFullyBlocked / isPartiallyBlocked`
- [ ] `getRoadPath(fromId, toId, roadType)` — 最大3ステップ
- [ ] `getCrossings(localeA, localeB)`
- [ ] `getLocaleOccupant(localeId, state)` — france/austria/null
- [ ] `getPiecesAt(localeId, position, state)`
- [ ] `getLocaleCount(localeId, side, state)`

### 2-C. MoveValidator.js
- [ ] `getLegalMoveActions(pieceId, state)` — 合法行軍一覧
  - [ ] 悪路行軍（混乱状態チェック）
  - [ ] 道路行軍（交通制限チェック）
  - [ ] 防御行軍
  - [ ] 継続行軍（騎兵のみ）
- [ ] `getLegalAttackActions(pieceId, state)` — 合法攻撃一覧
  - [ ] 急襲（ブロック状況チェック）
  - [ ] 突撃（アプローチブロック条件）
  - [ ] 砲撃（砲兵・アプローチ条件）
- [ ] `canReorganize(localeId, state)`
- [ ] `getCommandCost(action)` — 無料条件含む

### 2-D. CombatResolver.js

#### 急襲（Section 9）
- [ ] `initiateRaid(attackers, targetLocaleId, defenseApproachIdx, state)`
  → `pendingInterruption: { type:'defense_response', ... }` を返す
- [ ] `resolveRaidAfterResponse(response, state)`
  - [ ] 完全ブロック → 防御側勝利
  - [ ] それ以外 → 攻撃側勝利
  - [ ] 退却処理（Section 13）
  - [ ] 士気投入

#### 突撃（Section 11）
- [ ] `initiateAssault(attackApproachIdx, state)` → 防御先導駒待ち
- [ ] `receiveDefenseLeaders(pieces, state)` → 攻撃先導駒待ち
- [ ] `receiveAttackLeaders(pieces, state)` → 防御砲撃判定
- [ ] `resolveDefensiveArtillery(state)` → カウンター待ち
- [ ] `receiveCounterAttack(pieces, state)` → 勝敗計算
- [ ] `calculateAssaultResult(state)` — Σ攻撃先導 - ペナルティ - Σ防御先導 - Σカウンター
- [ ] `applyReductions(state)` → 減少割振り待ち（防御側）
- [ ] `completeAssault(reductionChoices, state)`

#### 砲撃（Section 10）
- [ ] `declareBombardment(artilleryId, targetLocaleId, state)`
- [ ] `completeBombardment(state)` → 減少する駒待ち（防御側）
- [ ] `cancelBombardment(state)`

#### 退却（Section 13）
- [ ] `initiateRetreat(losingLocaleId, attackInfo, state)` → 退却先待ち
- [ ] `resolveRetreat(destinations, state)`
  - [ ] 砲兵除去
  - [ ] アプローチ駒に減少（narrow=1, wide=2）
  - [ ] リザーブ歩兵に減少
  - [ ] 退却先なし → 除去

### 2-E. MoraleManager.js
- [ ] `getTotalMorale(side, state)`
- [ ] `periodicMoraleUpdate(state)`
- [ ] `investMorale(side, localeId, count, state)`
- [ ] `reduceMorale(side, amount, state)`
- [ ] `moraleCleanup(activePlayer, state)`
- [ ] `checkMoraleCollapse(state)` → `{ collapsed, side }`

### 2-F. TurnManager.js
- [ ] `startTurn(state)` — 定期士気更新 + アプローチクリーンアップ
- [ ] `executeAction(action, state)` — アクション実行（インタラプション生成含む）
- [ ] `endActionPhase(state)` — 士気クリーンアップ → ターン交代
- [ ] `advanceRound(state)`
- [ ] `checkVictory(state)` → `{ winner, type: 'decisive'|'marginal'|null }`
- [ ] フランス混乱状態管理（6AMのみ → 再編成で解除）
- [ ] 増援の時間管理（5AM/11AM/4PM）

---

## Phase 3: WebSocketサーバー＋接続管理

### 3-A. サーバー基盤
- [ ] Node.js + `ws` ライブラリでWebSocketサーバー構築
- [ ] ルーム概念の実装（ゲームID で識別）
- [ ] 接続・切断・再接続の処理
- [ ] プレイヤーへのサイド割当（France/Austria）

### 3-B. GameRoom.js
- [ ] `createRoom(gameId)` — ゲームルーム生成
- [ ] `joinRoom(ws, gameId, side)` — プレイヤー参加
- [ ] `broadcast(gameId, message)` — 両プレイヤーへ送信
- [ ] `sendTo(side, message)` — 片側のみ送信
- [ ] 切断時の状態保持（再接続で復帰可能）

### 3-C. GameController.js
- [ ] アクションメッセージの受信・検証
- [ ] 制御トークンチェック（制御権のないプレイヤーの操作を拒否）
- [ ] インタラプション発生時に `CONTROL_TRANSFER` を送信
- [ ] 解決後に `STATE_UPDATE` を両クライアントへブロードキャスト
- [ ] エラー応答（不正アクション時）

### 3-D. セーブ/ロード
- [ ] `saveGame(gameId, state)` — `saves/{gameId}.json` に書き出し
- [ ] `loadGame(gameId)` → state 復元
- [ ] セーブリスト一覧API

---

## Phase 4: クライアントUI

### 4-A. Connection.js
- [ ] WebSocket接続・再接続
- [ ] `STATE_UPDATE` 受信 → ローカル状態更新 → 再描画
- [ ] `INTERRUPTION_REQUEST` 受信 → CombatDialog 表示
- [ ] `CONTROL_TRANSFER` 受信 → ActionPanel の有効/無効切り替え
- [ ] 自分の制御権がない時は操作を完全にロック

### 4-B. MapRenderer.js（Canvas）
- [ ] ロケールポリゴン描画
- [ ] アプローチ辺（幅・シンボル）
- [ ] 道路描画（主要=太線、側道=細線）
- [ ] 駒トークン（兵種・戦力・表裏・混乱状態）
- [ ] 士気トークン
- [ ] 選択・移動候補のハイライト
- [ ] 作戦目標ライン
- [ ] ズーム/スクロール（2700×1799px）

### 4-C. ActionPanel.js
- [ ] 司令ポイント残数表示
- [ ] 現在フェーズ・制御権の表示（「あなたのターン」/「相手のターン」）
- [ ] アクションボタン（制御権なし時は全て無効化）
- [ ] ターン終了ボタン

### 4-D. CombatDialog.js（モーダル）
- [ ] 急襲: 防御対応の選択UI
- [ ] 突撃: 各ステップの宣言UI（先導駒・カウンター・戦力割振り）
- [ ] 砲撃完遂: 減少する駒の選択UI
- [ ] 退却先の選択UI
- [ ] 戦闘計算結果の表示（内訳付き）
- [ ] タイムアウト表示（相手の応答待ち中）

### 4-E. InfoPanel.js
- [ ] タイムトラック（現在ラウンド強調）
- [ ] 両軍士気レベル
- [ ] ゲームログ（直近アクション履歴）
- [ ] 選択中駒の詳細

---

## Phase 5: インタラプション制御の結合テスト

- [ ] 急襲 → 防御対応 → 解決 の一連フロー
- [ ] 突撃の全ステップ（①〜⑤）の順序制御
- [ ] 砲撃2ターン制の状態管理
- [ ] 退却先選択フロー
- [ ] 切断・再接続時のインタラプション復帰
- [ ] 応答タイムアウト処理

---

## Phase 6: セーブ/ロード

- [ ] 任意タイミングでのセーブ
- [ ] セーブコード（またはURL）でゲーム再開
- [ ] 自動セーブ（各ターン終了後）
- [ ] セーブ一覧画面

---

## 将来構想メモ（今回は実装しない）

### ログイン＋非同期ターンベース

```
追加コンポーネント:
├── UserStore.js         ユーザーアカウント（DB）
├── AuthMiddleware.js    認証（JWT）
├── GameStore.js         ゲームのDB永続化
├── NotificationService  「あなたのターン」通知（メール/Push）
└── LobbyManager.js      ゲーム作成・参加・マッチング

リアルタイム対戦との主な差分:
- WebSocket常時接続 → 不要（アクション時のみHTTP or 短命WebSocket）
- インタラプション応答 → 24時間タイマー付き
- セーブ → 毎アクション後に自動でDB永続化
- 同一ゲームへの複数セッション参加 → JWT+GameIDで識別
```

---

## 参考情報

### ゲームの数値まとめ
- ラウンド数: 16（6AM〜9PM、各1時間）
- 司令ポイント/ターン: 3
- 初期士気: フランス=12（未投入3）、オーストリア=12
- フランス軍 AU DÉBUT: 11駒、RENFORTS: 8駒
- 作戦目標: オーストリア3駒以上が東側 → オーストリア辛勝

### セクション対照表
| セクション | 内容 |
|---|---|
| 3 | ゲームマップ（ロケール・アプローチ） |
| 4 | セットアップ |
| 5 | プレイの手順（ターン構造） |
| 6 | アクション概要・司令 |
| 7 | 悪路行軍 |
| 8 | 道路行軍・横断・交通制限 |
| 9 | 急襲 |
| 10 | 砲撃 |
| 11 | 突撃 |
| 12 | 騎兵の継続行軍 |
| 13 | 退却 |
| 14 | フランス軍の混乱 |
| 15 | 増援 |
| 16 | アプローチのクリーンアップ |
| 17 | 駒のシャッフル |
| 18 | 士気 |
| 19 | 勝利条件 |

### 現在のファイル構成
```
Triomphe_a_Marengo_v1.6/
├── area_editor.html        作業ツール（修正用に保持）
├── extract_areas_v2.py     画像処理スクリプト
├── images/                 ユニット画像
├── marengo_areas_v3.json   旧マップデータ（バックアップ）
├── marengo_areas_v4.json   現行マップデータ（道路情報入り）← Phase 1で整備
├── IMPLEMENTATION_PLAN.md  本ファイル
└── TRIOMPHE_A_MARENGO_JP.pdf  ルールブック
```
