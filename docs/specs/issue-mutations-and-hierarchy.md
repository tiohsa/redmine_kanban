# SPEC: チケット作成・更新・一括サブタスク作成・親子階層同期

## 1. Goal（目的）
- ボード上から単一チケット作成・インライン更新（件名・説明・担当者・優先度・開始日・期日・トラッカー・進捗率・ステータス）・一括サブタスク作成を行えるようにする。
- 子チケットの変更・作成に伴う親および祖先チケットの進捗率・優先度・ボード所属（`BoardMembershipResolver`）の整合性を bounded delta（または必要時の `invalidations.board_snapshot: true`）によって保つ。
- 一括サブタスク作成において `Idempotency-Key` による冪等性と上限チェックを提供する。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- 50件を超える一括サブタスク作成の許可。
- 一括作成以外の通常ミューテーションにおける無条件のフルボード再取得への置き換え。
- サーバー応答とは別の並列 React state によるメンバーシップ・階層・件数管理。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（単一作成・更新）:** Given `add_issues` / `edit_issues` および `manage_redmine_kanban` 権限を持つユーザー, when `POST /issues` または `PATCH /issues/:id`（`lock_version` 必須）を実行する, then チケットが保存され、`issue_updates`（対象チケットと可視祖先）・`created_issues`・`tree_changes` を含む bounded delta が返る。
- [ ] **Happy Path（一括サブタスク作成）:** Given 有効な `Idempotency-Key` と 1〜50件の非空サブタスク, when `POST /issues/bulk` を実行する, then 同一トランザクションで親（新規または既存）とサブタスクが作成され、同一 `Idempotency-Key` と同一ペイロードの再送に対しては冪等に同じ結果を返す。
- [ ] **Error / Boundary Case（一括サブタスク上限超過）:** Given 非空サブタスクが `MAX_BULK_SUBTASKS`（`50`）を超えるリクエスト, when `POST /issues/bulk` を呼ぶ, then DB トランザクションや `BulkIdempotency` の記録を行う前に HTTP 422（`field_errors.subtasks`）で拒否する。
- [ ] **Error / Boundary Case（Idempotency-Key 欠落 / 不正ペイロード）:** Given `Idempotency-Key` ヘッダ欠落、または `bulk` / `subtasks` が不正な構造, when `POST /issues/bulk` を呼ぶ, then HTTP 422 を返す。
- [ ] **Error / Boundary Case（lock_version 欠落・競合・不正値）:** Given `lock_version` 欠落または古い `lock_version`、あるいは不正な日付・優先度・不許可なステータス遷移, when `PATCH /issues/:id` を呼ぶ, then 適切なエラー（HTTP 422 / 409）を返し DB を変更しない。
- [ ] **Error / Boundary Case（bounded delta 上限超過）:** Given ミューテーション後の応答サイズが `SnapshotLimits.response_bytes` を超える、またはフィルタ有効時等で完全な delta を構成できない場合, then ミューテーション自体は保存した上で `invalidations.board_snapshot: true` を返し、フロントエンドに authoritative な再取得を促す。
- [ ] **Backward Compatibility:** `IssueCreatorTest`・`IssueUpdaterTest`・`BulkIdempotencyTest`・`AncestorIssueUpdatesTest` がすべてパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Endpoints:**
  - `POST /projects/:project_id/kanban/issues` (`redmine_kanban/api#create`)
  - `POST /projects/:project_id/kanban/issues/bulk` (`redmine_kanban/api#bulk_create`, `Idempotency-Key` ヘッダ必須)
  - `PATCH /projects/:project_id/kanban/issues/:id` (`redmine_kanban/api#update`)
- **DB Schema:** `BulkIdempotency` テーブルは既存スキーマを維持し、新規マイグレーションは追加しない。

## 5. Constraints（制約事項）
- **Security:** `PermissionPolicy#can_create_issue?`（親チケットまたは指定 `project_id` の対象プロジェクトに対して検証）および `can_update_issue?` を強制する。親チケット・祖先チケットの更新通知は `Issue.visible(@user)` で可視性を検証したもののみ返す。
- **Performance:** 一括作成の上限は `MAX_BULK_SUBTASKS = 50`。応答サイズは `ApiController#enforce_mutation_response_limit` と `MutationResultBuilder` で `SnapshotLimits.response_bytes` 以下に制限する。

## 6. Required Tests（必須テスト）
- **Unit:** `test/unit/issue_creator_test.rb`, `test/unit/issue_updater_test.rb`, `test/unit/bulk_idempotency_test.rb`, `test/unit/bulk_payload_normalizer_test.rb`, `test/unit/ancestor_issue_updates_test.rb`, `frontend/src/ui/bulkSubtasks.test.ts`, `frontend/src/ui/bulkIdempotency.test.ts`, `frontend/src/ui/useIssueMutation.test.tsx`, `frontend/src/ui/useMutationReconciler.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`
- **Regression:** ステータス変更・進捗率変更直後の `MutationOutcome` キャプチャがリロードで失われないこと、および古い親応答が新しい子ミューテーションを上書きしないこと。
