# Troubleshooting

Solutions to common installation and usage problems.

## Common Issues and Solutions

### 1. "Resource Limit Exceeded" or HTTP 422 Error

**Symptom**: Opening the board displays a 422 error, and issues do not load.

**Cause**: The issue count exceeds the board limit: 10,000 by default, or the value of `REDMINE_KANBAN_MAX_BOARD_ENTITIES`.

**Solution**:
- Apply tighter filters on the toolbar (narrow down projects, statuses, trackers, or assignees).
- Server administrators can review `REDMINE_KANBAN_MAX_BOARD_ENTITIES` (configurable up to 10,000).

---

### 2. Card Rebounds to Original Column on Drop

**Symptom**: Immediately upon dropping a card, it jumps back to its original position.

**Causes**:
1. **Redmine Workflow Rules**: The target status transition is not permitted for the user's role and issue tracker under Redmine's **Administration** → **Workflow**.
2. **Category Swimlane Constraint**: Cards cannot move between different category rows.
3. **Insufficient Permissions**: The user lacks `Edit issues` or `Manage Redmine Kanban` permissions.

**Solutions**:
- Verify Redmine workflow permissions with your administrator.
- To reassign an issue's category, open the issue modal dialog and change the category field directly.

---

### 3. Blank Screen or Broken Styling

**Symptom**: Opening the Kanban tab shows a white page or unstyled buttons.

**Cause**: Frontend production assets were not compiled or need an update after pulling the latest code.

**Solution**:
Recompile the frontend assets and restart Redmine:

```bash
cd plugins/redmine_kanban/frontend
pnpm install
pnpm run build
touch ../../../tmp/restart.txt
```

---

### 4. Saved Views Missing on Another Machine

**Symptom**: Views saved on your work computer do not appear on a home laptop or different browser.

**Cause**: Saved views are stored in browser local storage (`localStorage`) rather than the server database.

**Solution**:
Saved views are specific to your browser profile. Create the desired view on the new browser or device.

---

### 5. Bulk Subtask Creation Fails

**Symptom**: Creating multiple subtasks in bulk returns an error.

**Causes**:
- **More than 50 Subtasks**: Bulk creation permits at most 50 non-empty subtasks per request.
- **Tracker Inactive**: The selected tracker is not enabled for the target project.

**Solution**:
Split large lists into batches of 50 or fewer, and verify that the tracker is enabled in the project settings.
