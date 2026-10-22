# APIとクエリ仕様

Redmine Kanban は、正規化された **API v3** でボードデータを送受信します。

## API v3 正規化スナップショット仕様

ボードデータ（`GET /projects/:project_id/kanban/data`）は、チケット情報と階層を分けた JSON で返します。

```json
{
  "version": 3,
  "scope_fingerprint": "a8f3...c91",
  "entities": {
    "101": { "id": 101, "subject": "チケットA", "status_id": 1, ... },
    "102": { "id": 102, "subject": "子チケットB", "status_id": 2, ... }
  },
  "tree": {
    "root_ids": [101],
    "children_by_parent_id": {
      "101": [102]
    }
  },
  "meta": {
    "complete": true
  }
}
```

### この構造のメリット
- **重複の排除**: 複数の場所から参照されるチケットでも `entities` 内には 1 件のみ格納され、メモリと転送量を節約します。
- **循環参照・階層の整合性**: 親子関係や祖先関係の再構築をクライアント側で決定論的に実行できます。
- **差分更新（Bounded Deltas）の高速適用**: カード移動や編集時には、変更のあったエンティティとツリー差分のみが返却され、クライアント側で即座にマージされます。

---

## サーバー側の安全上限（Safety Ceiling）

サーバーの過負荷を防ぐため、チケット数・クエリ数・レスポンスサイズに上限を設けています。

| 設定 / 制限項目 | デフォルト値 | 制限を超過した場合の動作 |
| --- | --- | --- |
| **最大エンティティ数** (`REDMINE_KANBAN_MAX_BOARD_ENTITIES`) | 10,000 件 | HTTP 422（構造化エラー）。中途半端な部分データは返却しません |
| **スナップショット SQL クエリ数** (`REDMINE_KANBAN_MAX_BOARD_QUERIES`) | 20 クエリ | HTTP 422 |
| **全体 SQL クエリ数** (`REDMINE_KANBAN_MAX_TOTAL_BOARD_QUERIES`) | 100 クエリ | HTTP 422 |
| **最大レスポンスサイズ** (`REDMINE_KANBAN_MAX_RESPONSE_BYTES`) | 8 MiB | HTTP 422 |

> [!IMPORTANT]
> **部分的なスナップショットは決して返却しません**
> 上限を超える場合は、不完全なボードを返さず HTTP 422 エラーにします。プロジェクトやフィルターで対象を絞り込んでください。

---

## 主要 API エンドポイント一覧

| メソッド | パス | 用途 |
| --- | --- | --- |
| `GET` | `/projects/:project_id/kanban/data` | ボードスナップショットデータの取得 |
| `GET` | `/projects/:project_id/kanban/metadata` | フィルター候補（担当者・トラッカー等）およびボード基礎情報の取得 |
| `PATCH` | `/projects/:project_id/kanban/issues/:id/move` | カードのドラッグ＆ドロップ移動（ステータス・レーン属性更新） |
| `POST` | `/projects/:project_id/kanban/issues` | 新規チケットの作成 |
| `POST` | `/projects/:project_id/kanban/issues/bulk` | 子チケットの一括作成（最大 50 件） |
| `PATCH` | `/projects/:project_id/kanban/issues/:id` | チケットの更新 |
| `DELETE` | `/projects/:project_id/kanban/issues/:id` | チケットの物理削除 |
| `GET` | `/projects/:project_id/kanban/issues/entities?ids[]=` | 指定したチケット ID 群の最新エンティティ差分取得 |
