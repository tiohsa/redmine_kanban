# マニュアルの保守

`website/ja/` と `website/en/` を利用者・管理者向けマニュアルの正本とします。

## ローカル開発と検証

Node.js 22 以上と npm を使用します（静的検証や編集時は Redmine や Rails 環境は不要です）。

```sh
cd website
npm ci
npm run docs:dev
```

変更の検証:

```sh
npm run check
npm run docs:build
npx playwright install chromium
npm run test:smoke
```

実装・テストを根拠に日本語と英語の同じパスを同時に更新してください。翻訳の用語・操作ラベル・警告は双方で揃えます。

---

## スクリーンショットと動画の撮影・更新

本プラグインには、Redmine 環境から再現可能なスクリーンショットおよび動画を自動撮影するスクリプトが用意されています。

### 撮影の事前準備
Redmine 開発コンテナまたはローカル Redmine（ポート 3000）を起動した状態で実行します。

```sh
# リポジトリルートから撮影スクリプトを実行
node website/scripts/capture-kanban.mjs
```

このスクリプトは以下を自動実行します：
1. `website/scripts/manual-demo.rb` を実行してデモプロジェクト `kanban-demo` を自動シード（チケット、サブタスク、停滞タスク等）。
2. Playwright（Chromium）により、日本語 (`ja`) および英語 (`en`) の各画面を自動撮影。
3. ドラッグ＆ドロップ操作の録画（WebM）を行い、FFmpeg で H.264 MP4（`kanban-drag-*.mp4`）およびポスター画像（`kanban-drag-poster-*.png`）に変換。
4. README 用のループアニメーション GIF（`docs/demo-current.gif`）を自動生成。

### 管理対象のアセット一覧

| ファイル | 用途 |
| --- | --- |
| `public/images/kanban-overview-ja.png`<br/>`public/images/kanban-overview-en.png` | トップページ、はじめに（ボード全体概要） |
| `public/images/swimlanes-ja.png`<br/>`public/images/swimlanes-en.png` | スイムレーン（担当者別レーン分割） |
| `public/images/display-settings-ja.png`<br/>`public/images/display-settings-en.png` | 表示設定ポップオーバー |
| `public/images/issue-dialog-settings-ja.png`<br/>`public/images/issue-dialog-settings-en.png` | チケットダイアログサイズ設定 |
| `public/images/saved-views-ja.png`<br/>`public/images/saved-views-en.png` | 保存ビューメニュー |
| `public/images/aging-ja.png`<br/>`public/images/aging-en.png` | 停滞検知（Aging）ハイライト |
| `public/images/permissions-ja.png`<br/>`public/images/permissions-en.png` | Redmine ロール・権限設定 |
| `public/videos/kanban-drag-ja.mp4`<br/>`public/videos/kanban-drag-en.mp4` | 基本操作（ドラッグ＆ドロップによるステータス移動動画） |
| `public/images/kanban-drag-poster-ja.png`<br/>`public/images/kanban-drag-poster-en.png` | 基本操作動画のポスター画像 |
| `docs/demo-current.gif` | リポジトリ README 用デモ GIF |

---

## README との役割分担

| 項目 | 保守先 / README の扱い |
| --- | --- |
| 製品紹介、機能概要、スクリーンショット、要件、最小導入 | README に残し、詳細への入口はマニュアルトップ（日英）に集約 |
| インストール、更新、削除、モジュール有効化 | `guide/installation.md`。README には概要手順と注意事項を残す |
| ボード基本操作、ドラッグ＆ドロップ、チケット作成・削除 | `guide/basic-operations.md` |
| スイムレーン、サブタスク、停滞検知、フィルター、保存ビュー、タイマー、表示設定 | `features/` の各ページ |
| システム設定、権限、本番デプロイ | `administration/` の各ページ |
| トラブルシューティング | `troubleshooting/index.md` |
| 開発・テスト手順 | README の Development / Testing セクション |
| 旧マニュアルと README 見出しアンカー | README の既存アンカーは文書チェッカーで恒久的に検証・保護 |

`npm run check` は Website に加えて両 README のローカルリンク、マニュアルの言語、公開 URL の base、トップページへのリンク限定、GitHub の旧アンカーと日英切り替えを検証します。
