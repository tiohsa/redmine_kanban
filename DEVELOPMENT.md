# English developer reference

This document contains API and CI reference details for contributors.

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/projects/:project_id/kanban/data` | Get board data |
| PATCH | `/projects/:project_id/kanban/issues/:id/move` | Move card |
| POST | `/projects/:project_id/kanban/issues` | Create ticket |
| POST | `/projects/:project_id/kanban/issues/bulk` | Create a parent with subtasks or subtasks for an existing parent |
| PATCH | `/projects/:project_id/kanban/issues/:id` | Update ticket |
| DELETE | `/projects/:project_id/kanban/issues/:id` | Delete ticket |
| GET | `/projects/:project_id/kanban/issues/entities?ids[]=...` | Reconcile selected flat Issue entities |

Board data notes:

- Contract version 3 returns flat `entities` exactly once per Issue plus `tree.root_ids` and `tree.children_by_parent_id`; the frontend derives recursive Canvas rows from normalized state.
- `lists.trackers` includes additive `workflow_status_ids`, `default_status_id`, and `available_project_ids` metadata. Tracker filters narrow Issue membership; the explicit Status filter independently controls visible columns. Redmine workflow metadata (`allowed_status_ids`) and server validation determine whether a status move is allowed. A single selected tracker is propagated to Native Redmine Create only when it is available in the target project.
- Frontend presentation roots are a display-only projection of the filtered tree. If an explicit Status filter or `hiddenStatusIds` makes a context parent non-renderable, a retained renderable descendant is promoted as a card without changing the canonical `parent_id` or normalized tree. Renderable context parents remain nested context, and promoted/context-only columns are never Create candidates.
- Toolbar/Lane Header Create prefers an available selected tracker’s default status, then the first open/first candidate. Context-only columns are excluded, and an empty candidate disables those Create controls without falling back to a fixed status ID.
- Drag drop cues are advisory workflow guidance from the snapshot and are shown for every rendered cell after the drag threshold (`✓` allowed, `!` snapshot mismatch/advisory, `?` unknown). NOOP and forbidden category-lane drops are suppressed, while other drops with allowed, denied, or unknown workflow hints use the existing mutation path so Redmine remains the final Workflow authority. Category-lane drops that would change the Issue category, including moves to or from the no-category lane, are forbidden: they show no allowed-target highlight or drop preview and do not dispatch a mutation. Status moves within the same category lane continue to use the existing workflow path. Workflow rejection responses use `WORKFLOW_TRANSITION_NOT_ALLOWED` and trigger one targeted entity reconciliation without retrying.
- Physical Delete responses list the actually deleted, Board-observable Issue cascade in `deleted_issue_ids`; scope eviction remains `evicted_issue_ids`. If a complete bounded deletion delta cannot be produced, the response invalidates the board snapshot instead of returning a partial tombstone. Delete Undo recreates only the requested top-level Issue.
- `board_entity_limit` is the only board size request parameter. `offset`, `cursor`, `tree_parent_id`, and `issue_limit` are rejected with HTTP 400; no partial snapshot is successful.
- Mutation responses use contract version 3 fields (`operation_id`, `scope_fingerprint`, flat `issue_updates`/`created_issues`, `deleted_issue_ids`, `tree_changes`, and invalidations). The frontend applies these deltas to normalized state and uses the entities endpoint for targeted reconciliation.
- Card moves also reconcile active Issue filters through bounded deltas, including entering/evicted ancestor and dependency membership, without refetching the full board. When a filtered move overlaps another write on the same board, the client retains optimistic display, defers the overlapping deltas, and fetches one authoritative snapshot after all pending writes settle. If a complete delta exceeds resource limits, the successful move invalidates the snapshot for authoritative recovery.
- `scope_fingerprint` is an opaque identity for board project, current user, sanitized project scope, primary status scope, and dependency status scope; its exact hash value is not a public compatibility contract. Plugin mutations use the same scope and admission parameters. Native Redmine iframe writes cannot produce a trusted delta, so successful issue/journal saves (including composite bulk-subtask operations) reset the current board query to one complete snapshot; a refresh failure is reported as a board loading problem, not a save failure.
- Issue responses are accepted only when their `lock_version`/`updated_on` freshness is not older than the cached entity. Optimistic failures roll back only fields still holding that mutation's optimistic values; overlapping mutations trigger targeted server reconciliation.
- Deleted Issue recreation is available only for domain top-level Issues. It creates a new Issue with the displayed subject, project, description, status, assignee, tracker, priority, dates, and done ratio; it never recreates a child Issue without its parent.

Bulk creation uses `Rails.cache` for idempotency. The cache identity is scoped by user, project, operation, `Idempotency-Key`, and a canonical digest of the request payload; an atomic claim means only the claimant runs creation, while processing and completed entries reject a different payload or return the previous response for the same payload. The client reuses the key for the same logical operation during a browser session. Failed validation or exceptions remove the claim so the same operation can be retried.

Bulk creation accepts at most 50 non-empty subtasks per request; requests with 51 or more are rejected before the transaction starts.

The guarantee covers duplicate submissions from one browser, retries of the same logical operation during that browser session, duplicate claims within one Redmine process, and duplicate claims across processes when the cache store provides an atomic shared `unless_exist` write. It does not provide persistent exactly-once behavior across MemoryStore process boundaries, cache loss, or server restarts.

This plugin intentionally has no database migrations or plugin-owned tables. Exactly-once persistence cannot be guaranteed when the cache is lost, the server restarts, or separate processes use non-shared stores such as per-process MemoryStore. Deployments requiring that stronger guarantee must provide a shared atomic/persistent CacheStore or an external idempotency service.

## CI

GitHub Actions workflow: `.github/workflows/e2e-kanban.yml`

The CI workflow runs:

- frontend `build`
- frontend `lint`
- frontend `typecheck`
- frontend unit tests with Vitest
- Redmine 7.0 MariaDB full Ruby/API tests and the snapshot contract gate
- PostgreSQL 16 membership/admission integration, with unit and focused API suites using separate Rails test selectors
- Playwright E2E on Redmine 7.0 and Redmine 6.1, including the native Redmine iframe save/reset lifecycle
- Playwright compatibility smoke test on Redmine 6.0
- deterministic snapshot admission gates for deep-tree, exact-limit dependency membership, response bytes, and query limits (`board_data_test.rb`, `snapshot_limits_test.rb`, and `api_controller_test.rb`)
- a Redmine 7.0 actual-DB large-data gate using the 1,505-child high-fan-out fixture; it checks limit/over-limit admission, unique entities, materialized rows, query count, response bytes, and the absence of partial entities

The main Redmine test and browser jobs use MariaDB 10 via `.github/e2e/docker-compose.yml`; the PostgreSQL membership job uses `.github/e2e/docker-compose.postgres.yml` and runs the resolver/admission integration suite. Browser jobs run migrations, load default data, seed `ecookbook` and the isolated `kanban-native` project via `e2e/setup_redmine.rb`, and upload Playwright reports on completion.

The verification entry points live under `script/ci/` so local container runs and CI use the same suite boundaries: `ruby-full.sh`, `snapshot-contract.sh`, `postgres-unit.sh`, `postgres-api.sh`, `e2e-full.sh`, `native-mutation-e2e.sh`, `large-data-e2e.sh`, and `compatibility-smoke.sh`.
