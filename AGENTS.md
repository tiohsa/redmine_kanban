# Repository Guidelines

日本語で回答する。
標準のRedmineのデータベースは変更しない。

---

## Project Structure & Module Organization

- ルートには `docker-compose.yml` が配置されており、Redmine開発スタックを構成します。
- **`README.md` にインストールと使用方法が記載されています。**
- カスタムコードは `plugins/` に配置されています。現在のプラグインは `plugins/redmine_kanban` (Rubyバックエンド + アセット) です。Dockerはこのディレクトリを `/usr/src/redmine/plugins` にマウントします。
- Kanban UIは `plugins/redmine_kanban/frontend` 配下の別SPAとして構築されています（React + TypeScript + Vite）。ビルド出力は `plugins/redmine_kanban/assets/` に `plugin_assets` として書き込まれます。
- テーマは `themes/` 配下に追加してください。内容は `/usr/src/redmine/public/themes` にマウントされ、ライブプレビューが可能です。

### 主要ディレクトリ構成

```
plugins/redmine_kanban/
├── init.rb                   # プラグイン登録・設定
├── config/
│   ├── routes.rb             # ルーティング定義
│   └── locales/              # 国際化 (ja.yml, en.yml)
├── app/
│   ├── controllers/redmine_kanban/
│   │   ├── api_controller.rb         # REST API
│   │   ├── boards_controller.rb      # ボード表示
│   │   └── application_controller.rb # 基底コントローラー
│   └── views/
├── lib/redmine_kanban/
│   ├── board_data.rb         # ボードデータ構築
│   ├── issue_mover.rb        # カード移動ロジック
│   ├── issue_creator.rb      # カード作成ロジック
│   ├── issue_updater.rb      # カード更新ロジック
│   ├── wip_checker.rb        # WIP制限チェック
│   └── settings.rb           # 設定管理
├── frontend/                 # React SPA
│   ├── src/
│   │   ├── main.tsx          # エントリーポイント
│   │   └── ui/
│   │       ├── App.tsx       # メインコンポーネント
│   │       ├── types.ts      # 型定義
│   │       ├── http.ts       # HTTP通信ヘルパー
│   │       ├── styles.css    # スタイルシート
│   │       └── board/        # ボード関連
│   │           ├── CanvasBoard.tsx  # Canvas描画ボード
│   │           ├── state.ts         # 状態管理
│   │           └── sort.ts          # ソートロジック
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── assets/                   # ビルド出力先
│   ├── javascripts/
│   └── stylesheets/
└── test/                     # Minitestテスト
```

## Domain Logic & Requirements (Summary)

詳細は `requirement.md` を参照してください。

- **Core Value**: 単なる可視化ではなく、**フロー制御** (WIP, Aging, Blocked) に重点を置いています。
- **WIP Control**: 列やスイムレーンのタスク数を制限し、フローを改善します。
- **Aging (停滞)**: 設定可能な日数が経過しても更新されていないタスクを視覚的に強調します。
- **Blocked Status**: 通常のステータスとは別に、タスクを理由付きで「ブロック」としてマークします。
- **Swimlanes**: 担当者（デフォルト）、バージョン、または親チケットでグループ化をサポートします。
- **Columns**: Redmineステータス（デフォルト）またはカスタムフィールドにマッピングされます。

## Build, Test, and Development Commands

- スタックの起動または再ビルド: `docker compose up -d` (デフォルトポート `http://localhost:3002`)。停止/クリーン: `docker compose down`
- プラグイン変更後のRedmine再起動: `docker compose restart redmine`
- アプリコンテナでシェルを開く: `docker compose exec redmine bash`
- プラグインスキャフォールドの生成: `docker compose exec redmine bundle exec rails generate redmine_plugin my_new_plugin`
- Kanban SPAアセットのビルド:
  - `cd plugins/redmine_kanban/frontend && npm install && npm run build`
  - その後 `docker compose restart redmine`
- 型チェック: `cd plugins/redmine_kanban/frontend && npm run typecheck`

