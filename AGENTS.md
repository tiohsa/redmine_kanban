# AGENTS.md

## Project

Redmine Kanban is a Redmine plugin providing a Kanban board with WIP limits, aging visualization, issue interaction, and canvas-based drag-and-drop.

Supported Redmine versions:

* Redmine 6.0
* Redmine 6.1
* Redmine 7.0

Frontend stack includes React 18, TypeScript in strict mode, and Vite.

Tests are split across Rails Minitest, Vitest, and Playwright.

Use the repository as the primary source of truth. Read supporting documentation only when relevant to the task.

## Invariants

### Frontend build and tracked assets

Frontend source lives under `frontend/`.

Production assets under `assets/` are generated artifacts.

Do not edit generated assets manually.

When a frontend change affects the production bundle, rebuild it using the repository's existing build process and include tracked generated assets required by the repository.

Keep dependency metadata and lockfiles internally consistent.

### Kanban state and mutations

Preserve the existing ownership of board, issue, drag-and-drop, and mutation state.

Extend the existing state/update path rather than creating parallel local state for the same server-backed concern.

Do not allow stale asynchronous responses to overwrite newer user actions or issue state.

Operations that can overlap must retain appropriate request scoping, generation tracking, or single-flight behavior.

### Issue hierarchy

Changes to child issues can affect parent and ancestor progress.

Do not apply an older parent/ancestor response after a newer child or hierarchy update.

Preserve consistency between child completion state and parent/ancestor progress.

### Drag-and-drop

Respect WIP limits, permissions, status-transition constraints, and repository-defined board rules.

Do not make optimistic UI state authoritative when the server rejects or supersedes the operation.

Rollback or reconciliation behavior must leave the board consistent with server state.

### Aging

Preserve the repository's definition of aging and its synchronization with issue update timestamps.

Do not introduce a second independent aging source.

### Work time

Work-time functionality must follow Redmine permissions, time-entry validation, project membership, and issue eligibility rules.

Keep behavior consistent between the Kanban implementation and established repository/product behavior where the same concept is shared.

UI entry points for work-time actions must not interfere with existing issue-edit, drag, or card interaction targets.

### Persistence

Do not introduce database migrations or persistent support tables solely for client workflow state unless the requested feature explicitly requires persistent server-side data and no existing Redmine mechanism fits.

Prefer existing Redmine data models and lightweight client persistence where appropriate.

### UI behavior

Preserve existing Kanban interaction patterns unless the requested change explicitly modifies them.

Avoid broad layout or interaction changes as incidental consequences of feature work.

## References

Read documentation only when relevant to the task.

Use:

* `README.md` for product behavior;
* feature/task documents for feature-specific decisions;
* existing tests as executable definitions of established behavior.

When implementation and a current feature decision document differ, determine whether the document represents a newer intended behavior before changing code.

## Validation

Use the smallest sufficient validation set for the changed area.

Backend changes:

* run relevant Rails Minitest tests.

Frontend logic/component changes:

* run relevant Vitest tests.

User interaction or end-to-end workflow changes:

* run relevant Playwright tests when the behavior is covered at that level.

Frontend bundle changes:

* build the production frontend and update tracked generated assets when required.

When a change affects several layers, validate the affected boundaries rather than testing only the layer where the edit occurred.

When fixing a regression, add or update a regression test when practical.

If a relevant check fails:

1. determine whether the requested change caused it;
2. fix directly caused failures;
3. rerun affected validation.

Do not mechanically run every available test suite for narrowly scoped changes when targeted validation is sufficient.

## Completion

Continue until:

* the requested behavior is implemented;
* directly caused regressions are resolved;
* relevant tests and builds pass;
* required generated assets are current;
* server and client behavior remain consistent.

Do not stop after the first implementation simply to ask whether testing or directly required fixes should continue.

## Boundaries

Fix problems directly caused by the requested work.

Do not expand the task into unrelated:

* refactoring;
* cleanup;
* dependency upgrades;
* migrations;
* UI redesign;
* behavioral changes.

Small adjacent changes are acceptable when necessary for correctness, consistency, or validation.

Report worthwhile but unrelated improvements separately instead of implementing them as part of the current task.
