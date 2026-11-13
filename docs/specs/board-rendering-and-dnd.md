# SPEC: Canvas ボード描画・スイムレーン・ドラッグ＆ドロップ・並び替え

## 1. Goal（目的）
- HTML Canvas を用いて大規模チケットでも滑らかにスクロール・描画できるカンバンボードを提供する。
- スイムレーン（`none` / `assignee` / `priority` / `category`）およびカード並び替え（`due` / `priority` / `updated` の複数条件ソート）を提供する。
- ドラッグ＆ドロップ（D&D）のインタラクション状態を `frontend/src/ui/board/` 境界に集約し、ドロップ可否判定（`noop` / `dispatch` / `forbidden`）と実際のディスパッチ判定を一致させる。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- カテゴリ（Category）スイムレーンにおける D&D でのチケットカテゴリ変更。
- コンポーネントローカルな React state への第二のドラッグステートマシンの作成。
- クライアント側のワークフローメタデータのみによるサーバー検証の代替（最終権限・遷移判定は常に Redmine サーバーが正本）。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（通常D&D移動）:** Given `manage_redmine_kanban` および対象チケット編集権限を持つユーザー, when カード（またはサブタスク領域）をドラッグし `dispatch` と判定される別ステータス・レーンへドロップする, then `PATCH /projects/:project_id/kanban/issues/:id/move` が `lock_version` 付きで実行され、bounded delta によりボード状態が更新される。
- [ ] **Happy Path（担当者・優先度スイムレーン移動）:** Given `assignee` または `priority` スイムレーン表示中, when 別レーンへドロップする, then 対象に応じた `assigned_to_id` または `priority_id`（未設定レーン含む）の変更がリクエストされる。
- [ ] **Happy Path（ソート）:** Given 有効な `SortConfig`（最大3項目、`due` / `priority` / `updated`、昇順・降順）, when `sortIssues` を適用する, then 指定順（未設定値の扱いは `buildIssueComparator` に従う）にカードが整列する。
- [ ] **Error / Boundary Case（カテゴリ・スイムレーン制限）:** Given `category` スイムレーン表示中, when 「カテゴリA → カテゴリB」「カテゴリあり → カテゴリなし」「カテゴリなし → カテゴリあり」へドラッグする, then `assessDrop` は `action: 'forbidden'` を返し、カーソルは `not-allowed`、許可ハイライト/プレビューを表示せず、ドロップしてもミューテーションを送信しない。同一カテゴリ内のステータス移動は通常ルールに従い `dispatch` 可能とする。
- [ ] **Error / Boundary Case（同一セル・ワークフロー不許可）:** Given 同一ステータスかつ同一レーンへのドロップ, then `action: 'noop'` となり送信しない。Given サーバーのワークフロー上不許可な遷移を送信した場合, then サーバーは `WORKFLOW_TRANSITION_NOT_ALLOWED`（HTTP 422）を返し、楽観的状態はロールバックされる。
- [ ] **Backward Compatibility:** 既存の `CanvasBoard.test.tsx`・`dropEligibility.test.ts`・`dragInteraction.test.ts`・`IssueMoverTest` がパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Endpoint:** `PATCH /projects/:project_id/kanban/issues/:id/move` (`redmine_kanban/api#move`)
  - **Request:** `status_id`, `lock_version`（必須）, 任意で `assigned_to_id`, `priority_id`, `operation_id`, スコープパラメータ
  - **Response:** bounded delta（`ok: true`, `issue_updates`, `evicted_issue_ids`, `tree_changes`, `invalidations`, `column_counts` 等）またはエラー（`ok: false`, `code`）
- **DB Schema:** 変更なし。

## 5. Constraints（制約事項）
- **Security:** `ApiController#require_move_permission` で `can_view_board?` および `can_move_issue?(@issue, @project)` を検証する。楽観的ロック（`lock_version`）必須。親チケット優先度の意図しない書き換えを防ぐ（`preserve_parent_priority`）。
- **Performance:** Canvas レイアウト（`BoardLayout`）とヒットテスト（`HitTestIndex`）により DOM ノード肥大を防ぎ、ドラッグ中の再描画を最小化する。

## 6. Required Tests（必須テスト）
- **Unit:** `frontend/src/ui/board/dropEligibility.test.ts`, `frontend/src/ui/board/dragInteraction.test.ts`, `frontend/src/ui/board/cursor.test.ts`, `frontend/src/ui/board/CanvasPointerController.test.ts`, `frontend/src/ui/board/CanvasBoard.test.tsx`, `frontend/src/ui/board/sort.test.ts`, `test/unit/issue_mover_test.rb`
- **Integration / E2E:** `test/functional/api_controller_test.rb`, `e2e/tests/kanban-move-overlap.spec.js`, `e2e/tests/kanban-move-refresh.spec.js`
- **Regression:** カテゴリスイムレーンにおける同一カテゴリ移動・クロスカテゴリ禁止のリグレッションテスト。
