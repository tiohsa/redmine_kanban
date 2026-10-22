# Filters

Use toolbar filters to choose which issues appear on the board.

## Available Filters

The toolbar provides the following filter controls:

| Filter | Description |
| --- | --- |
| **Project** | Select current project, subprojects, or multiple viewable cross-projects |
| **Status** | Toggle individual status columns on or off independently |
| **Tracker** | Filter by issue tracker (Bug, Feature, Task, Support, etc.) |
| **Assignee** | Filter by assigned user or group (including "Unassigned") |
| **Due Date** | Filter by overdue issues, due today, due this week, or due within N days |
| **Priority** | Filter by priority levels (High, Urgent, Immediate, etc.) |
| **Search** | Incremental text search by issue subject and issue ID |

---

## Server-Side Admission vs. Client Display Filtering

Filters run in two stages to preserve issue hierarchies.

### 1. Server-Side Primary Admission
- The server selects issues matching the project, status, tracker, assignee, priority, and due date filters.
- **Hierarchy Retention**: The snapshot also includes necessary ancestors and related subtrees to keep the hierarchy intact.

### 2. Client-Side Presentation
- The frontend applies the active filters to the received normalized snapshot.
- If a parent is hidden, matching children appear as independent cards. Their parent-child relationships stay intact.

---

## Scoped Candidate Recovery

Filter options in dropdown menus are dynamically populated from `GET /projects/:project_id/kanban/metadata`.

Candidate lists are bounded at 10,000 items per resource and reflect valid tracker and assignee choices authorized for your user account.
