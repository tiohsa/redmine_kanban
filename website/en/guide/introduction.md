# Introduction

Redmine Kanban is a plugin for managing Redmine issues on a Kanban board.

## Overview

Large issue counts and nested subtasks increase the work needed to render a board.

Redmine Kanban uses HTML5 Canvas to reduce rendering overhead.

![Redmine Kanban board overview on Redmine 7.0 showing status columns and task cards.](/images/kanban-overview-en.png)

[Enlarge image](/images/kanban-overview-en.png)

## Key Features

- **Canvas Rendering**: Supports smooth scrolling and card interactions.
- **Aging Detection**: Visual cues highlight stalled issues that have not been updated for days, exposing bottlenecks early.
- **Flexible Swimlanes**: Group cards horizontally by assignee, priority, category, or disable lanes for a classic column board.
- **Workflow-Aware Drag & Drop**: Card movements strictly adhere to Redmine's workflow definitions and permission rules.
- **Recursive Subtasks**: View subtasks nested inside parent cards or as individual cards, toggle status inline, and create subtasks in bulk.
- **Saved Views**: Store combinations of filters, sorting, and swimlane choices in browser storage for instant recall.
- **Integrated Work Timer**: Track work on an issue and save it as a Redmine Time Entry.
- **Rich Display Preferences**: Adjust font size, fit-to-screen mode, and ticket dialog dimensions (width, height, fullscreen).

## Supported Environments

| Item | Requirement |
| --- | --- |
| Redmine Versions | Redmine 6.0, 6.1, and 7.0 series |
| Ruby Versions | Official Ruby versions supported by your Redmine release (Ruby 3.1+ recommended) |
| Database | PostgreSQL, MySQL / MariaDB (standard Redmine databases) |
| Web Browsers | Latest versions of Google Chrome, Mozilla Firefox, Microsoft Edge, and Apple Safari |

## Architectural Principles

Three mechanisms support performance and data integrity:

1. **Normalized API v3 Snapshot**: Issue data (`entities`) and hierarchy (`tree`) are transferred separately to avoid duplicate issue copies.
2. **Server Validation**: Redmine validates updates, status transitions, and permissions. Browser indicators provide guidance.
3. **Resource Limits**: Limits on issue counts, SQL queries, and response sizes protect the server.
