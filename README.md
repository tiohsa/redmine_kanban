# Redmine Kanban

Modern Kanban board plugin for Redmine, built with React + Vite.
It goes beyond simple task visualization with WIP limits, aging detection, and flow-focused controls.

[日本語版はこちら](README.ja.md) | [Setup](../../SETUP.md) | [Requirements](../../requirement.md)

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Screenshots](#screenshots)
- [Quick Start (Docker Compose)](#quick-start-docker-compose)
- [Install as a Redmine Plugin](#install-as-a-redmine-plugin)
- [Usage](#usage)
- [Configuration](#configuration)
- [Technology Stack](#technology-stack)
- [Development](#development)
- [Testing](#testing)
- [API Endpoints](#api-endpoints)
- [CI (E2E)](#ci-e2e)
- [License](#license)

## Overview

Redmine Kanban helps teams keep flow healthy and visible. It focuses on limiting WIP, exposing stalled work, and letting teams move issues quickly with minimal friction.

## Key Features

- **Canvas-Based Rendering**: High-performance board rendering using HTML Canvas for smooth scrolling and large dataset handling.
- **WIP Control**: Limit work-in-progress (WIP) per column or assignee. Configurable behavior on limit exceed (block or warn).
- **Aging Detection**: Highlight tasks that have not been updated for a long time. Thresholds are configurable.
- **Swimlanes**: Switch lanes by assignee, version, or parent issue.
- **Drag & Drop**: Intuitive card movement with Redmine workflow-aware status transitions.
- **Advanced Filtering**: Filter by assignee, due date, priority, blocked status, and more.
- **Direct Creation from Board**: Create new tickets from column headers or cells during standups.
- **Subtask Display**: View parent issue subtasks and toggle completion.
- **Undo Function**: Restore accidentally deleted tasks.
- **Project Filter**: Filter across projects and subprojects.

## Screenshots

![Kanban board](./images/kanban.png)
![Settings](./images/settings.png)

## Quick Start (Docker Compose)

If you cloned the full repository, use the Docker Compose environment from the repo root:

```bash
cd ../..
docker compose up -d
```

Access Redmine at [http://localhost:3002](http://localhost:3002) with:

- Login: `admin`
- Password: `admin`

## Install as a Redmine Plugin

Use these steps when you want to install the plugin into an existing Redmine instance:

1. Copy this plugin into your Redmine `plugins/` directory as `redmine_kanban`.
2. Restart Redmine.
3. In Redmine, enable the **Kanban** module for your project.

If you modify the frontend, build assets from `plugins/redmine_kanban/frontend` before restarting:

```bash
cd plugins/redmine_kanban/frontend
pnpm install
pnpm run typecheck
pnpm run build
```

## Usage

1. Create or open a project in Redmine.
2. Enable **Kanban** in Project Settings → Modules.
3. Open the **Kanban** tab from the project menu.

## Configuration

Adjust these options in the plugin configuration screen:

- **Swimlane Type**: Assignee / Version / Parent Issue
- **Issue Display Limit**: Max number of cards to display
- **Hidden Statuses**: Statuses to hide from the board
- **WIP Limit Mode**: Per column / Per column × lane
- **WIP Exceed Behavior**: Block / Warn only
- **Aging Thresholds**: Days for warning and danger levels
- **Status Auto-Update**: Rules for automatic status changes on card movement

## Technology Stack

| Layer | Technology |
| --- | --- |
| Backend | Ruby on Rails (Redmine plugin) |
| Frontend | React 18 + TypeScript + Vite + Canvas |
| Container | Docker Compose |
| Database | PostgreSQL (Redmine standard) |

## Development

Frontend source code is in `plugins/redmine_kanban/frontend`.

```bash
cd plugins/redmine_kanban/frontend
pnpm install
pnpm run test -- --run
pnpm run typecheck
pnpm run build
```

If your environment does not use `pnpm`, `npm ci` / `npm run ...` also works (`frontend/package-lock.json` is included).

Restart the Redmine container after rebuilding assets:

```bash
cd ../..
docker compose restart redmine
```

## Testing

Backend (Ruby) tests:

```bash
docker compose exec redmine bundle exec rails test plugins/redmine_kanban/test
```

Frontend unit tests / type checking:

```bash
cd plugins/redmine_kanban/frontend
pnpm run test -- --run
pnpm run typecheck
```

Playwright E2E (local):

```bash
npm install --prefix e2e
npx --prefix e2e playwright install chromium

# Start Redmine stack (from plugin root)
docker compose -f .github/e2e/docker-compose.yml up -d

# Initialize Redmine data (first run)
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  bundle exec rake db:migrate redmine:plugins:migrate RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  env REDMINE_LANG=en bundle exec rake redmine:load_default_data RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  bundle exec rails runner -e production plugins/redmine_kanban/e2e/setup_redmine.rb

# Run E2E
REDMINE_BASE_URL=http://127.0.0.1:3002 \
  npx --prefix e2e playwright test -c e2e/playwright.config.js
```

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/projects/:project_id/kanban/data` | Get board data |
| PATCH | `/projects/:project_id/kanban/issues/:id/move` | Move card |
| POST | `/projects/:project_id/kanban/issues` | Create ticket |
| PATCH | `/projects/:project_id/kanban/issues/:id` | Update ticket |
| DELETE | `/projects/:project_id/kanban/issues/:id` | Delete ticket |

Related UI route:

| Method | Path | Description |
| --- | --- | --- |
| GET | `/projects/:project_id/kanban` | Kanban board page |
| GET | `/projects/:project_id/gantt` | Redirect to Kanban page (plugin redirect) |

## CI (E2E)

GitHub Actions workflow: `.github/workflows/e2e-kanban.yml`

The CI job:

- installs E2E dependencies in `e2e/`
- starts Redmine using `.github/e2e/docker-compose.yml`
- runs migrations and loads default Redmine data
- seeds `ecookbook` + enables the Kanban module via `e2e/setup_redmine.rb`
- runs Playwright smoke tests (`e2e/tests/kanban-smoke.spec.js`)

## License

This project is licensed under the GNU General Public License v2.0 (GPLv2).
