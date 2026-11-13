# SPEC: Issue Deletion & Recreate

## 1. Goal
- Allow physical deletion of Redmine issues from the board with `lock_version` optimistic locking.
- Keep physical deletion (`deleted_issue_ids`) strictly distinct from board-scope eviction (`evicted_issue_ids`), and invalidate the authoritative snapshot (`invalidations.board_snapshot: true`) when a complete bounded deletion delta cannot be returned.
- Allow recreating a deleted top-level issue from its displayed content as a new issue.

## 2. Non-goals / Out-of-scope
- Restoring Redmine history (journals), comments, attachments, relations, watchers, or original issue IDs during Recreate.
- Implementing a custom soft-delete / trash bin database table.

## 3. Acceptance Criteria
- [ ] **Happy Path (Physical Deletion):** Given a user with `delete_issues` and `manage_redmine_kanban` permissions and a matching `lock_version`, when calling `DELETE /projects/:project_id/kanban/issues/:id`, then the issue (and cascaded visible descendants) is destroyed and HTTP 200 is returned with `deleted_issue_ids` and affected visible ancestors in `issue_updates`.
- [ ] **Happy Path (Recreate Deleted Issue):** Given a recently deleted top-level issue, when the user triggers Recreate, then a new issue is created via `POST /issues` using the displayed content, without restoring original ID, history, comments, attachments, relations, or watchers.
- [ ] **Error / Boundary Case (Missing or Stale lock_version):** Given a blank or mismatched `lock_version`, when calling `DELETE /issues/:id`, then `LOCK_VERSION_REQUIRED` (HTTP 422) or `CONFLICT` (HTTP 409) is returned without deleting the issue.
- [ ] **Error / Boundary Case (Deletion Delta Overflow / Active Filter):** Given deletion candidates exceeding `effective_entity_limit` or an active board filter, when deleting an issue, then the deletion succeeds while returning `deleted_issue_ids: []` and `invalidations.board_snapshot: true` instead of partial tombstones.
- [ ] **Error / Boundary Case (Authorization):** Given a user lacking `delete_issues` or tracker deletability, when calling `DELETE /issues/:id`, then `PERMISSION_DENIED` (HTTP 403) is returned.
- [ ] **Backward Compatibility:** Existing `IssueDestroyerTest` and deletion cases in `ApiControllerTest` pass.

## 4. Public API / DB Schema
- **Endpoint:** `DELETE /projects/:project_id/kanban/issues/:id` (`redmine_kanban/api#destroy`)
  - **Request:** `lock_version` (required, via `params[:lock_version]` or `params[:issue][:lock_version]`), optional `operation_id`.
  - **Response:** `deleted_issue_ids`, `evicted_issue_ids`, `issue_updates`, `invalidations` (`issue_ids`, `parent_ids`, `column_counts`, `board_snapshot`).
- **DB Schema:** None.

## 5. Constraints
- **Security:** Re-verifies `lock_version` and `PermissionPolicy#can_delete_issue?` inside the transaction after acquiring `Issue.lock`.
- **Performance:** Deletion candidate enumeration (`BoardMembershipResolver#deletion_candidate_ids`) is bounded by `effective_entity_limit`.

## 6. Required Tests
- **Unit:** `test/unit/issue_destroyer_test.rb`, `frontend/src/ui/useKanbanActions.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`
- **Regression:** `CONFLICT` / `DELETE_FAILED` handling and strict separation of `deleted_issue_ids` vs. `evicted_issue_ids`.
