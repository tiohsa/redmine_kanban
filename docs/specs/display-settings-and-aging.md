# SPEC: 表示設定・WIP制限・エイジング可視化

## 1. Goal（目的）
- ユーザー単位・プロジェクト単位でカンバン表示設定（テーマ、フォントサイズ、フィットモード、全画面、カード表示モード、サブタスク表示、スイムレーン種別、エイジング閾値、非表示ステータス等）を保持・復元できるようにする。
- 更新が滞留しているチケットを視覚的に検知するエイジング可視化（警告日数・危険日数・終了チケット除外設定）を提供する。
- 列ごとの WIP 制限および件数表示によりフローの滞留を可視化する。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- 表示設定のためのサーバーサイド DB テーブル追加。
- ユーザー間の表示設定の強制共有（表示設定は各ユーザーのスコープ付きローカル設定）。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（表示設定の永続化と復元）:** Given ボードを開いたユーザー, when `DisplaySettingsPopover` 等からテーマ（既定 `light`）・スイムレーン・フォントサイズ・サブタスク表示等を変更する, then `preferencesRepository.ts` / `scopedStorage.ts` を通じてユーザー・プロジェクト単位のキーに保存され、リロード後も復元される。
- [ ] **Happy Path（エイジング閾値と終了チケット除外）:** Given エイジング設定（既定値: `agingWarnDays = 3`、`agingDangerDays = 7`、`agingExcludeClosed = true`）, when チケットの更新経過日数を評価する, then 閾値に応じた警告/危険ハイライトが適用され、`agingExcludeClosed = true` の場合は終了ステータスチケットが除外される。
- [ ] **Error / Boundary Case（不正・欠損値と閾値逆転の補正）:** Given ストレージに負数や非整数が保存されている場合, then `restoreAgingDays` はフォールバック値（`3` / `7`）を返す。Given `agingDangerDays < agingWarnDays` となる値が復元された場合, then `Math.max(warnDays, dangerDays)` により危険日数が警告日数以上になるよう補正される。
- [ ] **Error / Boundary Case（旧キー互換移行）:** Given スコープ導入前の旧ストレージキーに値が存在する場合, then `readScopedValueWithLegacy` / `readScopedBooleanWithLegacy` により読み込まれる。
- [ ] **Backward Compatibility:** `useKanbanPreferences.test.tsx`・`storage.test.ts`・`App.displaySettings.test.tsx`・`App.calendar.test.tsx` がパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Client Storage Keys（`scopedStorage.ts` によるユーザー・プロジェクトスコープ付き）:**
  - `rk_aging_warn_days`（既定 `3`）
  - `rk_aging_danger_days`（既定 `7`）
  - `rk_aging_exclude_closed`（既定 `true` / `'1'`）
  - その他、テーマ・フォントサイズ・フィットモード・レーン種別・ソート設定・ダイアログサイズ等
- **DB Schema:** 変更なし。

## 5. Constraints（制約事項）
- **Security:** ブラウザストレージには表示設定のみを保存し、認証情報や機密データを含めない。
- **Performance:** 設定変更による Canvas 再描画はクライアントメモリ上で完結させ、不要な API 再取得を発生させない（スコープ変更を伴うものを除く）。

## 6. Required Tests（必須テスト）
- **Unit:** `frontend/src/ui/useKanbanPreferences.test.tsx`, `frontend/src/ui/utils/storage.test.ts`, `frontend/src/ui/App.displaySettings.test.tsx`, `frontend/src/ui/toolbar/toolbarOptions.test.ts`
- **Integration / E2E:** `e2e/tests/kanban-smoke.spec.js`, `e2e/tests/kanban-calendar.spec.js`
- **Regression:** 既存の保存キー互換およびユーザー・プロジェクト単位の分離が維持されること。
