# SPEC: Board Snapshot, API v3, Resource Limits & Freshness

## 1. Goal
- Treat Redmine permissions, workflows, and parent-child relations as the authority, and provide a normalized API v3 board snapshot (`entities`, `tree.root_ids`, `tree.children_by_parent_id`, `scope_fingerprint`, `meta.complete: true`) as the single source of truth for board state.
- Enforce resource limits (`SnapshotLimits`) on entity counts, SQL query counts, and response byte size, and never silently return partial snapshots.
- Prevent stale asynchronous responses from overwriting newer user actions or server state using `scope_fingerprint`, request generations, and revisions.

## 2. Non-goals / Out-of-scope
- Reintroducing legacy pagination (`offset`, `cursor`, `tree_parent_id`, `issue_limit`).
- Storing recursive Issue copies as a second source of truth in client state.
- Adding custom database migrations or persistent tables for transient board state.

## 3. Acceptance Criteria
- [ ] **Happy Path (Full Snapshot):** Given a user with `view_redmine_kanban` permission, when calling `GET /projects/:project_id/kanban/data` or `bootstrap`, then HTTP 200 is returned with `ok: true`, `contract_version: 3`, `scope_fingerprint`, `meta.complete: true`, `entities`, `tree.root_ids`, and `tree.children_by_parent_id`.
- [ ] **Happy Path (Auxiliary Read Endpoints):** Given a valid board scope, when calling `GET /metadata`, `GET /issues/entities`, `GET /counts`, or `GET /trackers`, then JSON reflecting current permissions and scope is returned.
- [ ] **Error / Boundary Case (Legacy Pagination Rejected):** Given any of `offset`, `cursor`, `tree_parent_id`, or `issue_limit` in the request, when calling `data` or `bootstrap`, then HTTP 400 is returned with `error.code: "BOARD_PAGINATION_UNSUPPORTED"`.
- [ ] **Error / Boundary Case (Resource Limits Exceeded):** Given a scope exceeding `effective_entity_limit` (max `10,000`), SQL query limits, or response byte limit (default `8 MiB`), when building a snapshot, then no partial snapshot is returned and `ok: false` is returned with a structured error code (`BOARD_SCOPE_TOO_LARGE`, `BOARD_QUERY_LIMIT_EXCEEDED`, `BOARD_TOTAL_QUERY_LIMIT_EXCEEDED`, or `BOARD_RESPONSE_TOO_LARGE`).
- [ ] **Error / Boundary Case (Invalid Limits, Filters, or IDs):** Given an invalid `board_entity_limit`, invalid filter, or `ids` exceeding `MAX_ENTITY_RECONCILIATION_IDS` (`100`) or malformed, when calling the API, then HTTP 400 is returned with `INVALID_BOARD_ENTITY_LIMIT`, `INVALID_BOARD_FILTER`, or `ArrayParamNormalizer::InvalidIssueIds` error code.
- [ ] **Error / Boundary Case (Authorization):** Given a user without `view_redmine_kanban` permission or an invisible project, when calling read endpoints, then HTTP 403 is returned (HTTP 404 for invisible project on `metadata`).
- [ ] **Backward Compatibility:** Compatible with Redmine 6.0, 6.1, and 7.0; existing `ApiControllerTest`, `SnapshotLimitsTest`, and `boardSnapshot.test.ts` pass.

## 4. Public API / DB Schema
- **Endpoints (`config/routes.rb`):**
  - `GET /projects/:project_id/kanban` (`redmine_kanban/kanban#show`)
  - `GET /projects/:project_id/kanban/data` (`redmine_kanban/api#index`)
  - `GET /projects/:project_id/kanban/bootstrap` (`redmine_kanban/api#bootstrap`)
  - `GET /projects/:project_id/kanban/metadata` (`redmine_kanban/api#metadata`)
  - `GET /projects/:project_id/kanban/issues/entities` (`redmine_kanban/api#entities`)
  - `GET /projects/:project_id/kanban/counts` (`redmine_kanban/api#counts`)
  - `GET /projects/:project_id/kanban/trackers` (`redmine_kanban/api#trackers`)
- **DB Schema:** None (reads standard Redmine tables only).

## 5. Constraints
- **Security:** All read endpoints enforce `PermissionPolicy#can_view_board?` (`view_redmine_kanban`) and `Issue.visible(User.current)` / `Project.visible(User.current)`. `metadata` returns JSON errors (404/403) so denied requests do not leak project names in Redmine HTML navigation. Load complete `User` records without partial selects that could raise `ActiveModel::MissingAttributeError`.
- **Performance:** `SnapshotLimits` enforces `HARD_MAX_BOARD_ENTITIES = 10_000`, `DEFAULT_RESPONSE_BYTES = 8 * 1024 * 1024`, `DEFAULT_QUERY_LIMIT = 20`, `DEFAULT_TOTAL_QUERY_LIMIT = 100`, and `MAX_ENTITY_RECONCILIATION_IDS = 100`. `lists` and `labels` are cached in `Rails.cache` for 60 seconds.

## 6. Required Tests
- **Unit:** `test/unit/snapshot_limits_test.rb`, `test/unit/board_data_test.rb`, `test/unit/board_tree_builder_test.rb`, `test/unit/board_membership_resolver_test.rb`, `test/unit/permission_policy_test.rb`, `frontend/src/infrastructure/api/boardSnapshot.test.ts`, `frontend/src/ui/asyncFreshness.repro.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`, `e2e/tests/kanban-snapshot.spec.js`, `e2e/tests/kanban-large-snapshot.spec.js`
- **Regression:** Full Rails Minitest and Vitest suites pass without regressions.
