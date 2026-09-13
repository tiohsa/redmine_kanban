# AGENTS.md

## Project

Redmine Kanban is a Redmine plugin for Kanban boards with WIP limits, aging visualization, issue interaction, work-time support, swimlanes, and canvas-based drag-and-drop.

* Redmine: 6.0 / 6.1 / 7.0
* Backend: Ruby on Rails / Redmine plugin APIs
* Frontend: React 18, TypeScript strict, Vite, TanStack React Query
* Tests: Rails Minitest, Vitest, Playwright

Use the repository as the primary source of truth.

Consult these only when relevant:

* `README.md` for current product behavior and API notes.
* `spec-docs/` for feature-specific decisions and historical specifications.
* Existing tests for established executable behavior.

If documentation and implementation disagree, determine whether the document describes a newer intended behavior before changing code.

## Non-Negotiable Invariants

Preserve these unless the requested task explicitly changes the corresponding behavior.

### Frontend and generated assets

Frontend source lives under `frontend/`. Production assets under `assets/` are generated.

* Never edit generated assets manually.
* If a frontend change affects the production bundle, rebuild it and include the tracked generated assets.
* Keep dependency metadata and lockfiles consistent.
* Do not perform unrelated dependency upgrades.

### API v3 board state

The canonical board snapshot is the normalized API v3 representation:

* `entities`
* `tree.root_ids`
* `tree.children_by_parent_id`
* `scope_fingerprint`
* `meta.complete: true`

Do not reintroduce recursive Issue copies as a second source of truth.

Preserve project/status/dependency scopes, fingerprints, entity/query/response limits, and structured resource-limit behavior. Never silently return partial snapshots.

### Mutations and reconciliation

Normal successful mutations return bounded API v3 deltas. Do not replace ordinary mutation handling with unconditional full-board refetching.

If a successful domain mutation cannot produce a complete bounded delta, preserve the mutation and return `invalidations.board_snapshot: true` so the frontend can fetch a new authoritative snapshot.

Bulk creation accepts at most 50 non-empty subtasks; reject oversized requests before domain transactions or idempotency claims.

Stale asynchronous responses must never overwrite newer user actions or server state. Preserve the repository's existing mechanisms for:

* scope fingerprints;
* request generations/revisions;
* freshness authority;
* optimistic mutation state;
* entity and aggregate reconciliation;
* negative membership reconciliation;
* mutation operation IDs;
* single-flight or equivalent ordering protection.

Extend the existing normalized board/state path. Do not create parallel React state for server-backed issue membership, hierarchy, mutation results, counts, or freshness.

### Issue hierarchy

Child mutations can affect parents and ancestors. Preserve consistency among child state, parent/ancestor progress, hierarchy, and board membership.

Do not apply an older parent or ancestor response after a newer child/hierarchy mutation.

When mutation logic needs to detect status or done-ratio changes, capture the mutation result immediately after the Issue save, before later operations can reload the record.

### Canvas and drag-and-drop

Canvas drag state belongs in the existing interaction/state-machine boundary under:

`frontend/src/ui/board/`

Do not create a second drag state machine in component-local React state or bypass the existing layout, hit-test, pointer, drag-lifecycle, rendering, and command-dispatch boundaries.

Drop indication and actual dispatch must use the same eligibility decision.

Current drop assessment distinguishes:

* `noop`
* `dispatch`
* `forbidden`

Redmine remains the final authority for workflow transitions. Client workflow metadata is guidance, not a replacement for server validation.

#### Category swimlanes

Category swimlanes do not change Issue category by drag-and-drop.

Therefore:

* Category A -> Category B is forbidden.
* Category -> no-category is forbidden.
* no-category -> Category is forbidden.
* Forbidden targets must not show an allowed highlight/preview and must not dispatch a mutation.
* Same-category status movement remains allowed when normal workflow/move rules allow it.

Assignee and priority swimlanes retain their existing lane-changing behavior.

### Permissions and Redmine authority

Use Redmine permission, visibility, workflow, membership, and Time Entry validation APIs.

