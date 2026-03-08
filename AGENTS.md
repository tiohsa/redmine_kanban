# AGENTS.md — Redmine Kanban Plugin

## Project Overview

Redmine plugin that provides a Kanban board with WIP limits, aging detection, and drag-and-drop.

- **Backend**: Ruby on Rails (Redmine plugin convention)
- **Frontend**: React 18 + TypeScript + Vite (compiled to `assets/`)
- **E2E**: Playwright
- **Container**: Docker Compose

### Directory Structure

```
redmine_kanban/
├── init.rb                 # Plugin registration
├── app/
│   ├── controllers/        # Rails controllers (redmine_kanban namespace)
│   └── views/              # ERB templates
├── lib/
│   └── redmine_kanban/     # Service classes, helpers
├── frontend/               # React/TypeScript source
│   ├── src/
│   │   ├── main.tsx
│   │   └── ui/             # React components
│   ├── package.json
│   └── vite.config.ts
├── test/
│   ├── unit/               # Ruby unit tests
│   └── functional/         # Ruby functional tests
├── e2e/
│   ├── tests/              # Playwright specs
│   ├── playwright.config.js
│   └── setup_redmine.rb    # Seed data for E2E
└── .github/
    └── workflows/
        └── e2e-kanban.yml  # CI workflow
```

---

## Dev Environment Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ / pnpm

### Start Redmine (Docker Compose)

```bash
# From the repository root (two levels above this plugin)
docker compose up -d
```

Redmine is available at `http://localhost:3002` (login: `admin` / `admin`).

---

## Build Commands

### Frontend

```bash
cd frontend
pnpm install
pnpm run build
```

Build output:
- JS  → `assets/javascripts/redmine_kanban_spa.js`
- CSS → `assets/stylesheets/redmine_kanban_spa.css`

After rebuilding, restart Redmine:

```bash
# From repo root
docker compose restart redmine
```

### Watch mode (during development)

```bash
cd frontend
pnpm run build:watch
```

---

## Testing Instructions

### Frontend unit tests

```bash
cd frontend
pnpm run test -- --run       # single run
pnpm run test                # watch mode
```

### Type checking

```bash
cd frontend
pnpm run typecheck
```

### Backend (Ruby) unit/functional tests

```bash
# Requires Redmine running in Docker
docker compose exec redmine bundle exec rails test plugins/redmine_kanban/test
```

### E2E (Playwright) — local

```bash
# 1. Install E2E dependencies
npm install --prefix e2e
npx --prefix e2e playwright install chromium

# 2. Start Redmine stack
docker compose -f .github/e2e/docker-compose.yml up -d

# 3. Initialize Redmine (first run only)
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  bundle exec rake db:migrate redmine:plugins:migrate RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  env REDMINE_LANG=en bundle exec rake redmine:load_default_data RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  bundle exec rails runner -e production plugins/redmine_kanban/e2e/setup_redmine.rb

# 4. Run E2E
REDMINE_BASE_URL=http://127.0.0.1:3002 \
  npx --prefix e2e playwright test -c e2e/playwright.config.js
```

---

## Code Style

### Frontend (TypeScript/React)

- Language: TypeScript (strict mode via `tsconfig.json`)
- Components: React functional components with hooks
- Run type check before committing: `pnpm run typecheck`
- No dedicated linter config — follow existing code conventions

### Backend (Ruby)

- Follow Redmine plugin conventions
- Namespace all controllers/models under `RedmineKanban` module
- Controller files live in `app/controllers/redmine_kanban/`

---

## Architecture Notes

### Frontend Build Pipeline

`frontend/src/main.tsx` is the entry point. Vite compiles it as a UMD library:

```
frontend/src/main.tsx → assets/javascripts/redmine_kanban_spa.js
```

The `process.env` is replaced at build time for production. In test mode, no substitution is performed.

### Backend API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET    | `/projects/:id/kanban/data` | Board data |
| PATCH  | `/projects/:id/kanban/issues/:id/move` | Move card |
| POST   | `/projects/:id/kanban/issues` | Create ticket |
| PATCH  | `/projects/:id/kanban/issues/:id` | Update ticket |
| DELETE | `/projects/:id/kanban/issues/:id` | Delete ticket |

### Permissions

Defined in `init.rb`:

- `view_redmine_kanban` — read-only access (kanban#show, api#index, ai_analysis#analyze)
- `manage_redmine_kanban` — write access (api#move, api#create)

---

## CI

GitHub Actions: `.github/workflows/e2e-kanban.yml`

Triggered on push/PR to `main`/`master`.

Steps:
1. Frontend unit tests (`npm --prefix frontend run test -- --run`)
2. Start Redmine via Docker Compose
3. Migrate DB and load default data
4. Seed E2E data (`e2e/setup_redmine.rb`)
5. Run Playwright smoke tests

---

## Common Pitfalls

- **Always run `pnpm run build` after editing frontend code** and restart Redmine before verifying changes in the browser.
- **`User#name` requires full attributes** — avoid `.select(:id, :firstname, :lastname)` on User queries; load the full object instead (see known bug with `ActiveModel::MissingAttributeError`).
- **pnpm is preferred** but `npm` also works (both `package-lock.json` and `pnpm-lock.yaml` are committed).
