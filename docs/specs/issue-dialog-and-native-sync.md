# SPEC: チケットダイアログ（iframe）とネイティブ操作同期

## 1. Goal（目的）
- カンバンボード上から Redmine 標準のチケット作成・編集画面を iframe ダイアログ（`IframeEditDialog` / `KanbanIssueModal`）として開き、カスタムフィールドや標準フォームの全機能を利用できるようにする。
- iframe 内で Redmine ネイティブの書き込み操作が完了した際、表示設定を保持したまま（`preserveDisplay: true`）ボード状態を authoritative に再同期する。
- ガントチャートへの遷移互換（`GET /projects/:project_id/gantt`）を維持する。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- Redmine 標準のチケット編集フォーム（カスタムフィールド、添付ファイル、ウォッチャー等）を React 側で完全再実装すること。
- iframe 内のネイティブ書き込み結果を通常の plugin API delta と同一視して部分マージすること。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（iframe 編集・作成と同期）:** Given ボード上からネイティブ編集または作成ダイアログを開いた状態, when ユーザーが Redmine 標準フォームを送信して保存が完了する, then `saveFlow` が保存成功を検知し、`onNativeWriteComplete` 経由でボードスナップショットが最新化される。
- [ ] **Happy Path（ダイアログサイズ設定）:** Given ユーザーがダイアログサイズ（`issueDialogSize`）を選択・保持している状態, when `IframeEditDialog` を開く, then `model/view/issueDialogSize.ts` の規則に従ってダイアログサイズが適用される。
- [ ] **Happy Path（ガントリダイレクト）:** Given クエリ文字列付きまたはなしの `GET /projects/:project_id/gantt` リクエスト, when `RedirectsController#gantt` が処理する, then `/projects/:project_id/issues/gantt`（クエリ文字列維持）へリダイレクトする。
- [ ] **Error / Boundary Case（バリデーションエラー・セッション中断）:** Given iframe 内で Redmine のフォームバリデーションエラーが発生した場合, then ダイアログは閉じずに Redmine のエラー表示を維持し、誤って成功同期を発火させない。
- [ ] **Error / Boundary Case（外部リンクの安全性）:** Given iframe 内の wiki コンテンツ等にリンクが含まれる場合, then `iframeStyles.ts` により外部リンクへ `rel="noopener noreferrer"` 等が適用される。
- [ ] **Backward Compatibility:** `IframeEditDialog.test.ts`・`IframeEditDialog.layout.test.tsx`・`saveFlow.test.ts`・`redmineForm.test.ts`・`kanban-issue-dialog.spec.js`・`kanban-native-mutation.spec.js` がパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Endpoint:** `GET /projects/:project_id/gantt` (`redmine_kanban/redirects#gantt`) → `/projects/:project_id/issues/gantt` への HTTP 302 リダイレクト
- **DB Schema:** 変更なし。

## 5. Constraints（制約事項）
- **Security:** 同一オリジン（Redmine 本体）の iframe 操作のみを対象とし、wiki 等のリンクには `noopener noreferrer` を付与する。Redmine 本体の CSRF トークンおよび権限検証をそのまま通過させる。
- **Performance:** iframe のリサイズ監視（`iframeObservers.ts` / `iframeMeasurement.ts`）は不要なレイアウトスラッシングを避ける。

## 6. Required Tests（必須テスト）
- **Unit:** `frontend/src/ui/IframeEditDialog.test.ts`, `frontend/src/ui/IframeEditDialog.layout.test.tsx`, `frontend/src/ui/KanbanIssueModal.test.tsx`, `frontend/src/ui/iframe/saveFlow.test.ts`, `frontend/src/ui/iframe/redmineForm.test.ts`, `frontend/src/ui/board/iframeStyles.test.ts`
- **Integration / E2E:** `e2e/tests/kanban-issue-dialog.spec.js`, `e2e/tests/kanban-native-mutation.spec.js`, `e2e/tests/native-button-popup.spec.js`
- **Regression:** ダイアログ閉鎖時のフォーカス復帰、および保存後にボード表示設定が初期化されないこと。
