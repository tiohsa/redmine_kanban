# Redmine Kanban (SPA)

Redmineの運用を強化するための、React + Vite で構築されたモダンなカンバンボードプラグインです。
従来の「タスクの見える化」だけでなく、WIP（仕掛り）制限や停滞検知（Aging）などの機能を備え、チームのフロー効率を向上させることを目的としています。

## 特徴

* **WIP制御**: 列や担当者ごとの仕掛り数（WIP）を制限し、マルチタスクによる効率低下を防ぎます。
* **停滞検知 (Aging)**: 長期間更新されていないタスクを視覚的に強調し、見落としを防ぎます。
* **スイムレーン**: 担当者、バージョン、親チケットなどでレーンを切り替え、多角的な視点でタスクを管理できます。
* **Blocked表示**: 作業がブロックされている理由を明示し、解決を促します。
* **SPA (Single Page Application)**: Reactによる高速で直感的な操作性を実現しています。

## 必要要件

* Docker
* Docker Compose

## インストールと起動

このリポジトリは、開発環境（Redmine + DB + プラグイン）を Docker Compose で一括して立ち上げる構成になっています。

1. **リポジトリのクローン**
   ```bash
   git clone <repository-url>
   cd <repository-directory>
   ```

2. **コンテナの起動**
   ```bash
   docker compose up -d
   ```
   初回起動時は Docker イメージのビルドが行われるため、数分かかる場合があります。

3. **Redmine へのアクセス**
   ブラウザで以下の URL にアクセスしてください。
   * **URL**: [http://localhost:3002](http://localhost:3002)
   * **初期アカウント**:
     * ログインID: `admin`
     * パスワード: `admin`

## 利用方法

1. Redmine にログイン後、プロジェクトを作成します。
2. プロジェクトの「設定」→「モジュール」タブで、**Kanban** (または関連するプラグイン名) にチェックを入れて保存します。
3. プロジェクトメニューに追加された「Kanban」タブをクリックすると、カンバンボードが表示されます。

## 開発者向け情報

### フロントエンドのビルド

フロントエンド（SPA部分）のソースコードは `plugins/redmine_kanban/frontend` にあります。
コードを変更した場合は、以下の手順で再ビルドが必要です。

```bash
# フロントエンドディレクトリへ移動
cd plugins/redmine_kanban/frontend

# 依存関係のインストール（初回のみ）
npm install

# ビルド実行
npm run build
```

ビルドが完了したら、Redmine コンテナを再起動して変更を反映させます。

```bash
# プロジェクトルートに戻って実行
docker compose restart redmine
```

### テストの実行

プラグインのバックエンド（Ruby）のテストを実行するには、以下のコマンドを使用します。

```bash
docker compose exec redmine bundle exec rails test plugins/redmine_kanban/test
```

## ライセンス

本プロジェクトは [MIT License](LICENSE) の下で公開されています。
