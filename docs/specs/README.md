# Redmine Kanban 機能別正本仕様書（Canonical Specifications）

本ディレクトリ（`docs/specs/`）は、`redmine_kanban` プラグインにおける**機能ごとの最新の正本仕様書**を管理する場所です。
各仕様書は `spec-author-v2` テンプレート（Goal / Non-goals / Acceptance Criteria / Public API & DB Schema / Constraints / Required Tests）に準拠し、リポジトリの現行実装およびテストと常に一致させて運用します。

## 機能別仕様書一覧

| 機能領域 | 仕様書 | 主な対象 |
| --- | --- | --- |
| ボードスナップショット・API v3・鮮度管理 | [board-snapshot-and-api.md](board-snapshot-and-api.md) | `ApiController`（取得系）、`BoardData`、`SnapshotLimits`、`PermissionPolicy`、`asyncFreshness` |
| Canvas描画・スイムレーン・D&D・ソート | [board-rendering-and-dnd.md](board-rendering-and-dnd.md) | `CanvasBoard`、`canvasInteraction`、`dragInteraction`、`IssueMover`、`sort` |
| チケット作成・更新・一括サブタスク・親子階層 | [issue-mutations-and-hierarchy.md](issue-mutations-and-hierarchy.md) | `IssueCreator`、`IssueUpdater`、`BulkIdempotency`、`AncestorIssueUpdates`、`BoardMembershipResolver` |
| チケット削除・削除済みチケットの再作成 | [issue-deletion-and-recreate.md](issue-deletion-and-recreate.md) | `IssueDestroyer`、物理削除とスコープ外追放の区別、再作成（Recreate） |
| チケットダイアログ（iframe）・ネイティブ操作同期 | [issue-dialog-and-native-sync.md](issue-dialog-and-native-sync.md) | `KanbanIssueModal`、`IframeEditDialog`、`saveFlow`、`RedirectsController#gantt` |
| フィルタ・検索・URLクエリ・保存ビュー | [filters-and-saved-views.md](filters-and-saved-views.md) | `BoardIssueFilter`、`boardQuery`、`savedViews`、`savedViewsRepository` |
| 表示設定・WIP制限・エイジング可視化 | [display-settings-and-aging.md](display-settings-and-aging.md) | `preferences`、`preferencesRepository`、`useKanbanPreferences`、`DisplaySettingsPopover` |
| 作業時間タイマー・Time Entry 連携 | [work-timer-and-time-entries.md](work-timer-and-time-entries.md) | `WorkTimer`、`timerDomain`、`timerStorage`、`timeEntryOperation` |

## 運用ルール

1. **正本の原則**: 仕様と実装に差異がある場合は、コード・テストの意図を確認した上で本仕様書または実装のどちらを更新すべきか判断し、不整合を残さないこと。
2. **変更時の同時更新**: 機能の追加・仕様変更・API契約変更・制限値変更を行った場合は、同一作業内で該当する `docs/specs/*.md` を更新すること。
3. **アーキテクチャ・不変条件との関係**: モジュール境界や依存方向は [ARCHITECTURE.md](../../ARCHITECTURE.md)、不変条件・作業手順は [AGENTS.md](../../AGENTS.md) を正本とする。
