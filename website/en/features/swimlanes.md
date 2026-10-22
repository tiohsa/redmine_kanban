# Swimlanes

Swimlanes divide the board into rows by attributes such as assignee or priority.

## Available Swimlane Types

Choose any of the following swimlane modes from the toolbar:

- **None**: A single-row classic Kanban board.
- **Assignee**: Groups issues by assigned user or group (including an Unassigned row).
- **Priority**: Groups issues by priority level (Low, Normal, High, Urgent, Immediate).
- **Category**: Groups issues by project issue categories (including a No Category row).

![Kanban board with Assignee swimlanes active, grouping issues horizontally by assigned user.](/images/swimlanes-en.png)

[Enlarge image](/images/swimlanes-en.png)

## Drag & Drop Behavior Across Swimlanes

Moving a card to another row has different effects depending on the lane type.

### Assignee & Priority Swimlanes

Moving a card into a different row updates the respective attribute:
- **Between Assignee Lanes**: Assigns the issue to the target lane's user or group.
- **Between Priority Lanes**: Changes the issue priority to match the target lane.
- Dropping into a different column simultaneously changes both status and lane attribute.

---

### Category Swimlane Strict Constraints

> [!CAUTION]
> **Category Drag & Drop Modification is Strictly Forbidden**
> **You cannot change issue categories by drag & drop**.

Specifically, the following transitions are forbidden:

1. **Category A to Category B**: Forbidden.
2. **Category to No-category**: Forbidden.
3. **No-category to Category**: Forbidden.

#### Board Behavior
- Moving cards over cells in different category rows will **never show an allowed highlight or drop preview**.
- Releasing the mouse **sends no update to the server**, and the card returns to its original position.
- **Status transitions within the same category lane remain permitted** (subject to standard Redmine workflow rules).

To change an issue's category, open the issue edit modal and update the category field explicitly.

---

## Collapsing and Expanding Lanes

Use the arrow on the left of a lane header to collapse or expand that row.