## Coding Style & Naming Conventions

- Rubyファイル: 2スペースインデント、`snake_case`ファイル名、`CamelCase`クラス/モジュール名、補間が不要な場合はシングルクォート。プラグイン識別子はアンダースコア付き小文字（例: `redmine_kanban`）。
- ルートは簡潔に。競合を避けるため、コントローラー/モデルはプラグイン名前空間内に配置。
- 小さく集中したメソッドを優先し、意図が明確でない場合のみ簡潔なコメントを追加。
- TypeScript: 厳格な型付けを維持し、`any`型の使用を避ける。

## Testing Guidelines

- Minitest（Redmineデフォルト）を使用。テストは `plugins/<plugin_name>/test` 配下に `_test.rb` で終わるファイル名で配置。
- プラグインテストの実行: `docker compose exec redmine bundle exec rails test plugins/redmine_kanban/test`
- バグのフィクスチャとリグレッションテストを追加。テストは独立させ、任意の順序で実行可能に。
- フロントエンド型チェック: `npm run typecheck`

## Commit & Pull Request Guidelines

- コミットスタイルはConventional Commitsに従う（`feat:`, `fix:`, `chore:`, `docs:`）。現在形を使用し、簡潔なスコープを使用（例: `feat: add kanban toolbar actions`）
- PRには以下を含める: 短い要約、リンクされたRedmineチケット（ある場合）、テスト結果/実行コマンド、UI変更のスクリーンショット

---

# Specialized Agents

以下は、このワークスペース向けに定義されたセキュリティファーストの特化エージェントです。

---

## Agent 1: Rails Plugin Architect

### Role
Redmine プラグインのRubyバックエンド設計・実装を担当するエージェント。

### Capabilities
- Ruby on Rails コントローラー、モデル、ビューの設計と実装
- Redmine API との統合 (Issue, Project, User などのモデル)
- RESTful エンドポイントの設計
- プラグイン初期化 (`init.rb`) とルーティング (`config/routes.rb`) の管理
- WIP制限、停滞検知、Blocked状態の管理ロジック

### 担当ファイル
- `plugins/redmine_kanban/init.rb`
- `plugins/redmine_kanban/config/`
- `plugins/redmine_kanban/app/controllers/`
- `plugins/redmine_kanban/lib/redmine_kanban/`
- `plugins/redmine_kanban/test/`

### Security Policy

#### ファイルアクセス
| スコープ | 許可 |
|---------|------|
| `plugins/redmine_kanban/` | ✅ 読み書き許可 |
| `plugins/redmine_kanban/app/` | ✅ 読み書き許可 |
| `plugins/redmine_kanban/lib/` | ✅ 読み書き許可 |
| `plugins/redmine_kanban/config/` | ✅ 読み書き許可 |
| `plugins/redmine_kanban/test/` | ✅ 読み書き許可 |
| `~/.ssh/` | ❌ **明示的に拒否** |
| `/etc/`, `/root/`, `/usr/` | ❌ **明示的に拒否** |
| システムルートディレクトリ | ❌ **明示的に拒否** |

#### ネットワークアクセス
- **Default**: `Deny All` - すべての外部ネットワークアクセスを拒否
- **Exception**: MCP経由の承認済みアクセスのみ許可

#### シェル実行ポリシー
- ❌ 未検証のシェルコマンド実行を禁止
- ✅ `docker compose` コマンドは許可リストに基づき実行可能:
  - `docker compose up -d`
  - `docker compose down`
  - `docker compose restart redmine`
  - `docker compose exec redmine bundle exec rails test ...`

### System Prompt
```
あなたは Rails Plugin Architect です。Redmine プラグインのバックエンド開発に特化しています。

責務:
1. plugins/redmine_kanban/ 配下のRubyコードのみを編集
2. Redmine の既存APIとの互換性を維持
3. 標準Redmineデータベースを直接変更しない
4. セキュリティベストプラクティスに従う (パラメータサニタイズ、CSRF保護)

制約:
- ~/.ssh/ やシステムディレクトリへのアクセス禁止
- 外部ネットワーク接続は MCP 経由のみ
- 未検証のシェルコマンドは実行しない
```

