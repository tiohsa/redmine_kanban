# Redmine Kanban

A modern Kanban board plugin for Redmine built with React + Vite.
This plugin goes beyond simple "task visualization" by providing WIP limits, aging detection, drag & drop, and other features to improve team flow efficiency.

[日本語版はこちら](README.ja.md)

## Features

### Kanban Board (redmine_kanban)

* **Canvas-Based Rendering**: High-performance board rendering using HTML Canvas for smooth scrolling and large dataset handling
* **WIP Control**: Limit work-in-progress (WIP) per column or assignee to prevent multitasking inefficiency. Configurable behavior when limits are exceeded (block/warn)
* **Aging Detection**: Visually highlight tasks that haven't been updated for a long time to prevent oversight. Thresholds are configurable
* **Swimlanes**: Switch lanes by assignee, version, or parent issue for multi-perspective task management
* **Drag & Drop**: Intuitive card movement. Supports status transitions according to Redmine workflows
* **Advanced Filtering**: Filter tasks by assignee, due date, priority, blocked status, etc.
* **Direct Creation from Board**: Create new tickets from column headers or cells for immediate updates during standups
* **Subtask Display**: View parent task subtasks and toggle completion status
* **Undo Function**: Restore accidentally deleted tasks
* **Project Filter**: Filter by multiple projects and subprojects

![alt text](./images/kanban.png)

## Technology Stack

| Layer | Technology |
|-------|------------|
| Backend | Ruby on Rails (Redmine Plugin) |
| Frontend (Kanban) | React 18 + TypeScript + Vite + Canvas |
| Container | Docker Compose |
| Database | PostgreSQL (Redmine standard) |

## Installation & Startup

This repository provides a Docker Compose configuration for running the development environment (Redmine + DB + plugins).

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **Start containers**
   ```bash
   docker compose up -d
   ```
   The first startup will build Docker images, which may take a few minutes.

3. **Access Redmine**
   Open your browser and navigate to:
   * **URL**: [http://localhost:3002](http://localhost:3002)
   * **Default credentials**:
     * Login: `admin`
     * Password: `admin`

## Usage

1. After logging into Redmine, create a project.
2. Go to the project's "Settings" → "Modules" tab and check **Kanban** to enable it.
3. Click the "Kanban" tab added to the project menu to display the Kanban board.

### Configuration Options

Adjust the following settings in the plugin configuration screen:

* **Swimlane Type**: Assignee/Version/Parent Issue
* **Issue Display Limit**: Maximum number of tickets to display on the board
* **Hidden Statuses**: Select statuses to hide from the board
* **WIP Limit Mode**: Per column / Per column×lane
* **WIP Exceed Behavior**: Block / Warn only
* **Aging Thresholds**: Number of days for warning and danger levels
* **Status Auto-Update**: Rules for automatic status changes when moving cards

![alt text](./images/settings.png)

## Developer Information

### Project Structure

```
redmine_kanban/
├── docker-compose.yml        # Redmine development stack
├── README.md                 # This file (English)
├── README.ja.md              # Japanese README
├── AGENTS.md                 # Agent guidelines
├── requirement.md            # Detailed requirements
├── SETUP.md                  # Setup instructions
├── plugins/
│   ├── redmine_kanban/       # Kanban plugin
│   │   ├── init.rb           # Plugin registration
│   │   ├── config/
│   │   │   ├── routes.rb     # Routing
│   │   │   └── locales/      # i18n files (ja.yml, en.yml)
│   │   ├── app/
│   │   │   ├── controllers/  # Rails controllers
│   │   │   └── views/        # View templates
│   │   ├── lib/
│   │   │   └── redmine_kanban/
│   │   │       ├── board_data.rb    # Board data construction
│   │   │       ├── issue_mover.rb   # Card movement logic
│   │   │       ├── issue_creator.rb # Card creation logic
│   │   │       ├── issue_updater.rb # Card update logic
│   │   │       ├── wip_checker.rb   # WIP limit checking
│   │   │       └── settings.rb      # Settings management
│   │   ├── frontend/         # React source code
│   │   │   ├── src/
│   │   │   │   ├── main.tsx
│   │   │   │   └── ui/
│   │   │   │       ├── App.tsx             # Main component
│   │   │   │       ├── types.ts            # Type definitions
│   │   │   │       ├── http.ts             # API communication
│   │   │   │       ├── styles.css          # Styles
│   │   │   │       └── board/
│   │   │   │           └── CanvasBoard.tsx # Canvas-based board
│   │   │   ├── package.json
│   │   │   └── vite.config.ts
│   │   ├── assets/           # Build output
│   │   └── test/             # Test files
└── themes/                   # Custom themes
```

### Frontend Build

Frontend source code (SPA part) is located in `plugins/redmine_kanban/frontend`.
After making code changes, rebuild using:

```bash
# Navigate to frontend directory
cd plugins/redmine_kanban/frontend

# Install dependencies (first time only)
pnpm install

# Run build
pnpm run build
```

After building, restart the Redmine container to apply changes:

```bash
# Return to project root and run
docker compose restart redmine
```

### Running Tests

To run the plugin's backend (Ruby) tests:

```bash
docker compose exec redmine bundle exec rails test plugins/redmine_kanban/test
```

Frontend type checking:

```bash
cd plugins/redmine_kanban/frontend
pnpm run typecheck
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects/:project_id/kanban/data` | Get board data |
| PATCH | `/projects/:project_id/kanban/issues/:id/move` | Move card |
| POST | `/projects/:project_id/kanban/issues` | Create ticket |
| PATCH | `/projects/:project_id/kanban/issues/:id` | Update ticket |
| DELETE | `/projects/:project_id/kanban/issues/:id` | Delete ticket |
| POST | `/projects/:project_id/kanban/ai_analysis` | AI analysis |

## License

This project is licensed under the [MIT License](LICENSE.md).
