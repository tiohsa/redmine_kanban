# AGENTS.md — Redmine Kanban Plugin

## Project Overview

A Redmine plugin that adds a Kanban board with WIP limits, aging visualization, and drag-and-drop support.

* Backend: Ruby on Rails following Redmine plugin conventions
* Frontend: React 18, TypeScript strict mode, Vite, Vitest
* E2E: Playwright (Chromium)
* Compatibility targets: Redmine 7.0 / 6.1, with a Redmine 6.0 compatibility smoke test
* Runtime environment: Docker Compose, Node.js 20+

## Structure and Editing Boundaries

* `init.rb`: Plugin registration, permissions, and project menu.
* `config/routes.rb`: Routing for the Kanban UI and JSON API.
* `app/controllers/redmine_kanban/`: Rails entry points. Keep controllers thin and place business logic under `lib/redmine_kanban/`.
* `app/views/redmine_kanban/`: ERB views on the Redmine side.
* `lib/redmine_kanban/`: Service layer for board snapshots, permissions, Issue mutations, DTOs, and related logic. Everything must live under the `RedmineKanban` namespace.
* `frontend/src/main.tsx`: SPA entry point.
* `frontend/src/ui/`: React UI, normalized board state, queries/mutations, and dialogs.
* `frontend/src/ui/board/`: Canvas board, drag state machine, geometry calculations, and rendering helpers.
* `frontend/src/ui/hooks/`: Independent mutation hooks.
* `frontend/src/ui/styles.css`: SPA styles.
* `test/unit/`, `test/functional/`: Rails Minitest. These are not RSpec tests.
* `e2e/tests/`: Playwright scenarios. `e2e/setup_redmine.rb` creates fixtures.
* `script/ci/`: Wrappers for running the same validations as CI locally. Prefer these over duplicating raw commands whenever possible.
* `assets/`: Tracked Vite-generated artifacts. Do not edit them directly. Modify the source under `frontend/`, build it, and include the generated JS/CSS/fonts in the same change.

## Setup and Development

The Redmine application root is two directory levels above this directory. The normal local stack is started from there.

```bash
docker compose up -d
```

Redmine is available at `http://localhost:3002`. The development login is `admin` / `admin`.

Initialize and build the frontend:

```bash
cd frontend
pnpm install
pnpm run build
```

CI uses `npm ci` and `package-lock.json`. Even when using pnpm, do not unintentionally leave multiple lockfiles inconsistent when changing dependencies.

Use the following for watch mode / the development server:

```bash
cd frontend
pnpm run build:watch
pnpm run dev
```

After building the frontend, run `docker compose restart redmine` from the Redmine root before verifying the change in a real browser.

## Validation Commands

Standard validation for frontend changes:

```bash
bash script/ci/frontend-static.sh all
```

Individual arguments can be `build`, `lint`, `typecheck`, or `test`.

When running them directly, use commands equivalent to:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test -- --run
npm --prefix frontend run build
```

To narrow tests, use:

```bash
npm --prefix frontend run test -- --run <path-or-pattern>
```

When changing UI behavior, also add or update the colocated `*.test.ts` / `*.test.tsx` tests. When changing Canvas drag/drop behavior, also update the state-machine tests under `frontend/src/ui/board/`.

Run the complete Ruby test suite from the Redmine application root, inside the Redmine container. This plugin does not have its own standalone `Gemfile`.

```bash
docker compose up -d --wait
docker compose exec -T redmine bundle config unset without
docker compose exec -T redmine bundle install --jobs 4 --retry 3
docker compose exec -T redmine bundle exec rails test plugins/redmine_kanban/test
```

After recreating the container, prepare the test dependencies again.

Within CI containers, use `script/ci/ruby-full.sh`. Use `script/ci/snapshot-contract.sh` for snapshot resource-contract validation.

Changes affecting membership handling or SQL dialect behavior must also run the PostgreSQL validations defined by `.github/e2e/docker-compose.postgres.yml` and `script/ci/postgres-*.sh`.

Basic E2E procedure:

```bash
npm ci --prefix e2e
npx --prefix e2e playwright install chromium
docker compose -f .github/e2e/docker-compose.yml up -d --wait --wait-timeout 600
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  bundle exec rake db:migrate redmine:plugins:migrate RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  env REDMINE_LANG=en bundle exec rake redmine:load_default_data RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T --user redmine redmine \
  bundle exec rails runner -e production plugins/redmine_kanban/e2e/setup_redmine.rb
REDMINE_BASE_URL=http://127.0.0.1:3002 \
  bash script/ci/e2e-full.sh
```

Purpose-specific wrappers:

* `script/ci/native-mutation-e2e.sh`: Mutation lifecycle including the native iframe.
* `script/ci/large-data-e2e.sh`: Large-data gate using the 1,505-child fixture. Seed it first with `REDMINE_KANBAN_E2E_TREE_FIXTURE=1`.
* `script/ci/compatibility-smoke.sh`: Redmine 6.0 compatibility smoke test.

If any validation cannot be run, explicitly state the unexecuted command and the reason in the final report.

## Coding Conventions

### TypeScript / React

* Preserve strict mode in `frontend/tsconfig.json`.
* Use React functional components and hooks, and reuse existing query/mutation/state helpers.
* Do not bypass asynchronous response freshness, scope fingerprints, or normalized snapshot application ordering with custom local state.
* Drag/drop lifecycle handling must pass through the state-machine boundary under `frontend/src/ui/board/`.
* The ESLint flat configuration is `frontend/eslint.config.js`. Before adding a new suppression, check whether the issue can instead be resolved through proper typing or control flow.

### Ruby / Rails

* Place controllers and services under the `RedmineKanban` namespace, and use Redmine's permission / visibility / workflow APIs.
* Normalize API params using the existing `BoardContext`, `ParamNormalizer`, and `ArrayParamNormalizer`.
* Do not partially select `User` records in queries that later call `User#name`. Missing attributes such as `firstname` can cause `ActiveModel::MissingAttributeError`; load complete objects instead.
* In mutations, capture status / done-ratio changes immediately after saving. Do not infer them after a reload triggered by priority propagation.
* API contract changes must include corresponding functional tests and frontend type/state tests in the same change.

