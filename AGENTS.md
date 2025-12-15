# Repository Guidelines

日本語で回答する。

## Project Structure & Module Organization
- Root contains `docker-compose.yml` for the Redmine dev stack and `SETUP.md` with environment bootstrap steps.
- Custom code lives in `plugins/`; the current plugin is `plugins/redmine_kanban` (Ruby backend + assets). Docker mounts this directory into `/usr/src/redmine/plugins`.
- The Kanban UI is a separate SPA under `plugins/redmine_kanban/frontend` (React + TypeScript + Vite). Build outputs are written into `plugins/redmine_kanban/assets/` as `plugin_assets`.
- Add themes under `themes/`; everything inside is mounted to `/usr/src/redmine/public/themes` for live preview.

## Build, Test, and Development Commands
- Start or rebuild the stack: `docker compose up -d` (default port `http://localhost:3002`). Stop/clean: `docker compose down`.
- Restart Redmine after plugin changes: `docker compose restart redmine`.
- Open a shell in the app container: `docker compose exec redmine bash`.
- Generate a plugin scaffold: `docker compose exec redmine bundle exec rails generate redmine_plugin my_new_plugin`.
- Build Kanban SPA assets:
  - `cd plugins/redmine_kanban/frontend && npm install && npm run build`
  - then `docker compose restart redmine`

## Coding Style & Naming Conventions
- Ruby files: 2-space indentation, `snake_case` filenames, `CamelCase` classes/modules, and single quotes unless interpolation is needed. Keep plugin identifiers lowercase with underscores (e.g., `my_gantt_plugin`).
- Keep routes lean; prefer controllers/models inside the plugin namespace to avoid conflicts.
- Favor small, focused methods and add brief comments only where intent is non-obvious.

## Testing Guidelines
- Use Minitest (Redmine default). Place tests under `plugins/<plugin_name>/test` with filenames ending in `_test.rb`.
- Run plugin tests: `docker compose exec redmine bundle exec rails test plugins/redmine_kanban/test`.
- Add fixtures and regression tests for bugs; keep tests independent so they can run in any order.

## Commit & Pull Request Guidelines
- Commit style follows Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`). Use present tense and concise scopes (e.g., `feat: add gantt toolbar actions`).
- PRs should include: a short summary, linked Redmine issue (if any), test results/commands run, and screenshots for UI-affecting changes.
- Keep changes focused; update `SETUP.md` or in-file comments when altering setup steps or container behavior.