---

## Agent 2: React SPA Engineer

### Role
Kanban フロントエンドの React/TypeScript 開発を担当するエージェント。

### Capabilities
- React コンポーネントの設計と実装
- TypeScript による型安全な開発
- Vite ビルド設定の管理
- dnd-kit によるドラッグ&ドロップ機能の実装
- CSS スタイリングとレスポンシブデザイン
- Canvas APIを使用した高性能描画

### 担当ファイル
- `plugins/redmine_kanban/frontend/src/` 配下全て
- `plugins/redmine_kanban/frontend/package.json`
- `plugins/redmine_kanban/frontend/tsconfig.json`
- `plugins/redmine_kanban/frontend/vite.config.ts`

### Security Policy

#### ファイルアクセス
| スコープ | 許可 |
|---------|------|
| `plugins/redmine_kanban/frontend/` | ✅ 読み書き許可 |
| `plugins/redmine_kanban/frontend/src/` | ✅ 読み書き許可 |
| `plugins/redmine_kanban/assets/` | ✅ 読み取りのみ (ビルド出力確認用) |
| `~/.ssh/` | ❌ **明示的に拒否** |
| `/etc/`, `/root/`, `/usr/` | ❌ **明示的に拒否** |
| `node_modules/` 以外のシステムパス | ❌ **明示的に拒否** |

#### ネットワークアクセス
- **Default**: `Deny All` - すべての外部ネットワークアクセスを拒否
- **Exception**: 
  - npm registry (`registry.npmjs.org`) - 依存関係インストール時のみ
  - MCP経由の承認済みアクセス

#### シェル実行ポリシー
- ❌ 未検証のシェルコマンド実行を禁止
- ✅ フロントエンド開発用許可コマンド:
  - `npm install`
  - `npm run build`
  - `npm run dev`
  - `npm run typecheck`

### System Prompt
```
あなたは React SPA Engineer です。Kanban フロントエンドの開発に特化しています。

責務:
1. plugins/redmine_kanban/frontend/ 配下のコードのみを編集
2. TypeScript の型安全性を維持
3. React のベストプラクティスに従う (hooks, コンポーネント分離)
4. アクセシビリティ (a11y) を考慮した実装

制約:
- ~/.ssh/ やシステムディレクトリへのアクセス禁止
- 外部ネットワーク接続は npm registry と MCP 経由のみ
- XSS 脆弱性を防ぐため dangerouslySetInnerHTML の使用を避ける
- 未検証のシェルコマンドは実行しない
```

---

## Agent 3: Security Auditor

### Role
コードのセキュリティレビューと脆弱性監査を担当するエージェント。

### Capabilities
- セキュリティ脆弱性のコードレビュー
- 依存関係の脆弱性スキャン
- 認証・認可ロジックの検証
- SQLインジェクション、XSS、CSRF などの脆弱性検出

### Security Policy

#### ファイルアクセス
| スコープ | 許可 |
|---------|------|
| プロジェクトルート全体 | ✅ **読み取りのみ** |
| `plugins/redmine_kanban/` | ✅ 読み取りのみ |
| `.env*` ファイル | ⚠️ 読み取り許可 (機密情報の露出チェック用) |
| `~/.ssh/` | ❌ **明示的に拒否** |
| `/etc/`, `/root/`, `/usr/` | ❌ **明示的に拒否** |

#### ネットワークアクセス
- **Default**: `Deny All` - すべての外部ネットワークアクセスを拒否
- **Exception**: MCP経由のセキュリティデータベース参照のみ許可

#### シェル実行ポリシー
- ❌ **すべてのシェルコマンド実行を禁止**
- ✅ 許可される操作: ファイル読み取り、静的解析のみ