## Board Snapshot Contract

* The current API contract version is 3. `BoardData` and mutation serializers must use the same `BoardContext`.
* `meta.project_ids`, `scope_status_ids`, `dependency_status_ids`, and `scope_fingerprint` are part of the authorization, membership, and asynchronous-response freshness contract and must be propagated into mutation / reconciliation queries.
* `/data` returns a complete flat snapshot in `entities`, together with the relationships in `tree.root_ids` / `tree.children_by_parent_id`. `meta.complete` is `true`. The frontend must normalize this representation and must not treat recursive Issue copies as the source of truth.
* The default requested limit is 1,500 entities, the server maximum is 5,000, the response maximum is 8 MiB, and the snapshot query limit is 20. Environment variables are `REDMINE_KANBAN_MAX_BOARD_ENTITIES`, `REDMINE_KANBAN_MAX_RESPONSE_BYTES`, and `REDMINE_KANBAN_MAX_BOARD_QUERIES`.
* If the scope exceeds the entity limit, do not return a partial snapshot; return `BOARD_SCOPE_TOO_LARGE`. Exceeding the query limit must return the structured error `BOARD_QUERY_LIMIT_EXCEEDED`, and exceeding the response-byte limit must return `BOARD_RESPONSE_TOO_LARGE`.
* Mutation responses are flat deltas: `issue_updates`, `created_issues`, `deleted_issue_ids`, `evicted_issue_ids`, `tree_changes`, `column_counts`, and targeted `invalidations`. Do not refetch the entire board after a normal successful mutation.
* If scope or response limits are exceeded after a mutation, do not roll back the domain update. Return `invalidations.board_snapshot: true`. The frontend must discard the stale complete snapshot and refetch it.
* Bulk create supports at most 50 non-empty subtasks. A 51st subtask must produce a 422 response before any idempotency claim or transaction is started.
* Recreate-after-delete applies only to domain-level top-level Issues (`parent_id` absent). Copy editable fields currently shown in the UI, including `done_ratio`, but do not copy the original ID, history, comments, attachments, relations, or watchers.
* With `REDMINE_KANBAN_PERF_LOG=1`, SQL count, entity / row counts, JSON bytes, and elapsed time can be recorded. Use `script/benchmark_tree.rb` to measure snapshot resource metrics.

## API and Permissions

Current endpoints in `config/routes.rb`:

| Method | Path                                           | Purpose                          |
| ------ | ---------------------------------------------- | -------------------------------- |
| GET    | `/projects/:project_id/kanban/data`            | Complete board snapshot          |
| GET    | `/projects/:project_id/kanban/bootstrap`       | Initial-display metadata         |
| GET    | `/projects/:project_id/kanban/issues/entities` | Issue entity reconciliation      |
| GET    | `/projects/:project_id/kanban/counts`          | Column-count reconciliation      |
| GET    | `/projects/:project_id/kanban/trackers`        | Tracker metadata                 |
| PATCH  | `/projects/:project_id/kanban/issues/:id/move` | Move a card                      |
| PATCH  | `/projects/:project_id/kanban/issues/:id`      | Update an Issue                  |
| DELETE | `/projects/:project_id/kanban/issues/:id`      | Delete an Issue                  |
| POST   | `/projects/:project_id/kanban/issues`          | Create an Issue                  |
| POST   | `/projects/:project_id/kanban/issues/bulk`     | Bulk-create a parent/subtask set |

Permission boundaries in `init.rb`:

* `view_redmine_kanban`: Read access to the UI, snapshot, bootstrap, entities, counts, trackers, and related resources.
* `manage_redmine_kanban`: `move` / `create` / `update` / `destroy` / `bulk_create`.

When adding or changing an endpoint, verify consistency across `config/routes.rb`, `init.rb`, the controller action, functional tests, and the frontend URL builder.

## CI and Compatibility

`.github/workflows/e2e-kanban.yml` validates the following on pushes to `main` / `master` and on pull requests:

* Frontend build / ESLint / typecheck / Vitest
* Redmine 7.0 Ruby unit/API tests and snapshot resource gate
* PostgreSQL membership integration in addition to MariaDB
* Full E2E on Redmine 7.0 / 6.1
* Large snapshot resource gate on Redmine 7.0
* Redmine 6.0 compatibility smoke test

When introducing APIs specific to Redmine, Rails, or a DB adapter, do not break this compatibility matrix.

## Agent Working Rules

* Before editing, read the relevant files and existing tests, and preserve the user's uncommitted changes.
* Keep changes within the requested scope. Obtain confirmation before making broad refactors, dependency upgrades, DB migrations, API-breaking changes, changes involving secrets, or deploy/network operations.
* Whenever frontend source is changed, always build it and update the tracked `assets/`. Never manually edit generated artifacts only.
* When behavior changes, add or update focused tests at the same layer. Snapshot/mutation contract changes must be validated on both the backend and frontend.
* After making changes, inspect `git diff` to ensure that unintended lockfile changes, generated artifacts, or user changes have not been mixed in.
* In the final report, briefly list changed files, key decisions, validations performed, and validations not performed.

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

* In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
* For debugging, use raw command without rtk prefix
* `rtk proxy <cmd>` runs command without filtering but tracks usage

<!-- /headroom:rtk-instructions -->