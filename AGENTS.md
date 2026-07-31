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
docker compose -f .github/e2e/docker-compose.yml exec -T --user redmine redmine \
  bundle exec rails runner -e production plugins/redmine_kanban/e2e/setup_redmine.rb

# Optional: seed the 1,505-child truncation fixture used by the tree E2E.
docker compose -f .github/e2e/docker-compose.yml exec -T --user redmine redmine \
  env REDMINE_KANBAN_E2E_TREE_FIXTURE=1 bundle exec rails runner -e production plugins/redmine_kanban/e2e/setup_redmine.rb

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

### Board Context and Tree Contract

- `BoardData` and all mutation serializers use `BoardContext`; callers preserve the sanitized `meta.project_ids` scope in mutation query parameters.
- Recursive board responses serialize canonical roots only. A root already reachable from another root on the current page is represented once in `subtasks`.
- The complete response is bounded to 1,500 unique nodes. Optional `meta.tree` exposes `node_limit`, unique/serialized node counts, duplicate roots eliminated, loaded node/DB row counts, and `truncated_parent_ids` when a subtree is incomplete.
- A child is removed from the root list only when it is actually present in the serialized parent tree. Truncated or not-yet-loaded children remain reachable as roots. The frontend recovers a truncated parent with `/kanban/issues?tree_parent_id=<id>&offset=<direct-child-count>`; subtree pages use deterministic `lft`/`id` ordering and do not overwrite root pagination metadata.
- Set `REDMINE_KANBAN_PERF_LOG=1` to log SQL count, node counts, JSON bytes, and elapsed time for a board response.
- `script/benchmark_tree.rb` emits root/unique/serialized nodes, DB rows, SQL count, duplicate count, JSON bytes, elapsed time, node limit, and truncation for a seeded project.

### Mutation and Recreate Contract

- `IssueMover` and `IssueUpdater` capture status/done-ratio changes immediately after save, before Priority propagation can reload the record.
- Recreate-after-delete is only available for domain top-level Issues (`parent_id` absent), never based on Canvas card/subtask representation. It copies displayed editable fields including `done_ratio`, but not the original ID, history, comments, attachments, relations, or watchers.
- Bulk create accepts at most 50 non-empty subtasks server-side. A 51st valid row returns 422 before an idempotency claim or transaction starts.

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


<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands
```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps           rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list            rtk pnpm install        rtk npm run <script>
```

## Rules
- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage
<!-- /headroom:rtk-instructions -->
