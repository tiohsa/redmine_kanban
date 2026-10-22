# 公式マニュアルサイト実装報告

本サイトは VitePress で構成し、利用者向け・管理者向けの日英マニュアル、検証手順、CI、実画面スクリーンショットおよびデモ動画を整備しました。

## 変更範囲

- `website/.vitepress/`: VitePress 設定、日英ナビゲーション、ローカル検索、対象版表示（v0.8.0）。
- `website/package.json`、`package-lock.json`、`.gitignore`: プラグイン本体と独立した依存・コマンド管理。
- `website/index.md`、`website/{ja,en}/`: 言語選択ポータルと両言語のマニュアル（計33ページ）。
- `website/public/images/`、`website/public/videos/`: Redmine 7.0 上で実際に自動撮影した実画面スクリーンショット（日英計 14 点）、デモ動画（日英計 2 点）、ポスター画像、README 用デモ GIF。
- `website/scripts/`、`website/tests/`、`website/playwright.config.ts`: 文書検査、自動撮影スクリプト、Playwright スモークテスト。
- `.github/workflows/docs.yml`: PR 検証、main push 後の GitHub Pages 公開。
- `README.md`、`README.ja.md`: 公式マニュアルへの案内およびデモ GIF の追加、既存の GitHub アンカーの完全維持。
- `website/MAINTENANCE.md`、この文書: 保守手順と実装報告。

プラグインの Ruby、フロントエンド（React/Canvas）、既存 CI・リリースワークフロー、生成アセットは変更対象外です。

## サイト構成

日本語と英語それぞれにトップ、ガイド 3 ページ、機能 8 ページ、管理者向け 3 ページ、トラブルシューティングを用意しています。

- ガイド: はじめに、インストールとセットアップ、基本操作
- 機能: スイムレーン、サブタスク管理、停滞検知、フィルター、保存ビュー、作業時間タイマー、表示設定・ダイアログ、API・クエリ仕様
- 管理者向け: システム設定、権限設定、本番デプロイ
- トラブルシューティング: よくある問題と解決策

## 素材と撮影環境

2026-10-21 に Redmine 7.0.2 / Redmine Kanban 0.8.0 の環境上で、再現用スクリプト（`manual-demo.rb` および `capture-kanban.mjs`）を用いて以下の素材を自動撮影・生成しました：

- **ボード全体概要**: `kanban-overview-ja.png`, `kanban-overview-en.png` (1440×850)
- **スイムレーン**: `swimlanes-ja.png`, `swimlanes-en.png`
- **表示設定**: `display-settings-ja.png`, `display-settings-en.png`
- **チケットダイアログサイズ設定**: `issue-dialog-settings-ja.png`, `issue-dialog-settings-en.png`
- **保存ビュー**: `saved-views-ja.png`, `saved-views-en.png`
- **停滞検知（Aging）**: `aging-ja.png`, `aging-en.png`
- **ロール・権限設定**: `permissions-ja.png`, `permissions-en.png`
- **基本操作動画**: `kanban-drag-ja.mp4`, `kanban-drag-en.mp4` (H.264, 1440×850, 8.0 秒, 無音)
- **動画ポスター**: `kanban-drag-poster-ja.png`, `kanban-drag-poster-en.png`
- **README用デモGIF**: `docs/demo-current.gif` (1000px 幅, 10 fps, 1.1 MB)

## 検証記録

1. `npm ci`: 成功。
2. `npm run check`: 成功（33 ページのリンク、アンカー、画像、動画、ポスター、日英対称性、README 互換アンカーをすべて検証）。
3. `npm run docs:build`: 成功（VitePress 1.6.4 による静的ビルド、警告・エラーなし）。
4. `npm run test:smoke`: Playwright 実機テスト 5 件すべて成功（日英切り替え、検索、ダークモード、390px モバイル表示、全画像・動画要素の検証）。
5. `git diff --check`: 成功。
