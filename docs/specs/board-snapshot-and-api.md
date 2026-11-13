# SPEC: ボードスナップショット取得・API v3・資源保護・鮮度管理

## 1. Goal（目的）
- Redmine の権限・ワークフロー・親子関係を正本とし、正規化された API v3 スナップショット（`entities`、`tree.root_ids`、`tree.children_by_parent_id`、`scope_fingerprint`、`meta.complete: true`）を単一のボード状態として提供する。
- エンティティ数・SQLクエリ数・応答バイト数の資源上限（`SnapshotLimits`）を強制し、不完全な部分スナップショットをサイレントに返さない。
- クライアント側の非同期応答の適用において、`scope_fingerprint`・リクエスト世代・リビジョンにより古い応答が最新状態を上書きしないようにする。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- レガシーページネーション（`offset` / `cursor` / `tree_parent_id` / `issue_limit`）の復活・サポート。
- 再帰的な Issue コピーを第二の正本としてクライアント状態に保持すること。
- ボード状態のための独自 DB マイグレーションや永続テーブルの追加。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（完全スナップショット取得）:** Given `view_redmine_kanban` 権限を持つユーザー, when `GET /projects/:project_id/kanban/data` または `bootstrap` を呼ぶ, then `ok: true`、`contract_version: 3`、`scope_fingerprint`、`meta.complete: true`、`entities`、`tree.root_ids`、`tree.children_by_parent_id` を含む完全な応答（HTTP 200）が返る。
- [ ] **Happy Path（差分・メタデータ取得）:** Given 有効なボードスコープ, when `GET /metadata`・`GET /issues/entities`・`GET /counts`・`GET /trackers` を呼ぶ, then 現在の権限とスコープに応じた JSON が返る。
- [ ] **Error / Boundary Case（レガシーページネーション拒否）:** Given `offset` / `cursor` / `tree_parent_id` / `issue_limit` のいずれかが指定されたリクエスト, when `data` または `bootstrap` を呼ぶ, then `error.code: "BOARD_PAGINATION_UNSUPPORTED"`（HTTP 400）を返す。
- [ ] **Error / Boundary Case（資源上限超過）:** Given スコープ内チケット数が `effective_entity_limit`（最大 `10,000`）を超える場合、または SQL クエリ数・応答バイト数（既定 `8 MiB`）が上限を超える場合, when スナップショットを生成する, then 部分応答は返さず `ok: false` と構造化エラーコード（`BOARD_SCOPE_TOO_LARGE` / `BOARD_QUERY_LIMIT_EXCEEDED` / `BOARD_TOTAL_QUERY_LIMIT_EXCEEDED` / `BOARD_RESPONSE_TOO_LARGE`）を返す。
- [ ] **Error / Boundary Case（不正な上限・フィルタ・ID列）:** Given 不正な `board_entity_limit`・不正フィルタ・上限（`MAX_ENTITY_RECONCILIATION_IDS = 100`）超過または不正な `ids`, when 各 API を呼ぶ, then `INVALID_BOARD_ENTITY_LIMIT` / `INVALID_BOARD_FILTER` / `ArrayParamNormalizer::InvalidIssueIds` に応じた HTTP 400 を返す。
- [ ] **Error / Boundary Case（権限制御）:** Given `view_redmine_kanban` 権限のないユーザー、または不可視プロジェクト, when API を呼ぶ, then HTTP 403（`metadata` の不可視プロジェクトは 404）を返す。
- [ ] **Backward Compatibility:** Redmine 6.0 / 6.1 / 7.0 で動作し、既存の `ApiControllerTest`・`SnapshotLimitsTest`・`boardSnapshot.test.ts` がすべてパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Endpoints（`config/routes.rb`）:**
  - `GET /projects/:project_id/kanban` (`redmine_kanban/kanban#show`)
  - `GET /projects/:project_id/kanban/data` (`redmine_kanban/api#index`)
  - `GET /projects/:project_id/kanban/bootstrap` (`redmine_kanban/api#bootstrap`)
  - `GET /projects/:project_id/kanban/metadata` (`redmine_kanban/api#metadata`)
  - `GET /projects/:project_id/kanban/issues/entities` (`redmine_kanban/api#entities`)
  - `GET /projects/:project_id/kanban/counts` (`redmine_kanban/api#counts`)
  - `GET /projects/:project_id/kanban/trackers` (`redmine_kanban/api#trackers`)
- **DB Schema:** 変更なし（Redmine 標準テーブルのみ参照）。

## 5. Constraints（制約事項）
- **Security:** すべての取得系アクションは `PermissionPolicy#can_view_board?`（`view_redmine_kanban`）および `Issue.visible(User.current)` / `Project.visible(User.current)` を強制する。`metadata` はプロジェクト名が HTML ナビゲーションに漏洩しないよう JSON エラー（404/403）を返す。`User` レコードは `ActiveModel::MissingAttributeError` を防ぐため部分 select を行わない。
- **Performance:** `SnapshotLimits` によるハード上限（`HARD_MAX_BOARD_ENTITIES = 10_000`、`DEFAULT_RESPONSE_BYTES = 8 * 1024 * 1024`、`DEFAULT_QUERY_LIMIT = 20`、`DEFAULT_TOTAL_QUERY_LIMIT = 100`、`MAX_ENTITY_RECONCILIATION_IDS = 100`）。`lists` と `labels` は `Rails.cache` で 60 秒キャッシュ。

## 6. Required Tests（必須テスト）
- **Unit:** `test/unit/snapshot_limits_test.rb`, `test/unit/board_data_test.rb`, `test/unit/board_tree_builder_test.rb`, `test/unit/board_membership_resolver_test.rb`, `test/unit/permission_policy_test.rb`, `frontend/src/infrastructure/api/boardSnapshot.test.ts`, `frontend/src/ui/asyncFreshness.repro.test.tsx`
- **Integration / E2E:** `test/functional/api_controller_test.rb`, `e2e/tests/kanban-snapshot.spec.js`, `e2e/tests/kanban-large-snapshot.spec.js`
- **Regression:** 既存の全 Rails Minitest および Vitest スイートがパスすること。
