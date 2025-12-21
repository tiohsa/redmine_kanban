# Redmine Kanban (SPA)

Redmineの運用を強化するための、React + Vite で構築されたモダンなカンバンボードプラグインです。
従来の「タスクの見える化」だけでなく、WIP（仕掛り）制限や停滞検知（Aging）などの機能を備え、チームのフロー効率を向上させることを目的としています。

## 特徴

* **WIP制御**: 列や担当者ごとの仕掛り数（WIP）を制限し、マルチタスクによる効率低下を防ぎます。超過時の動作（禁止/警告）も設定可能です。
* **停滞検知 (Aging)**: 長期間更新されていないタスクを視覚的に強調し、見落としを防ぎます。閾値は設定で調整できます。
* **スイムレーン**: 担当者、バージョン、親チケットなどでレーンを切り替え、多角的な視点でタスクを管理できます。
* **Blocked表示**: 作業がブロックされている理由を明示し、解決を促します。
* **SPA (Single Page Application)**: Reactによる高速で直感的な操作性を実現しています。
* **ドラッグ&ドロップ**: dnd-kitを使用した直感的なカード移動。Redmineのワークフローに準拠したステータス遷移をサポートします。
* **高度なフィルタリング**: 担当者、期限、優先度、Blocked状態などでタスクをフィルタリングできます。
* **かんばんからの直接作成**: 列ヘッダやセルから新規チケットを作成でき、朝会などでの即時更新が可能です。
* **サブタスク表示**: 親タスクのサブタスク一覧を表示し、完了状態のトグルが可能です。
* **Undo機能**: 誤って削除したタスクを復元できます。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| バックエンド | Ruby on Rails (Redmine プラグイン) |
| フロントエンド | React 18 + TypeScript + Vite |
| ドラッグ&ドロップ | dnd-kit |
| コンテナ | Docker Compose |
| データベース | PostgreSQL (Redmine標準) |

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
2. プロジェクトの「設定」→「モジュール」タブで、**Kanban** にチェックを入れて保存します。
3. プロジェクトメニューに追加された「かんばん」タブをクリックすると、カンバンボードが表示されます。

### 設定オプション

プラグイン設定画面で以下の項目を調整できます：

* **スイムレーンタイプ**: 担当者/バージョン/親チケット
* **チケット表示上限**: ボードに表示するチケット数の上限
* **非表示ステータス**: ボードに表示しないステータスの選択
* **WIP制限モード**: 列単位/列×レーン単位
* **WIP超過時の動作**: 禁止/警告のみ
* **停滞閾値**: 注意・危険レベルの日数設定
* **ステータス自動更新**: カード移動時のステータス自動変更ルール

## 開発者向け情報

### プロジェクト構造

```
redmine_kanban/
├── docker-compose.yml        # Redmine開発スタック
├── README.md                 # このファイル
├── AGENTS.md                 # エージェント向けガイドライン
├── requirement.md            # 詳細要件定義
├── SETUP.md                  # セットアップ手順
├── plugins/
│   └── redmine_kanban/       # プラグイン本体
│       ├── init.rb           # プラグイン登録
│       ├── config/
│       │   ├── routes.rb     # ルーティング
│       │   └── locales/      # 国際化ファイル (ja.yml, en.yml)
│       ├── app/
│       │   ├── controllers/  # Railsコントローラー
│       │   └── views/        # ビューテンプレート
│       ├── lib/
│       │   └── redmine_kanban/
│       │       ├── board_data.rb    # ボードデータ構築
│       │       ├── issue_mover.rb   # カード移動ロジック
│       │       ├── issue_creator.rb # カード作成ロジック
│       │       ├── issue_updater.rb # カード更新ロジック
│       │       ├── wip_checker.rb   # WIP制限チェック
│       │       └── settings.rb      # 設定管理
│       ├── frontend/         # React SPA ソースコード
│       │   ├── src/
│       │   │   ├── main.tsx
│       │   │   └── ui/
│       │   │       ├── App.tsx       # メインコンポーネント
│       │   │       ├── types.ts      # 型定義
│       │   │       ├── http.ts       # API通信
│       │   │       ├── styles.css    # スタイル
│       │   │       └── board/        # ボード関連コンポーネント
│       │   ├── package.json
│       │   └── vite.config.ts
│       ├── assets/           # ビルド出力先
│       └── test/             # テストファイル
└── themes/                   # カスタムテーマ
```

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

フロントエンドの型チェック：

```bash
cd plugins/redmine_kanban/frontend
npm run typecheck
```

### API エンドポイント

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/projects/:project_id/kanban/data` | ボードデータ取得 |
| PATCH | `/projects/:project_id/kanban/issues/:id/move` | カード移動 |
| POST | `/projects/:project_id/kanban/issues` | チケット作成 |
| PATCH | `/projects/:project_id/kanban/issues/:id` | チケット更新 |
| DELETE | `/projects/:project_id/kanban/issues/:id` | チケット削除 |

## ライセンス

本プロジェクトは [MIT License](LICENSE) の下で公開されています。
