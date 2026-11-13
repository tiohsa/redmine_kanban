# SPEC: Work Timer & Time Entry Integration

## 1. Goal
- Provide an issue-level Work Timer (start, extend, stop, record) that connects elapsed time to Redmine's native Time Entry creation form (iframe).
- Maintain a crash-safe session contract (`TIMER_SESSION_VERSION = 4`) across reloads, tab ownership changes, and uncertain submission outcomes (`unknown`) so recovery/reconciliation **never creates duplicate Time Entry POSTs**.

## 2. Non-goals / Out-of-scope
- Adding a custom Time Entry API endpoint that bypasses Redmine's `log_time` permission, project membership, or native Time Entry validations.
- Automatically committing Time Entries in the background without explicit user form submission or resolution.

## 3. Acceptance Criteria
- [ ] **Happy Path (Timer to Time Entry Recording):** Given a user with `log_time` permission and an eligible issue, when starting a timer (`createTimerSession`), stopping (`stop` or `autoStop` deadline), and recording (`beginRecording` / `stopAndBeginRecording`) via the Time Entry iframe form, then `recordingAttempt.phase` transitions `editing` -> `submitting` -> `confirmed` and the session is cleaned up.
- [ ] **Happy Path (Deadline Expiry & Extension):** Given `autoStop: true` at deadline, `tick` transitions to `stopped_pending_record` with `notifiedType: 'stopped'`. Given `autoStop: false` at deadline, `tick` transitions to `expired` with `notifiedType: 'running_expired'` and allows continuing or `extend`.
- [ ] **Error / Boundary Case (Validation Error):** Given a Redmine Time Entry validation error on submit, `markValidationError` transitions `recordingAttempt.phase` from `submitting` back to `editing` without discarding the timer session.
- [ ] **Error / Boundary Case (Unknown Outcome & Duplicate POST Prevention):** Given a network failure or tab close during `submitting`, `markUnknown` transitions to `phase: 'unknown'`, prompting the user via `PendingWorkModal` to resolve (`resolveUnknown`) as `'recorded'` or `'unregistered'`, and recovery never automatically re-POSTs.
- [ ] **Error / Boundary Case (Multi-Tab Ownership):** Given another tab owns `recordingAttempt.ownerTabId`, duplicate submission is blocked unless explicit `takeOverRecording` occurs.
- [ ] **Backward Compatibility:** `timerDomain.test.ts`, `timerSessionContract.test.ts`, `timerStorage.test.ts`, `timeEntryOperation.test.ts`, `WorkTimer.test.tsx`, `useWorkTimer.test.tsx`, and `kanban-worktime.spec.js` pass.

## 4. Public API / DB Schema
- **Client Session Contract:** `TimerSession` (`version: 4`, `state: 'running' | 'expired' | 'stopped_pending_record'`, `recordingAttempt.phase: 'editing' | 'submitting' | 'unknown' | 'confirmed'`).
- **Redmine Integration:** Native Time Entry creation URL inside iframe (`timeEntryUrl.ts`, `timeEntryOperation.ts`).
- **DB Schema:** None (uses standard Redmine `time_entries` table).

## 5. Constraints
- **Security:** Requires `PermissionPolicy#can_log_time?` (`log_time` permission), issue eligibility, and native Redmine Time Entry validation/membership checks. Timer storage is scoped per user.
- **Performance:** `tick` computes elapsed/remaining time from local timestamps without background API polling.

## 6. Required Tests
- **Unit:** `frontend/src/ui/workTimer/timerDomain.test.ts`, `frontend/src/ui/workTimer/timerSessionContract.test.ts`, `frontend/src/ui/workTimer/timerStorage.test.ts`, `frontend/src/ui/workTimer/recordingCommand.test.ts`, `frontend/src/ui/workTimer/timeEntryUrl.test.ts`, `frontend/src/ui/workTimer/WorkTimer.test.tsx`, `frontend/src/ui/workTimer/useWorkTimer.test.tsx`, `frontend/src/ui/iframe/timeEntryOperation.test.ts`
- **Integration / E2E:** `e2e/tests/kanban-worktime.spec.js`
- **Regression:** Recovery from `phase: 'unknown'` and `phase: 'confirmed'` never triggers duplicate Time Entry POSTs.
