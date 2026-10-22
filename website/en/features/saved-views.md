# Saved Views

Saved views let you preserve customized filter, sorting, and swimlane combinations and switch between them with a single click.

## Managing Saved Views

Use the toolbar's "Saved views" menu to:

- **Save New View**: Name and store the currently active board filters and sorting rules.
- **Apply View**: Load a saved view to apply all stored conditions immediately.
- **Overwrite View**: Update the active saved view with your current adjustments.
- **Rename View**: Change the title of an existing view.
- **Delete View**: Remove a saved view. Deleting a view keeps your currently loaded board filters intact.

![Saved views menu displaying list of stored views and management controls.](/images/saved-views-en.png)

[Enlarge image](/images/saved-views-en.png)

### The "Modified" Indicator

When you adjust any filter, sort, or swimlane after applying a saved view, a **Modified** badge appears next to the view name. The original saved view remains untouched until you explicitly choose "Overwrite".

---

## What is Saved vs. Excluded

Views save issue filters and ordering. They exclude personal layout and display settings.

| Saved in Views | Excluded (Personal Settings) |
| --- | --- |
| Selected projects and subproject scope | Font size (e.g. 13px) |
| Visible and hidden status columns | Fullscreen toggle |
| Tracker, Assignee, Due date, Priority filters | Fit mode (even fit vs. horizontal scroll) |
| Search terms | Card display mode (standard vs. compact) |
| Sort ordering and direction | Subtask nesting mode |
| Swimlane selection (Assignee, Priority, etc.) | Aging detection thresholds |
| Viewable projects toggle | Ticket dialog dimensions |
| | Work timer recording session |

---

## Storage Architecture

> [!NOTE]
> **Client-Side Local Storage**
> - Saved views are stored in your browser's `localStorage` rather than the Redmine database.
> - Views are separated by Redmine instance, project, and user. The key format is `rk_saved_views:<Redmine subpath>/projects/<project_id>/kanban:user:<user_id>`.
> - Each project scope supports up to 20 saved views.
> - View names must be unique within their scope and contain between 1 and 80 characters.
> - The last active view is restored when you return to the board. Its ID is saved in a separate key ending in `:active`.
