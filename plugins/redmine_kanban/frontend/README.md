# redmine_kanban frontend

Redmine の `plugin_assets` として配布するための SPA（React + TypeScript + Vite）です。

## ビルド

```bash
cd plugins/redmine_kanban/frontend
npm ci
npm run build
```

出力先は以下です（Redmine がそのまま配信します）。

- `plugins/redmine_kanban/assets/javascripts/redmine_kanban_spa.js`
- `plugins/redmine_kanban/assets/stylesheets/redmine_kanban_spa.css`

