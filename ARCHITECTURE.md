# Redmine Kanban の状態と境界

## 正本と契約

Issue、権限、workflow、作業時間の正本は Redmine にある。ボード取得は API v3 の `entities`、`tree.root_ids`、`tree.children_by_parent_id`、`scope_fingerprint`、`meta.complete: true` を一組の完全なスナップショットとして扱う。欠けた応答を部分的なボードとして採用しない。通常の更新成功は bounded delta を反映し、完全な delta を返せない成功だけ authoritative な再取得へ進む。

`frontend/src/infrastructure/api/contracts.ts` が通信型を定義し、`boardSnapshot.ts` が取得応答を検証して表示互換データに変換する。`frontend/src/model/board/types.ts` の `BoardViewModel` は画面向けの情報、`BoardData` は移行中の互換形である。現時点の Query cache はまだ `BoardData` を保持している。`model/board/state.ts` の正規化状態を Query cache の保持形式へ移す作業は次の段階で行い、第二の store は作らない。

表示上のルートと Issue の `parent_id` は異なる。フィルタやレーン変更は canonical な親子関係を書き換えない。取得 Entity 数、サーバーの列集計、表示カード数を混同しない。

## 依存方向

目標の依存方向は次のとおり。現在の UI には infrastructure を直接呼ぶ既存箇所が残るため、移行した領域から境界を適用する。

```text
model（純粋な型・判定・状態遷移）
  ↑
infrastructure（API と Storage）
  ↑
application（操作と結果の取りまとめ）
  ↑
ui（入力、表示、Canvas、ダイアログ）
```

`model/` は React、DOM、HTTP、Storage に依存しない。lint でこの境界への新しい違反を禁止する。既存の `ui/boardState.ts`、`ui/types.ts`、`ui/http.ts`、`ui/subtasksTree.ts`、`ui/board/sort.ts`、`ui/useKanbanPreferences.ts`、`ui/utils/storage.ts` は import 互換のための再エクスポートであり、実装はそれぞれの所有層に置く。

保存ビューの設定検証と更新規則は `model/view/savedViews.ts`、保存キー・書込み前の再読込・最終文書検証は `infrastructure/storage/savedViewsRepository.ts`、適用中ビューと操作結果は `application/savedViews/useSavedViews.ts` が担当する。Popover は入力と表示を担当する。再読込は複数タブ間のトランザクション保証ではない。

一般設定の値とパース規則は `model/view/preferences.ts`、Storage の読み書きと旧キー移行は `infrastructure/storage/preferencesRepository.ts` と `scopedStorage.ts`、React の状態と保存タイミングは `application/view/useKanbanPreferences.ts` が担当する。既存の保存キー、ユーザー・プロジェクト単位、タイマーの別スコープを維持する。

## 更新と鮮度

現在の更新・再照合は `useIssueMutation`、`useMutationReconciler`、`asyncFreshness` が担う。scope fingerprint、操作 revision、Entity の版数、欠損応答の適用可否、集計の request 世代は別の判断であり、単一の時刻比較へ潰さない。native iframe の書込みと Time Entry の結果不明も通常の plugin API delta と混同しない。

Query cache を正規化状態に移行する際は、API入力をその状態へ変換し、既存画面には読み取り専用の互換 selector を渡す。表示結果を更新入力として戻さず、旧新の store を並行保持しない。Canvas のドラッグ状態は既存の `ui/board/` 境界に置く。Redmine 6.0、6.1、7.0 の互換処理と資源制限を維持する。
