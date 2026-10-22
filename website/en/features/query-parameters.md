# API and Query Limits

Redmine Kanban uses normalized **API v3** snapshots for board data.

## API v3 Normalized Snapshot Specification

Board snapshots (`GET /projects/:project_id/kanban/data`) separate issue data from hierarchy:

```json
{
  "version": 3,
  "scope_fingerprint": "a8f3...c91",
  "entities": {
    "101": { "id": 101, "subject": "Issue A", "status_id": 1, ... },
    "102": { "id": 102, "subject": "Subtask B", "status_id": 2, ... }
  },
  "tree": {
    "root_ids": [101],
    "children_by_parent_id": {
      "101": [102]
    }
  },
  "meta": {
    "complete": true
  }
}
```

### Architectural Advantages
- **No Duplicate Entities**: Each issue appears once in `entities`, even when referenced from multiple places.
- **Deterministic Tree Construction**: The frontend builds UI projections from `tree` and `entities` deterministically.
- **Efficient Bounded Deltas**: Card moves and updates return concise diffs containing only modified entities and tree branches, applying updates without full-board refetches.

---

## Server Resource Safety Ceilings

Limits on issue counts, queries, and response sizes protect the server from overload:

| Resource Ceiling | Default Limit | Behavior Upon Exceeding Limit |
| --- | --- | --- |
| **Max Board Entities** (`REDMINE_KANBAN_MAX_BOARD_ENTITIES`) | 10,000 entities | Structured HTTP 422 error; never returns partial data |
| **Snapshot SQL Queries** (`REDMINE_KANBAN_MAX_BOARD_QUERIES`) | 20 queries | Structured HTTP 422 error |
| **Total SQL Queries** (`REDMINE_KANBAN_MAX_TOTAL_BOARD_QUERIES`) | 100 queries | Structured HTTP 422 error |
| **Max Response Size** (`REDMINE_KANBAN_MAX_RESPONSE_BYTES`) | 8 MiB | Structured HTTP 422 error |

> [!IMPORTANT]
> **No Partial Board State**
> If an issue scope exceeds safety ceilings, Redmine Kanban rejects the request with HTTP 422 rather than returning an incomplete board. Users can recover by applying tighter project or status filters.

---

## Core API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/projects/:project_id/kanban/data` | Fetch normalized board snapshot |
| `GET` | `/projects/:project_id/kanban/metadata` | Fetch filter candidates and board status metadata |
| `PATCH` | `/projects/:project_id/kanban/issues/:id/move` | Move card across statuses or swimlanes |
| `POST` | `/projects/:project_id/kanban/issues` | Create new issue |
| `POST` | `/projects/:project_id/kanban/issues/bulk` | Bulk create subtasks (up to 50 subtasks) |
| `PATCH` | `/projects/:project_id/kanban/issues/:id` | Update issue attributes |
| `DELETE` | `/projects/:project_id/kanban/issues/:id` | Physically delete issue |
| `GET` | `/projects/:project_id/kanban/issues/entities?ids[]=` | Targeted reconciliation of specific issue entities |
