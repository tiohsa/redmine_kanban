# SPEC: Issue Dialog (iframe) & Native Mutation Synchronization

## 1. Goal
- Open native Redmine issue creation and editing forms inside an iframe dialog (`IframeEditDialog` / `KanbanIssueModal`) so users have full access to custom fields and standard Redmine controls.
- Trigger an authoritative board refresh (`preserveDisplay: true`) when a native Redmine write completes inside the iframe.
- Preserve Gantt chart redirect compatibility (`GET /projects/:project_id/gantt`).

## 2. Non-goals / Out-of-scope
- Reimplementing Redmine's full native issue form (custom fields, attachments, watchers) in React.
- Treating native iframe writes as ordinary plugin API deltas.

## 3. Acceptance Criteria
- [ ] **Happy Path (Native Edit / Create Sync):** Given an open native edit or create iframe dialog, when the user submits the Redmine form and save succeeds, then `saveFlow` detects completion and triggers `onNativeWriteComplete` to refresh the authoritative board snapshot while preserving display settings.
- [ ] **Happy Path (Dialog Size Persistence):** Given a configured `issueDialogSize`, when opening `IframeEditDialog`, then the dialog dimensions follow `model/view/issueDialogSize.ts`.
- [ ] **Happy Path (Gantt Redirect):** Given `GET /projects/:project_id/gantt` with or without query parameters, when `RedirectsController#gantt` handles it, then it redirects to `/projects/:project_id/issues/gantt` preserving the query string.
- [ ] **Error / Boundary Case (Validation Error in iframe):** Given a Redmine form validation error inside the iframe, then the dialog stays open displaying Redmine's validation errors and does not fire `onNativeWriteComplete`.
- [ ] **Error / Boundary Case (Wiki Link Safety):** Given links inside iframe wiki content, then `iframeStyles.ts` applies `rel="noopener noreferrer"`.
- [ ] **Backward Compatibility:** `IframeEditDialog.test.ts`, `IframeEditDialog.layout.test.tsx`, `saveFlow.test.ts`, `redmineForm.test.ts`, `kanban-issue-dialog.spec.js`, and `kanban-native-mutation.spec.js` pass.

## 4. Public API / DB Schema
- **Endpoint:** `GET /projects/:project_id/gantt` (`redmine_kanban/redirects#gantt`) -> HTTP 302 redirect to `/projects/:project_id/issues/gantt`
- **DB Schema:** None.

## 5. Constraints
- **Security:** Operates only on same-origin Redmine forms, preserving Redmine's native CSRF tokens and permission checks; external/wiki links receive `noopener noreferrer`.
- **Performance:** `iframeObservers.ts` and `iframeMeasurement.ts` avoid unnecessary layout thrashing during resize observation.

## 6. Required Tests
- **Unit:** `frontend/src/ui/IframeEditDialog.test.ts`, `frontend/src/ui/IframeEditDialog.layout.test.tsx`, `frontend/src/ui/KanbanIssueModal.test.tsx`, `frontend/src/ui/iframe/saveFlow.test.ts`, `frontend/src/ui/iframe/redmineForm.test.ts`, `frontend/src/ui/board/iframeStyles.test.ts`
- **Integration / E2E:** `e2e/tests/kanban-issue-dialog.spec.js`, `e2e/tests/kanban-native-mutation.spec.js`, `e2e/tests/native-button-popup.spec.js`
- **Regression:** Focus restoration on dialog close and preservation of display preferences after native writes.
