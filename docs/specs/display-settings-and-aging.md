# SPEC: Display Settings, WIP Limits & Aging Visualization

## 1. Goal
- Persist and restore per-user, per-project display preferences (theme, font size, fit mode, full-window mode, card display mode, subtask visibility, swimlane type, aging thresholds, hidden statuses, etc.).
- Highlight stalled issues via configurable aging thresholds (warning days, danger days, closed-issue exclusion).
- Visualize column WIP limits and issue counts to surface flow bottlenecks.

## 2. Non-goals / Out-of-scope
- Adding server-side database tables for user display preferences.
- Sharing personal display preferences globally across users.

## 3. Acceptance Criteria
- [ ] **Happy Path (Preference Persistence):** Given a user on a board, when changing theme (default `light`), swimlane type, font size, or subtask display via `DisplaySettingsPopover`, then `preferencesRepository.ts` / `scopedStorage.ts` saves the values under user- and project-scoped keys and restores them across reloads.
- [ ] **Happy Path (Aging Thresholds & Closed Exclusion):** Given aging settings (defaults: `agingWarnDays = 3`, `agingDangerDays = 7`, `agingExcludeClosed = true`), when evaluating issue update age, then warning/danger highlights apply according to thresholds and closed issues are excluded when `agingExcludeClosed = true`.
- [ ] **Error / Boundary Case (Invalid Stored Values & Threshold Ordering):** Given negative or non-integer values in storage, `restoreAgingDays` falls back to defaults (`3` / `7`). Given `agingDangerDays < agingWarnDays`, `Math.max(warnDays, dangerDays)` clamps danger days to at least warn days.
- [ ] **Error / Boundary Case (Legacy Key Migration):** Given legacy unscoped storage keys from earlier versions, `readScopedValueWithLegacy` / `readScopedBooleanWithLegacy` reads and migrates them cleanly.
- [ ] **Backward Compatibility:** `useKanbanPreferences.test.tsx`, `storage.test.ts`, `App.displaySettings.test.tsx`, and `App.calendar.test.tsx` pass.

## 4. Public API / DB Schema
- **Client Storage Keys (user- and project-scoped via `scopedStorage.ts`):**
  - `rk_aging_warn_days` (default `3`)
  - `rk_aging_danger_days` (default `7`)
  - `rk_aging_exclude_closed` (default `true` / `'1'`)
  - Additional preference keys for theme, font size, fit mode, lane type, sort config, dialog size, etc.
- **DB Schema:** None.

## 5. Constraints
- **Security:** Browser storage contains UI preferences only; no credentials or sensitive tokens are stored.
- **Performance:** Preference updates that do not alter board scope re-render on the client Canvas without triggering redundant API fetches.

## 6. Required Tests
- **Unit:** `frontend/src/ui/useKanbanPreferences.test.tsx`, `frontend/src/ui/utils/storage.test.ts`, `frontend/src/ui/App.displaySettings.test.tsx`, `frontend/src/ui/toolbar/toolbarOptions.test.ts`
- **Integration / E2E:** `e2e/tests/kanban-smoke.spec.js`, `e2e/tests/kanban-calendar.spec.js`
- **Regression:** Legacy storage key compatibility and strict user/project scope isolation.
