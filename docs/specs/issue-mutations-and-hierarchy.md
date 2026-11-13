# SPEC: Issue Mutations, Bulk Subtasks & Hierarchy Synchronization

## 1. Goal
- Enable single-issue creation, inline issue updates (subject, description, assignee, priority, start/due dates, tracker, done ratio, status), and bulk subtask creation from the board.
- Maintain consistency among child issues, parent/ancestor progress and priority, and board membership (`BoardMembershipResolver`) via bounded deltas (or `invalidations.board_snapshot: true` when a bounded delta cannot be produced).
- Provide idempotent bulk subtask creation via `Idempotency-Key` with strict payload and count validation.

## 2. Non-goals / Out-of-scope
- Allowing more than 50 non-empty subtasks in a single bulk creation request.
- Replacing ordinary mutation handling with unconditional full-board refetching.
- Creating parallel React state for server-backed membership, hierarchy, counts, or freshness.

## 3. Acceptance Criteria
- [ ] **Happy Path (Single Create / Update):** Given a user with `add_issues` / `edit_issues` and `manage_redmine_kanban`, when calling `POST /issues` or `PATCH /issues/:id` (with `lock_version`), then the issue is saved and a bounded delta containing `issue_updates` (target and visible ancestors), `created_issues`, and `tree_changes` is returned.
- [ ] **Happy Path (Bulk Subtask Creation):** Given a valid `Idempotency-Key` and 1 to 50 non-empty subtasks, when calling `POST /issues/bulk`, then the parent (new or existing) and subtasks are created atomically, and retries with the same `Idempotency-Key` and payload return the idempotent result.
- [ ] **Error / Boundary Case (Bulk Limit Exceeded):** Given more than `MAX_BULK_SUBTASKS` (`50`) non-empty subtasks, when calling `POST /issues/bulk`, then the request is rejected with HTTP 422 (`field_errors.subtasks`) before opening a domain transaction or claiming idempotency.
- [ ] **Error / Boundary Case (Missing Idempotency-Key / Invalid Payload):** Given a missing `Idempotency-Key` header or malformed `bulk` / `subtasks` structure, when calling `POST /issues/bulk`, then HTTP 422 is returned.
- [ ] **Error / Boundary Case (Missing/Stale lock_version or Invalid Fields):** Given a missing or stale `lock_version`, invalid dates/priority, or disallowed status transition, when calling `PATCH /issues/:id`, then HTTP 422 or 409 is returned without modifying the database.
- [ ] **Error / Boundary Case (Delta Overflow / Active Filter):** Given a mutation whose response exceeds `SnapshotLimits.response_bytes` or occurs under an active filter where a complete bounded delta cannot be built, then the domain mutation is preserved and `invalidations.board_snapshot: true` is returned so the frontend fetches an authoritative snapshot.
- [ ] **Backward Compatibility:** `IssueCreatorTest`, `IssueUpdaterTest`, `BulkIdempotencyTest`, and `AncestorIssueUpdatesTest` pass.

## 4. Public API / DB Schema
- **Endpoints:**
  - `POST /projects/:project_id/kanban/issues` (`redmine_kanban/api#create`)
  - `POST /projects/:project_id/kanban/issues/bulk` (`redmine_kanban/api#bulk_create`, requires `Idempotency-Key` header)
  - `PATCH /projects/:project_id/kanban/issues/:id` (`redmine_kanban/api#update`)
- **DB Schema:** Existing `BulkIdempotency` schema is preserved; no new migrations.

## 5. Constraints
- **Security:** `PermissionPolicy#can_create_issue?` (checked against the target parent/project) and `can_update_issue?` are enforced server-side. Ancestor updates are filtered by `Issue.visible(@user)`.
- **Performance:** Bulk creation is capped at `MAX_BULK_SUBTASKS = 50`. Mutation responses are bounded by `SnapshotLimits.response_bytes` via `ApiController#enforce_mutation_response_limit` and `MutationResultBuilder`.

## 6. Required Tests
- **Unit:** `test/unit/issue_creator_test.rb`, `test/unit/issue_updater_test.rb`, `test/unit/bulk_idempotency_test.rb`, `test/unit/bulk_payload_normalizer_test.rb`, `test/unit/ancestor_issue_updates_test.rb`, `frontend/src/ui/bulkSubtasks.test.ts`, `frontend/src/ui/bulkIdempotency.test.ts`, `frontend/src/ui/useIssueMutation.test.tsx`, `frontend/src/ui/useMutationReconciler.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`
- **Regression:** `MutationOutcome` captures status/done-ratio changes immediately after `Issue#save` before reloads; older parent/ancestor responses do not overwrite newer child/hierarchy mutations.
