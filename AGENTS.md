# AGENTS.md — Redmine Kanban Plugin

## Project Overview

A Redmine plugin providing a Kanban board with WIP limits, aging visualization, and canvas drag-and-drop.

* **Stack**: Ruby on Rails (Redmine 6.0 / 6.1 / 7.0), React 18, TypeScript (strict), Vite, Playwright
* **Test Runners**: Rails Minitest (not RSpec) under `test/`, Vitest under `frontend/`, Playwright under `e2e/`
* **Artifacts**: Tracked production assets reside in `assets/`. Never edit them directly.

## Critical Project Invariants

Follow these repository-specific invariants without deviation:

* **Frontend Build & Assets**:
  * Whenever modifying `frontend/`, build the bundle (`pnpm run build` or `npm --prefix frontend run build`) and include the generated files under `assets/` in the same commit.
  * Keep `package-lock.json` consistent with dependencies; do not leave mixed lockfile states.
* **Canvas & State Boundaries**:
  * Drag-and-drop state must strictly route through the state-machine boundary under `frontend/src/ui/board/`.
  * Do not bypass normalized snapshot application ordering, scope fingerprints, or freshness tracking with ad-hoc local state.
* **Snapshot & Mutation Contract (API v3)**:
  * `/data` returns a flat snapshot (`entities` + `tree.root_ids` / `tree.children_by_parent_id`) with `meta.complete: true`.
  * Mutations return flat deltas (`issue_updates`, `created_issues`, `deleted_issue_ids`, `evicted_issue_ids`, `tree_changes`, `column_counts`, `invalidations`). Do not refetch the full board on normal successful mutations.
  * If mutation scope/response limits are exceeded, keep domain changes and set `invalidations.board_snapshot: true` to trigger a frontend refresh.
  * Bulk create enforces a hard limit of 50 non-empty subtasks (return 422 before starting transactions).
* **Rails & Data Safety**:
  * Business logic lives in `lib/redmine_kanban/` under the `RedmineKanban` namespace. Controllers remain thin.
  * Do not partially select `User` columns if `User#name` will be evaluated (omitting fields like `firstname` raises `ActiveModel::MissingAttributeError`).
  * Capture issue status / done-ratio changes immediately after `save`, before priority propagation reloads records.

## Autonomous Scope & Definition of Done

* **Autonomous Execution**:
  * You have permission to implement changes, run relevant test suites, fix regressions caused by your modifications, rebuild frontend assets, and iterate until tests pass cleanly without seeking approval at every intermediate step.
* **Scope Discipline**:
  * Keep edits focused on the requested task. Do not execute unrequested wide refactoring, database migrations, permission model changes, or dependency upgrades.
* **Definition of Done**:
  A task is complete when:
  1. The code change meets the user requirement while adhering to the critical invariants above.
  2. Targeted verification commands (unit/functional/types/linter) pass cleanly.
  3. If frontend source was modified, `assets/` is rebuilt and git-tracked artifacts match the build output.
  4. The final response succinctly states modified files, key architectural decisions, and which validations were run (or why specific checks were skipped).

## Essential Validation Commands

Run only the commands relevant to the files changed:

### Frontend
```bash
# Focused test
npm --prefix frontend run test -- --run <path-or-pattern>

# Static checks & full build
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build