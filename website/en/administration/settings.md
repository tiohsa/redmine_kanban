# System Settings

Display preferences are saved in browser local storage. Server resource limits are set through environment variables.

## Environment Variable Configuration

Set these variables when starting Redmine / Rails:

| Environment Variable | Default Value | Description |
| --- | --- | --- |
| `REDMINE_KANBAN_MAX_BOARD_ENTITIES` | `10000` | Safety ceiling for maximum unique issue entities admitted in a single board snapshot (e.g., set to `5000` to lower limit) |
| `REDMINE_KANBAN_MAX_BOARD_QUERIES` | `20` | Max SQL queries allowed for board snapshot resolution |
| `REDMINE_KANBAN_MAX_TOTAL_BOARD_QUERIES` | `100` | Max total SQL queries allowed during snapshot processing |
| `REDMINE_KANBAN_MAX_RESPONSE_BYTES` | `8388608` (8 MiB) | Max allowed byte length for JSON snapshot responses |
| `REDMINE_KANBAN_PERF_LOG` | `0` | Set to `1` to output detailed resource measurement metrics in the Rails log |

### Configuration Example

Set these variables in your systemd unit, Puma configuration, or `docker-compose.yml`:

```bash
# Example: Lower ceiling to 5,000 entities and enable performance logs
REDMINE_KANBAN_MAX_BOARD_ENTITIES=5000
REDMINE_KANBAN_PERF_LOG=1
```

> [!WARNING]
> **Ceiling Caps and Semantics**
> - Unset, blank, `0`, negative values, or values greater than `10000` are capped at `10,000`. The safety ceiling cannot be disabled.
> - The entity ceiling acts as a server protection boundary, not a client display performance guarantee.

---

## Why There is No Plugin Settings Page

You will not find a settings screen under Redmine's **Administration** → **Plugins**.

Users set swimlanes, hidden statuses, aging thresholds, fonts, and dialog sizes on the board. These preferences are saved in their browser.
