# インストールとセットアップ

Redmine Kanban の導入手順、フロントエンドのアセットビルド、プロジェクトでの有効化方法を説明します。

## 動作要件

- Redmine 6.0, 6.1, または 7.0
- Node.js 22 以上および `pnpm`（または `npm`）：フロントエンドのアセットビルドを行う場合に必要
- データベースマイグレーションは不要（本プラグインは Redmine 既存のテーブル構造のみを使用します）

## インストール手順

### 1. プラグインの配置

Redmine の `plugins/` 内に、`redmine_kanban` という名前でリポジトリを配置します。

```bash
cd /path/to/redmine/plugins
git clone https://github.com/tiohsa/redmine_kanban.git
```

> [!WARNING]
> ディレクトリ名は必ず `redmine_kanban` としてください。別の名前を指定すると Rails のプラグインロードに失敗します。

### 2. フロントエンドアセットのビルド

フロントエンドをビルドし、`assets/` に本番用ファイルを生成します。

```bash
cd /path/to/redmine/plugins/redmine_kanban/frontend
pnpm install
pnpm run typecheck
pnpm run build
```

※ `pnpm` を使用しない環境では、`npm ci` および `npm run build` も利用可能です。

### 3. Redmine の再起動

Redmine アプリケーションサーバー（Puma, Unicorn, Passenger 等）を再起動します。

```bash
touch /path/to/redmine/tmp/restart.txt
# または systemctl restart redmine 等
```

### 4. プロジェクトでのモジュール有効化

1. Redmine に管理者またはプロジェクト管理者アカウントでログインします。
2. カンバンを利用したいプロジェクトの **設定** → **モジュール** タブを開きます。
3. **Kanban** にチェックを入れて **保存** をクリックします。
4. プロジェクトメニューに **Kanban** タブが表示されます。

---

## Docker Compose によるクイックスタート

ローカルで試すには、リポジトリの Docker Compose を利用できます。

```bash
# リポジトリルートへ移動
cd /path/to/redmine_kanban

# コンテナの起動
docker compose -f .github/e2e/docker-compose.yml up -d

# 初期データとマイグレーションの実行
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  bundle exec rake db:migrate redmine:plugins:migrate RAILS_ENV=production
docker compose -f .github/e2e/docker-compose.yml exec -T redmine \
  env REDMINE_LANG=en bundle exec rake redmine:load_default_data RAILS_ENV=production

# 検証用初期データの投入
docker compose -f .github/e2e/docker-compose.yml exec -T --user redmine redmine \
  bundle exec rails runner -e production plugins/redmine_kanban/e2e/setup_redmine.rb
```

ブラウザーで `http://localhost:3002` にアクセスし、ログインします（初期ユーザー: `admin` / パスワード: `admin`）。

> [!CAUTION]
> **Docker 環境と初期アカウントのセキュリティ**
> 初期認証情報（`admin` / `admin`）とサンプル設定は、ローカルでの開発・評価専用です。本番環境やネットワークに公開する環境では、直ちに管理者パスワードを変更してください。データベース認証情報と `SECRET_KEY_BASE` も安全な値に設定します。

---

## プラグインの更新

プラグインを新しいバージョンに更新する手順：

```bash
cd /path/to/redmine/plugins/redmine_kanban
git pull origin main

# フロントエンドアセットの再ビルド
cd frontend
pnpm install
pnpm run build

# Redmine の再起動
touch ../../../tmp/restart.txt
```

## アンインストール

1. 各プロジェクトの設定で **Kanban** モジュールを無効化します。
2. `plugins/redmine_kanban` ディレクトリを削除します。
3. Redmine を再起動します。本プラグイン専用の DB テーブルは存在しないため、DB ロールバック作業は不要です。
