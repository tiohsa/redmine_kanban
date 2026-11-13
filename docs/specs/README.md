# Redmine Kanban Canonical Feature Specifications

This directory (`docs/specs/`) contains the **canonical per-feature specifications** for the `redmine_kanban` plugin.
Each specification follows the `spec-author-v2` template (`Goal`, `Non-goals / Out-of-scope`, `Acceptance Criteria`, `Public API / DB Schema`, `Constraints`, `Required Tests`) and must be kept in sync with the repository's implementation and tests.

## Feature Specifications

| Feature Area | Specification | Primary Scope |
| --- | --- | --- |
| Board Snapshot, API v3 & Freshness | [board-snapshot-and-api.md](board-snapshot-and-api.md) | `ApiController` (read endpoints), `BoardData`, `SnapshotLimits`, `PermissionPolicy`, `asyncFreshness` |
| Canvas Rendering, Swimlanes, D&D & Sort | [board-rendering-and-dnd.md](board-rendering-and-dnd.md) | `CanvasBoard`, `canvasInteraction`, `dragInteraction`, `IssueMover`, `sort` |
| Issue Mutations, Bulk Subtasks & Hierarchy | [issue-mutations-and-hierarchy.md](issue-mutations-and-hierarchy.md) | `IssueCreator`, `IssueUpdater`, `BulkIdempotency`, `AncestorIssueUpdates`, `BoardMembershipResolver` |
| Issue Deletion & Recreate | [issue-deletion-and-recreate.md](issue-deletion-and-recreate.md) | `IssueDestroyer`, physical deletion vs. scope eviction, Recreate deleted issue |
| Issue Dialog (iframe) & Native Sync | [issue-dialog-and-native-sync.md](issue-dialog-and-native-sync.md) | `KanbanIssueModal`, `IframeEditDialog`, `saveFlow`, `RedirectsController#gantt` |
| Filters, Search, URL Query & Saved Views | [filters-and-saved-views.md](filters-and-saved-views.md) | `BoardIssueFilter`, `boardQuery`, `savedViews`, `savedViewsRepository` |
| Display Settings, WIP Limits & Aging | [display-settings-and-aging.md](display-settings-and-aging.md) | `preferences`, `preferencesRepository`, `useKanbanPreferences`, `DisplaySettingsPopover` |
| Work Timer & Time Entry Integration | [work-timer-and-time-entries.md](work-timer-and-time-entries.md) | `WorkTimer`, `timerDomain`, `timerStorage`, `timeEntryOperation` |

## Maintenance Rules

1. **Canonical Source of Truth:** If a specification and the implementation disagree, verify the intended behavior from code and tests and update either the spec or the code so no contradiction remains.
2. **Update Together:** Whenever a feature is added or behavior, public APIs, limits, permissions, or constraints change, update the corresponding `docs/specs/*.md` file(s) in the same task.
3. **Architecture & Invariants:** Module boundaries and dependency directions are governed by [ARCHITECTURE.md](../../ARCHITECTURE.md), and repository-wide invariants and workflows by [AGENTS.md](../../AGENTS.md).
