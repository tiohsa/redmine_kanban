# SPEC: Filters, Search, URL Query Parameters & Saved Views

## 1. Goal
- Provide SQL-backed board filtering by keyword (`q`), assignee (`assignee_ids`, `include_unassigned`), tracker (`tracker_ids`), priority (`priority_filter_enabled`, `priority_ids`, `include_no_priority`), due date (`due`, `due_days`, `date_anchor`), project (`project_ids`), and status columns (`issue_status_ids`, `exclude_status_ids`).
- Support synchronizing filter/view state with URL query parameters (`boardQuery`) and saving/restoring up to 20 named Saved Views (`savedViews`).

## 2. Non-goals / Out-of-scope
- Server-side database persistence for Saved Views (currently stored in scoped browser storage via `savedViewsRepository.ts`).
- Cross-tab distributed transaction guarantees for Saved Views.
- Rewriting canonical Issue `parent_id` relations when filters or lanes change.

## 3. Acceptance Criteria
- [ ] **Happy Path (Board Filtering):** Given valid filter parameters (e.g., `filter_due` in `all | overdue | thisweek | 3days | 7days | 1day | custom | none`, `filter_q`, `filter_assignee_ids`, `filter_tracker_ids`, `filter_priority_enabled`), when `BoardIssueFilter` and `BoardData` run, then `scope_fingerprint` reflects the filter scope and a complete snapshot of matching issues and required ancestor hierarchy is returned.
- [ ] **Happy Path (Saved Views):** Given fewer than 20 saved views, when creating, applying, or deleting a view, then `model/view/savedViews.ts` validates schema `version: 1`, `savedViewsRepository.ts` persists it, and applying a view restores its filters and display settings.
- [ ] **Error / Boundary Case (Invalid Filter Parameters):** Given an unsupported `filter_due` mode or invalid `filter_due_days` / `filter_date_anchor`, when calling the API, then `INVALID_BOARD_FILTER` (HTTP 400) is returned.
- [ ] **Error / Boundary Case (Saved View Limit / Corrupt Storage):** Given `MAX_SAVED_VIEWS` (`20`) already reached, adding a view throws `saved_views_limit`. Given corrupt JSON (`version !== 1` or exceeding limit), `saved_views_unreadable` is thrown and handled safely.
- [ ] **Backward Compatibility:** `BoardIssueFilterTest`, `boardFilters.test.ts`, `boardQuery.test.ts`, `savedViews.test.ts`, `savedViewTransitions.test.tsx`, `savedViews.multitab.test.tsx`, and `kanban-recovery-views.spec.js` pass.

## 4. Public API / DB Schema
- **Query Parameters (Snapshot & Mutation Scope Context):**
  - `project_ids[]`, `issue_status_ids[]`, `exclude_status_ids[]`
  - `filter_q`, `filter_assignee_ids[]`, `filter_include_unassigned`, `filter_tracker_ids[]`, `filter_priority_enabled`, `filter_priority_ids[]`, `filter_include_no_priority`, `filter_due`, `filter_due_days`, `filter_date_anchor`
- **Client Storage Schema:** `SavedViewsDocument = { version: 1; views: SavedView[] }` (`MAX_SAVED_VIEWS = 20`)
- **DB Schema:** None.

## 5. Constraints
- **Security:** `BoardIssueFilter` constructs parameterized ActiveRecord predicates only; `project_ids` is intersected with `Project.visible(User.current)` and authorized projects.
- **Performance:** Mutations executed while a filter is active return `invalidations.board_snapshot: true` to trigger an authoritative snapshot refresh rather than risking inconsistent partial filter deltas.

## 6. Required Tests
- **Unit:** `test/unit/board_issue_filter_test.rb`, `frontend/src/ui/boardFilters.test.ts`, `frontend/src/ui/boardQuery.test.ts`, `frontend/src/ui/savedViews.test.ts`, `frontend/src/ui/savedViewTransitions.test.tsx`, `frontend/src/ui/savedViews.multitab.test.tsx`, `frontend/src/ui/toolbar/SavedViewsPopover.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`, `e2e/tests/kanban-recovery-views.spec.js`
- **Regression:** Switching views rapidly does not allow an older view's snapshot response to overwrite the newly selected view.
