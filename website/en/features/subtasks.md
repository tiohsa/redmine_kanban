# Subtasks

Manage issue hierarchies, including children, grandchildren, and deeper subtasks, on the board.

## Subtask Display Modes

Switch between two subtask display modes via the display settings popover:

1. **Nested Inline (Inside Parent Cards)**:
   - Subtasks appear nested directly within the parent issue card.
   - View parent progress and child status together.
2. **Separate Cards**:
   - Subtasks are broken out as independent cards placed in their respective status columns.
   - Cards display parent badges and hierarchy paths to retain relational context.

## Direct Completion Toggling

Checkboxes next to nested subtasks let you complete child tasks directly from the board:

- **Optimistic UI Updates**: Checking a box immediately strikes through the subtask and updates parent progress visually while syncing to the server in the background.
- **Lock Version Protection**: Uses `lock_version` concurrency guards to prevent overwriting conflicting changes made by other team members.

---

## Bulk Subtask Creation

Create multiple subtasks under one parent in a single action.

### 50 Subtask Limit Rule

> [!IMPORTANT]
> **Maximum 50 Subtasks Per Bulk Request**
> Each request accepts **up to 50 non-empty subtasks**. Larger requests are rejected before the transaction starts. Split them into batches of 50 or fewer.

### Idempotency Guarantee

Bulk creation identifies repeated requests to prevent duplicates from retries or double clicks:

- Clients generate a unique `Idempotency-Key` for the operation.
- The server (`Rails.cache`) claims the key using a digest of user ID, project ID, operation, and canonical payload.
- In-flight duplicate requests are safely rejected, while identical completed requests return the cached response.

---

## Parent-Child State Synchronization

When child subtask statuses or done ratios change, Redmine automatically recalculates parent progress and status.

The board synchronizes the updated child and all affected ancestors.
