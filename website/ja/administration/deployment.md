# 本番デプロイ

本番環境（Docker、Kubernetes、独立サーバー）向けの設定とデプロイ手順です。

## フロントエンドアセットの事前ビルド

デプロイ前にフロントエンドアセットをビルドしてください。

```bash
cd plugins/redmine_kanban/frontend
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

ビルドすると、`plugins/redmine_kanban/assets/` に JavaScript と CSS が生成されます。

> [!CAUTION]
> 生成された `assets/` を直接編集しないでください。`frontend/` のソースを修正し、再ビルドしてください。

---

## キャッシュストア（CacheStore）の推奨構成

子チケットの一括作成では、`Rails.cache` のロックと結果キャッシュで重複作成を防ぎます。

### 複数プロセス・複数コンテナ運用時の注意点

- `MemoryStore` はプロセスごとに独立しています。複数の Puma ワーカーや Redmine コンテナで、ロックを共有することはできません。
- **推奨**: 本番環境では、共有キャッシュストアとして **Redis** または **Memcached** を `config.cache_store` に設定してください。

```ruby
# config/environments/production.rb の設定例
config.cache_store = :redis_cache_store, {
  url: ENV['REDIS_URL'] || 'redis://redis:6379/0',
  expires_in: 90.minutes
}
```

共有キャッシュにより、プロセスやコンテナをまたぐ重複リクエストを制御できます。

---

## サブディレクトリ運用（Subpath Deployment）への対応

Redmine を `https://example.com/redmine/` のようなサブパスで運用できます。

- API の通信パスや画像アセットの読み込みは、Redmine のルート相対パスを自動的に考慮します。
- 保存ビューはサブパスごとに保存先が分かれ、同じドメインの別インスタンスと混在しません。
