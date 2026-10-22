# Installation and Setup

Install Redmine Kanban, build its assets, and enable it in your projects.

## Prerequisites

- Redmine 6.0, 6.1, or 7.0
- Node.js 22 or newer and `pnpm` (or `npm`): required for building the frontend bundle
- No database migrations are required (the plugin operates on existing Redmine schema without plugin-owned tables)

## Step-by-Step Installation

### 1. Clone the Plugin Repository

Clone the repository into your Redmine `plugins/` directory under the exact name `redmine_kanban`.

```bash
cd /path/to/redmine/plugins
git clone https://github.com/tiohsa/redmine_kanban.git
```

> [!WARNING]
> The directory name must be exactly `redmine_kanban`. Renaming it will cause plugin loading failures in Rails.

### 2. Build Frontend Assets

Build the frontend to generate production files in `assets/`:

```bash
cd /path/to/redmine/plugins/redmine_kanban/frontend
pnpm install
pnpm run typecheck
pnpm run build
```

*Note: If you do not use `pnpm`, `npm ci` and `npm run build` can also be used.*

### 3. Restart Redmine

Restart your application server (e.g., Puma, Unicorn, or Passenger):

```bash
touch /path/to/redmine/tmp/restart.txt
# or systemctl restart redmine
```

### 4. Enable the Kanban Module

1. Sign in to Redmine as an administrator or project manager.
2. Navigate to your project, open **Settings** → **Modules**.
3. Check the **Kanban** checkbox and click **Save**.
4. The **Kanban** tab will now appear in your project top navigation.

---

## Quick Start with Docker Compose

To quickly evaluate Redmine Kanban locally with preconfigured dependencies:

```bash
# Navigate to the plugin directory
cd /path/to/redmine_kanban

# Start containers
docker compose -f .github/e2e/docker-compose.yml up -d

# Initialize database schema and default data
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  bundle exec rake db:migrate redmine:plugins:migrate RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  env REDMINE_LANG=en bundle exec rake redmine:load_default_data RAILS_ENV=production

# Seed demonstration data
docker compose -f .github/e2e/docker-compose.yml exec -T --user redmine redmine \
  bundle exec rails runner -e production plugins/redmine_kanban/e2e/setup_redmine.rb
```

Access Redmine at `http://localhost:3002` (default credentials: `admin` / `admin`).

> [!CAUTION]
> **Security Notice for Default Credentials**
> The default credentials (`admin` / `admin`) and sample settings are for local testing only. For production or network-accessible deployments, immediately change the administrator password. Set secure database credentials and `SECRET_KEY_BASE`.

---

## Upgrading the Plugin

To update to a new release:

```bash
cd /path/to/redmine/plugins/redmine_kanban
git pull origin main

# Rebuild frontend bundles
cd frontend
pnpm install
pnpm run build

# Restart application
touch ../../../tmp/restart.txt
```

## Uninstallation

1. Disable the **Kanban** module in project settings.
2. Remove the `plugins/redmine_kanban` directory.
3. Restart Redmine. No database rollback is needed since no persistent plugin tables exist.