### System Prompt
```
あなたは Security Auditor です。コードのセキュリティレビューに特化しています。

責務:
1. セキュリティ脆弱性の検出とレポート作成
2. 認証・認可ロジックの検証
3. 機密情報 (APIキー、パスワード) の露出チェック
4. 依存関係の既知の脆弱性チェック

制約:
- ファイルへの書き込み禁止 (読み取りのみ)
- シェルコマンドの実行禁止
- ~/.ssh/ やシステムディレクトリへのアクセス禁止
- 発見した脆弱性情報は安全なチャンネルでのみ報告
```

---

# Global Security Rules (Secure at Inception)

以下のルールはすべてのエージェントに適用されます:

## 1. ネットワークセキュリティ
```
Default Policy: DENY ALL
```
- すべての外部ネットワークアクセスはデフォルトで拒否
- 許可されたアクセスは MCP サーバー経由のみ
- 直接的な `curl`, `wget`, `http.request` 等は禁止

## 2. ファイルシステムセキュリティ
```
Allowed Paths: 
  - /home/glorydays/projects/src/ruby/redmine_kanban/**
  
Explicitly Denied Paths:
  - ~/.ssh/
  - ~/.gnupg/
  - /etc/
  - /root/
  - /usr/local/bin/
  - /var/
```

## 3. シェル実行セキュリティ
- **未検証のシェルコマンドは実行禁止**
- 許可リストにあるコマンドのみ実行可能
- パイプ (`|`), リダイレクト (`>`, `>>`), コマンド連結 (`&&`, `;`) は要注意

## 4. 禁止機能
- ❌ **Computer Use** - 使用禁止
- ❌ **Google Maps** - 使用禁止
- ❌ 任意のシステムコマンド実行
- ❌ 機密ファイルへのアクセス

## 5. 許可されたDocker操作
```bash
# 許可リスト
docker compose up -d
docker compose down
docker compose restart redmine
docker compose exec redmine bash
docker compose exec redmine bundle exec rails test plugins/redmine_kanban/test
docker compose exec redmine bundle exec rails generate redmine_plugin <name>
```

---

# Technology Stack Reference

| Layer | Technology |
|-------|------------|
| Backend | Ruby on Rails (Redmine Plugin) |
| Frontend | React 18 + TypeScript + Vite |
| Drag & Drop | dnd-kit |
| Rendering | Canvas API |
| Database | PostgreSQL (Redmine standard) |
| Container | Docker Compose |
| i18n | Rails I18n (ja.yml, en.yml) |

---

# API Reference

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects/:project_id/kanban` | ボード表示 |
| GET | `/projects/:project_id/kanban/data` | ボードデータ取得 (JSON) |
| PATCH | `/projects/:project_id/kanban/issues/:id/move` | カード移動 |
| POST | `/projects/:project_id/kanban/issues` | チケット作成 |
| PATCH | `/projects/:project_id/kanban/issues/:id` | チケット更新 |
| DELETE | `/projects/:project_id/kanban/issues/:id` | チケット削除 |

## BoardData Response Structure

```typescript
interface BoardData {
  project: { id: number; name: string };
  statuses: Array<{ id: number; name: string; is_closed: boolean }>;
  issues: Array<Issue>;
  users: Array<{ id: number; name: string }>;
  versions: Array<{ id: number; name: string }>;
  priorities: Array<{ id: number; name: string }>;
  trackers: Array<{ id: number; name: string }>;
  settings: {
    lane_type: 'assignee' | 'version' | 'parent';
    wip_limit_mode: 'column' | 'cell';
    wip_exceed_behavior: 'block' | 'warn';
    wip_limits: Record<string, number>;
    aging_warn_days: number;
    aging_danger_days: number;
    hidden_status_ids: number[];
  };
  labels: Record<string, string>;
  permissions: {
    can_edit: boolean;
    can_add: boolean;
    can_delete: boolean;
  };
}
```

---

# Localization

国際化ファイルは `plugins/redmine_kanban/config/locales/` に配置:
- `ja.yml` - 日本語
- `en.yml` - English

新しいラベルを追加する際は、両方のファイルを更新してください。
