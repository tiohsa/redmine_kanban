# SPEC: フィルタ・検索・URLクエリパラメータ・保存ビュー（Saved Views）

## 1. Goal（目的）
- キーワード（`q`）・担当者（`assignee_ids` / `include_unassigned`）・トラッカー（`tracker_ids`）・優先度（`priority_filter_enabled` / `priority_ids` / `include_no_priority`）・期日（`due` / `due_days` / `date_anchor`）・プロジェクト（`project_ids`）・ステータス列（`issue_status_ids` / `exclude_status_ids`）による SQL ベースの正規化されたフィルタリングを提供する。
- フィルタやビュー設定を URL クエリパラメータおよび保存ビュー（Saved Views、最大 20 件）として保存・復元できるようにする。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- 保存ビューのサーバーサイド DB テーブルへの永続化（現在は `savedViewsRepository.ts` によるスコープ付きブラウザストレージ保存）。
- 複数ブラウザタブ間の分散トランザクション保証。
- フィルタ変更による Redmine 上のチケット親子関係（`parent_id`）の書き換え。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（ボードフィルタ適用）:** Given 有効なフィルタ条件（例: `filter_due=overdue|thisweek|3days|7days|1day|custom|none|all`、`filter_q`、`filter_assignee_ids`、`filter_tracker_ids`、`filter_priority_enabled` 等）, when `BoardIssueFilter` と `BoardData` を実行する, then `scope_fingerprint` にフィルタスコープが反映され、条件に一致するチケットおよび必要な親階層のみを含む完全スナップショットが返る。
- [ ] **Happy Path（保存ビュー作成・適用・削除）:** Given 保存済みビューが 20 件未満の状態, when ユーザーがビューを保存・適用・削除する, then `model/view/savedViews.ts` のスキーマ検証（`version: 1`）を通過した内容が `savedViewsRepository.ts` に保存され、適用時にフィルタ・表示設定が復元される。
- [ ] **Error / Boundary Case（不正フィルタパラメータ）:** Given `BoardIssueFilter::DUE_MODES` 外の `filter_due` や不正な `filter_due_days` / `filter_date_anchor` 等, when API を呼ぶ, then `INVALID_BOARD_FILTER`（HTTP 400）を返す。
- [ ] **Error / Boundary Case（保存ビュー上限・破損データ）:** Given 保存ビュー数が `MAX_SAVED_VIEWS`（`20`）に達している状態での新規追加, then `saved_views_limit` エラーとなる。Given 破損したストレージ JSON（`version !== 1` や上限超過）, then `saved_views_unreadable` として安全に扱う。
- [ ] **Backward Compatibility:** `BoardIssueFilterTest`・`boardFilters.test.ts`・`boardQuery.test.ts`・`savedViews.test.ts`・`savedViewTransitions.test.tsx`・`savedViews.multitab.test.tsx`・`kanban-recovery-views.spec.js` がパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Query Parameters（`GET /data`, `bootstrap`, `entities`, `counts`, 及びミューテーション時のスコープ連携）:**
  - `project_ids[]`, `issue_status_ids[]`, `exclude_status_ids[]`
  - `filter_q`, `filter_assignee_ids[]`, `filter_include_unassigned`, `filter_tracker_ids[]`, `filter_priority_enabled`, `filter_priority_ids[]`, `filter_include_no_priority`, `filter_due`, `filter_due_days`, `filter_date_anchor`
- **Client Storage Schema:** `SavedViewsDocument = { version: 1; views: SavedView[] }`（`MAX_SAVED_VIEWS = 20`）
- **DB Schema:** 変更なし。

## 5. Constraints（制約事項）
- **Security:** `BoardIssueFilter` は SQL インジェクションを防ぐためパラメータ化された ActiveRecord 条件のみを構築する。`project_ids` 指定時も `Project.visible(User.current)` かつ権限確認済みの範囲に制限する。
- **Performance:** フィルタ有効時のミューテーションでは、差分計算コストや不整合を避けるため `invalidations.board_snapshot: true` による authoritative な再取得へフォールバックする。

## 6. Required Tests（必須テスト）
- **Unit:** `test/unit/board_issue_filter_test.rb`, `frontend/src/ui/boardFilters.test.ts`, `frontend/src/ui/boardQuery.test.ts`, `frontend/src/ui/savedViews.test.ts`, `frontend/src/ui/savedViewTransitions.test.tsx`, `frontend/src/ui/savedViews.multitab.test.tsx`, `frontend/src/ui/toolbar/SavedViewsPopover.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`, `e2e/tests/kanban-recovery-views.spec.js`
- **Regression:** ビュー切替時の非同期スナップショット競合（古いビューの応答で上書きされないこと）。
