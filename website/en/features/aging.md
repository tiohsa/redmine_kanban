# Aging Detection

**Aging Detection** highlights issues that have not been updated for a set number of days.

Use it to spot stalled work.

## How Aging Works

Aging is calculated by comparing each issue's `updated_on` timestamp against the current time:

- **Warning Threshold**: After the warning period (e.g., 3 days), the card shows a warning badge and tinted border.
- **Danger Threshold**: After the danger period (e.g., 7 days), the card uses an alert color.
- **Elapsed Badge**: The top-right corner of the card indicates the number of days elapsed since the last modification.

![Aging detection highlighting an inactive issue with an alert tint.](/images/aging-en.png)

[Enlarge image](/images/aging-en.png)

## Customizing Aging Thresholds

Thresholds are configured in **Display Settings** from the board toolbar:

- **Warning Days**: Number of days before warning highlights appear.
- **Danger Days**: Number of days before danger highlights appear.

> [!NOTE]
> **Per-User Local Storage**
> - Aging preferences are saved in your browser's `localStorage` and shared across projects.
> - Setting a threshold to `0` disables that level of aging detection. Saved `0` values persist across page reloads.

## Closed Issues Exclusion

Issues in closed statuses are automatically excluded from aging detection.