Frontend permission checks are usability controls, not security boundaries. Server mutation paths must enforce permissions independently.

Preserve the distinction between board viewing, issue mutation, issue creation/deletion, and work-time logging.

### Backend boundaries

Business logic belongs under:

`lib/redmine_kanban/`

Keep controllers as HTTP adapters/orchestration boundaries.

Prefer focused composition over generic inheritance or broad utility abstractions. Extract shared code when it represents the same semantic invariant, not merely similar syntax.

Preserve optimistic locking via `lock_version` where applicable.

Load complete `User` records when Redmine model methods may require attributes such as `firstname`; do not introduce partial selects that can trigger `ActiveModel::MissingAttributeError`.

### Delete, aging, and work time

Keep physical deletion distinct from board-scope eviction:

* `deleted_issue_ids`
* `evicted_issue_ids`

If a complete bounded deletion delta cannot be returned, invalidate the authoritative snapshot rather than returning partial tombstones.

Do not imply that Undo restores Redmine history, comments, relations, attachments, or original IDs unless the implementation explicitly supports that behavior.

Use the repository's existing aging source and update-time synchronization. Respect the configured closed-issue exclusion behavior.

Work-time behavior must continue to respect permissions, membership, Issue eligibility, native Time Entry validation, timer lifecycle, and synchronization. Recovery/reconciliation must not create duplicate Time Entry POSTs.

### Persistence

Do not add database migrations or persistent support tables solely for transient client workflow state unless the requested feature genuinely requires server-side persistence and no existing Redmine mechanism fits.

### Performance and compatibility

Resource protection around board snapshots is intentional. Do not remove resource gates merely to make tests pass.

When performance work is required, measure first and preserve API/compatibility contracts.

All changes must remain compatible with Redmine 6.0, 6.1, and 7.0. Do not remove compatibility code based only on behavior of the newest supported version.

## How to Work

Keep the change focused on the requested task. Small adjacent changes are acceptable when required for correctness, consistency, generated output, or validation.

Do not expand the task into unrelated refactoring, cleanup, dependency upgrades, migrations, UI/API redesign, state-library replacement, or broad formatting changes.

For refactoring, preserve externally observable behavior unless the task explicitly changes it. Prefer focused extraction and composition over subsystem rewrites. Do not replace working freshness/concurrency logic merely to reduce line count.

When implementation details are unclear:

1. inspect the relevant code and nearby tests;
2. consult `README.md` or the relevant `spec-docs/` material if it can resolve the ambiguity;
3. make the smallest behavior-preserving choice if the repository still does not establish the answer;
4. report any unresolved product decision as `要確認`.

Do not invent new product behavior.

## Validation

Use the smallest validation set that can reliably detect regressions in the changed area, then expand only where the risk warrants it.

Typical frontend checks include focused Vitest tests, typecheck/lint, and a production build when the bundle changes.

Typical backend checks include the directly affected Rails Minitest suites.

Use Playwright when the behavior depends on cross-layer or real interaction semantics that unit/integration tests cannot adequately cover.

For Canvas/drop work, directly validate the interaction layers affected by the change, especially eligibility, cursor/preview state, and command dispatch.

For category swimlanes, preserve regression coverage for same-category status moves and forbidden cross-category/category-to-none/none-to-category moves.

If a check fails, first classify it as:

1. caused by the current change;
2. pre-existing;
3. environment/infrastructure.

Fix regressions caused by the current task. Do not weaken assertions, skip validation, remove resource guards, or repeatedly retry the same ineffective fix.

If the same approach fails repeatedly, return to root-cause analysis.

## Completion

Continue through implementation, directly required regression fixes, and relevant validation without stopping for approval after the first code change.

A task is complete when:

* the requested behavior is implemented;
* affected repository invariants still hold;
* regressions caused by the change are fixed;
* relevant validation passes;
* generated assets are current when required;
* server/client behavior remains consistent;
* supported Redmine versions remain compatible.

Report unrelated worthwhile improvements separately instead of expanding the task.
