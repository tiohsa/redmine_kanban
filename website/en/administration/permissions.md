# Permissions

Redmine Kanban follows Redmine's roles, permissions, and workflows.

## Enabling the Project Module

To use Redmine Kanban within a project, enable its module in the project settings:

1. Navigate to your project, open **Settings** → **Modules**.
2. Check the **Kanban** checkbox and save.

---

## Plugin Roles and Permissions

Under Redmine's **Administration** → **Roles and permissions**, the **Kanban** section defines two dedicated permissions:

| Permission | Access Level | Permitted Operations |
| --- | --- | --- |
| **View Redmine Kanban** (`view_redmine_kanban`) | Read-only | View board, fetch board snapshot data and filter metadata, run AI analysis |
| **Manage Redmine Kanban** (`manage_redmine_kanban`) | Management / Write | Move cards with drag & drop, create, update, and delete issues, bulk create subtasks |

![Redmine roles and permissions configuration displaying the Kanban section with view and manage permissions.](/images/permissions-en.png)

[Enlarge image](/images/permissions-en.png)

---

## Integration with Standard Redmine Permissions

Board operations honor Redmine's core permission model:

### 1. Workflow Status Transitions
- A card move must be allowed for the user's role and the issue's tracker in **Administration** → **Workflow**.
- If disallowed by workflow rules, the server rejects the update, and the card returns to its source column.

### 2. Issue Editing and Creation
- Dragging cards or creating subtasks requires Redmine's native `Edit issues` or `Add issues` permissions in addition to the plugin's `manage_redmine_kanban` permission.

### 3. Time Logging
- Submitting recorded hours via the work timer requires Redmine's standard `Log time` permission.

> [!IMPORTANT]
> **Client Cues are Usability Controls**
> Drop previews and symbols (`✓`) are guides. The server checks permissions and workflow rules on every request.
