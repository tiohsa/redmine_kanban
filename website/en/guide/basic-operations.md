# Basic Operations

Learn how to move cards and create, edit, delete, and recreate issues.

## Board Layout

The board consists of the following primary sections:

1. **Toolbar**:
   - Scope and filters: Project, Status, Tracker, Assignee, Due date, Priority, and Search.
   - Sorting and Swimlane selection.
   - Saved views management.
   - Display preferences (font size, fit mode, modal dialog dimensions).
   - "New issue" button and global work timer.
2. **Lane Headers**: Group rows by assignee, priority, or category when swimlanes are active.
3. **Status Column Headers**: Show statuses such as New, In Progress, and Resolved. Use the "+" button to create an issue with that status.
4. **Canvas Board Viewport**: Displays issue cards and supports scrolling.

## Moving Cards with Drag & Drop

Drag cards across status columns or swimlane rows to update issue attributes and status.

### Workflow Hints and Visual Guidance

When you drag a card past the movement threshold, target cells display visual guidance icons:

- **`✓` (Allowed)**: Transition is permitted under Redmine workflow rules for the issue's tracker and your role.
- **`!` (Warning / Advisory)**: Cache mismatch or advisory status; drop will be validated on the server.
- **`?` (Unknown)**: Status cannot be verified from local cache; server validation will decide.
- **No Highlight (Forbidden)**: Forbidden moves (such as moving across category swimlanes) cannot receive drops.

<video width="1400" height="710" controls preload="metadata" playsinline poster="/images/kanban-drag-poster-en.png" src="/videos/kanban-drag-en.mp4" style="width:100%;height:auto" aria-label="Card drag and drop status transition"></video>

> [!IMPORTANT]
> **Redmine Workflow is the Final Authority**
> Icons (`✓`, `!`, `?`) are guides. The server checks Redmine workflow rules and permissions. If it rejects a move, the card returns to its original cell.

### Dragging from Subtask Areas

Subtasks displayed inside parent cards can be dragged directly out of the parent card into another status column or swimlane.

---

## Creating Issues

You can create issues through several entry points:

1. **Toolbar "+ New Issue" Button**: Opens the creation modal for the active board project.
2. **Column Header "+" Button**: Opens the creation modal with that column's status preselected.
3. **Cell Context "+" Button**: Opens the creation modal with both the lane attribute and status preselected.

The dialog displays Redmine's standard issue form, including custom fields, watchers, and attachments.

---

## Editing Issues

Clicking any card opens the Redmine issue modal dialog. You can edit subject, description, assignee, done ratio, dates, and custom fields. Saving updates the board state automatically.

---

## Deleting and Recreating Issues

### Deletion

Issues can be deleted via the issue dialog or card actions. Deleting an issue removes it immediately from the board and updates parent/subtask relationships.

### Undo / Recreate Deleted Issue

Immediately after deleting a top-level issue, an undo notice allows recreating the issue.

> [!WARNING]
> **Recreation Rules**
> - Only **top-level issues** (issues without parents) can be recreated. Child subtasks cannot be recreated in isolation.
> - Recreation creates a **new issue** populated with the displayed fields (subject, description, status, assignee, tracker, priority, dates, and done ratio).
> - Original issue IDs, comments, history, attachments, relations, and watchers are not restored.

---

## Zoom and Display Adjustments

- **Fit Mode**: Fit all columns to the board width, or use fixed-width columns with horizontal scrolling.
- **Font Size**: Change text size across cards and headers between 11px and 16px (default: 13px).
