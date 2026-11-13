# SPEC: Canvas Board Rendering, Swimlanes, Drag & Drop & Sorting

## 1. Goal
- Render a high-performance Kanban board on HTML Canvas supporting smooth scrolling and large issue sets.
- Support swimlanes (`none`, `assignee`, `priority`, `category`) and multi-criteria card sorting (`due`, `priority`, `updated`).
- Keep drag-and-drop (D&D) interaction state within `frontend/src/ui/board/`, ensuring drop indication and actual command dispatch share the exact same eligibility decision (`noop`, `dispatch`, `forbidden`).

## 2. Non-goals / Out-of-scope
- Changing an Issue's category via drag-and-drop in Category swimlanes.
- Creating a second drag state machine in component-local React state.
- Replacing Redmine server workflow validation with client-side workflow metadata.

## 3. Acceptance Criteria
- [ ] **Happy Path (Standard D&D Move):** Given a user with `manage_redmine_kanban` and issue edit permissions, when dragging a card (or subtask area) and dropping onto a target assessed as `dispatch`, then `PATCH /projects/:project_id/kanban/issues/:id/move` is dispatched with `lock_version` and the board reconciles via bounded delta.
- [ ] **Happy Path (Assignee & Priority Swimlanes):** Given `assignee` or `priority` swimlanes, when dropping onto another lane, then `assigned_to_id` or `priority_id` (including unassigned/none) is updated accordingly.
- [ ] **Happy Path (Card Sorting):** Given a valid `SortConfig` (up to 3 criteria from `due`, `priority`, `updated` with `asc` or `desc`), when `sortIssues` runs, then cards are ordered by `buildIssueComparator`.
- [ ] **Error / Boundary Case (Category Swimlane Restrictions):** Given `category` swimlanes, when dragging Category A -> Category B, Category -> no-category, or no-category -> Category, then `assessDrop` returns `action: 'forbidden'`, cursor becomes `not-allowed`, no allowed highlight/preview is shown, and dropping does not dispatch a mutation. Same-category status moves remain `dispatch` when normal workflow rules allow.
- [ ] **Error / Boundary Case (No-op & Workflow Denial):** Given a drop onto the same status and lane, `assessDrop` returns `action: 'noop'` and dispatches nothing. Given a server-disallowed workflow transition, the server returns `WORKFLOW_TRANSITION_NOT_ALLOWED` (HTTP 422) and optimistic state is rolled back.
- [ ] **Backward Compatibility:** Existing `CanvasBoard.test.tsx`, `dropEligibility.test.ts`, `dragInteraction.test.ts`, and `IssueMoverTest` pass.

## 4. Public API / DB Schema
- **Endpoint:** `PATCH /projects/:project_id/kanban/issues/:id/move` (`redmine_kanban/api#move`)
  - **Request:** `status_id`, `lock_version` (required), optional `assigned_to_id`, `priority_id`, `operation_id`, and board scope params.
  - **Response:** Bounded delta (`ok: true`, `issue_updates`, `evicted_issue_ids`, `tree_changes`, `invalidations`, `column_counts`, etc.) or structured error (`ok: false`, `code`).
- **DB Schema:** None.

## 5. Constraints
- **Security:** `ApiController#require_move_permission` enforces `can_view_board?` and `can_move_issue?(@issue, @project)`. Optimistic locking via `lock_version` is required. Unintended parent priority changes are prevented (`preserve_parent_priority`).
- **Performance:** Canvas layout (`BoardLayout`) and hit-testing (`HitTestIndex`) avoid DOM bloat and minimize redraw overhead during dragging.

## 6. Required Tests
- **Unit:** `frontend/src/ui/board/dropEligibility.test.ts`, `frontend/src/ui/board/dragInteraction.test.ts`, `frontend/src/ui/board/cursor.test.ts`, `frontend/src/ui/board/CanvasPointerController.test.ts`, `frontend/src/ui/board/CanvasBoard.test.tsx`, `frontend/src/ui/board/sort.test.ts`, `test/unit/issue_mover_test.rb`
- **Integration / E2E:** `test/functional/api_controller_test.rb`, `e2e/tests/kanban-move-overlap.spec.js`, `e2e/tests/kanban-move-refresh.spec.js`
- **Regression:** Category swimlane regression coverage for same-category status moves and forbidden cross-category / category-to-none / none-to-category moves.
