# SPEC: チケット削除と削除済みチケットの再作成（Recreate）

## 1. Goal（目的）
- ボード上から `lock_version` による楽観的ロック付きで Redmine チケットを物理削除できるようにする。
- 物理削除（`deleted_issue_ids`）とボードスコープからの追放（`evicted_issue_ids`）を明確に区別して返却し、完全な削除 delta を返せない場合は部分的な tombstone ではなくスナップショット無効化（`invalidations.board_snapshot: true`）を返す。
- 削除直後の最上位チケットに対して、画面上の表示内容をもとに新規チケットとして再作成（Recreate）する導線を提供する。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- Redmine の履歴（Journals）・コメント・添付ファイル・関連チケット・ウォッチャー・元のチケット ID の復元（再作成はあくまで新規チケット作成であり、元の ID や履歴は復元しない）。
- 削除済みチケットのソフトデリート（ゴミ箱テーブル）実装。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（物理削除）:** Given `delete_issues` および `manage_redmine_kanban` 権限を持つユーザーと一致する `lock_version`, when `DELETE /projects/:project_id/kanban/issues/:id` を実行する, then 対象チケット（および連動削除された可視子孫）が削除され、`deleted_issue_ids` と影響を受けた可視祖先の `issue_updates` を含む応答（HTTP 200）を返す。
- [ ] **Happy Path（削除済みチケットの再作成）:** Given ボード上から最上位チケットを削除した直後の状態, when ユーザーが再作成（Recreate）操作を実行する, then 表示していた内容を用いて新規チケット作成（`POST /issues`）が行われ、元の ID や履歴・コメント等は引き継がれない。
- [ ] **Error / Boundary Case（lock_version 欠落 / 競合）:** Given `lock_version` が空または一致しない場合, when `DELETE /issues/:id` を呼ぶ, then `LOCK_VERSION_REQUIRED`（HTTP 422）または `CONFLICT`（HTTP 409）を返し削除しない。
- [ ] **Error / Boundary Case（削除対象数オーバーフロー）:** Given 削除候補数（子孫含む）が `effective_entity_limit` を超える場合、またはフィルタ有効時, when 削除を実行する, then 削除自体は完了させつつ部分的な `deleted_issue_ids` は返さず `deleted_issue_ids: []` かつ `invalidations.board_snapshot: true` を返す。
- [ ] **Error / Boundary Case（権限不足）:** Given `delete_issues` またはトラッカー削除権限がないユーザー, when `DELETE /issues/:id` を呼ぶ, then `PERMISSION_DENIED`（HTTP 403）を返す。
- [ ] **Backward Compatibility:** `IssueDestroyerTest` および `ApiControllerTest` の削除関連ケースがすべてパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Endpoint:** `DELETE /projects/:project_id/kanban/issues/:id` (`redmine_kanban/api#destroy`)
  - **Request:** `lock_version`（必須、`params[:lock_version]` または `params[:issue][:lock_version]`）、任意で `operation_id`
  - **Response:** `deleted_issue_ids`, `evicted_issue_ids`, `issue_updates`, `invalidations`（`issue_ids`, `parent_ids`, `column_counts`, `board_snapshot`）
- **DB Schema:** 変更なし。

## 5. Constraints（制約事項）
- **Security:** トランザクション内で `Issue.lock` 取得後に `lock_version` と `PermissionPolicy#can_delete_issue?` を再検証する。
- **Performance:** 削除候補 ID 探索は `effective_entity_limit` で上限保護する（`BoardMembershipResolver#deletion_candidate_ids`）。

## 6. Required Tests（必須テスト）
- **Unit:** `test/unit/issue_destroyer_test.rb`, `frontend/src/ui/useKanbanActions.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`
- **Regression:** 削除失敗時の `CONFLICT` / `DELETE_FAILED` ハンドリング、および `deleted_issue_ids` と `evicted_issue_ids` の混同がないこと。
