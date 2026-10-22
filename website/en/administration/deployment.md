# Deployment

Settings and deployment steps for production on Docker, Kubernetes, or standalone hosts.

## Precompiling Frontend Assets

Build frontend assets before deployment:

```bash
cd plugins/redmine_kanban/frontend
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

The compiled and minified production bundles will be written to `plugins/redmine_kanban/assets/`.

> [!CAUTION]
> Never manually edit files under `assets/`. Always edit source files in `frontend/` and rebuild.

---

## Recommended CacheStore Configuration

The bulk subtask creation feature relies on `Rails.cache` to enforce atomic request claiming and prevent duplicate records.

### Multi-Process and Clustered Environments

- `MemoryStore` is local to each process and is cleared on restart. Multiple Puma workers or Redmine containers cannot share its locks.
- **Recommendation**: Configure a shared, atomic cache store such as **Redis** or **Memcached** in `config/environments/production.rb`:

```ruby
config.cache_store = :redis_cache_store, {
  url: ENV['REDIS_URL'] || 'redis://redis:6379/0',
  expires_in: 90.minutes
}
```

A shared cache coordinates duplicate requests across processes and replicas.

---

## Subpath Deployments

Redmine Kanban supports subpaths such as `https://example.com/redmine/`:

- API and asset request paths automatically adapt to Redmine's relative URL root.
- Saved views use separate storage keys for each subpath, avoiding conflicts between instances on the same domain.
