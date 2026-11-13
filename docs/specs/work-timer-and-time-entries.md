# SPEC: 作業時間タイマー（Work Timer）と Time Entry 連携

## 1. Goal（目的）
- ボード上のチケットに対して作業時間計測タイマー（開始・延長・停止・記録）を提供し、経過時間から Redmine 標準の Time Entry 登録フォーム（iframe）へシームレスに連携できるようにする。
- ブラウザ再読込・タブ間競合・通信結果不明（`unknown`）などの障害時にも、リカバリ処理によって**重複した Time Entry POST が発生しない**安全なセッション契約（`TIMER_SESSION_VERSION = 4`）を維持する。

## 2. Non-goals / Out-of-scope（対象外・非目標）
- Redmine の `log_time` 権限・メンバーシップ・Time Entry バリデーションを迂回する独自時間登録 API の新設。
- バックグラウンドでの自動 Time Entry 確定（常にユーザーの明示的なフォーム送信または確認を経る）。

## 3. Acceptance Criteria（受け入れ条件）
- [ ] **Happy Path（タイマー計測〜Time Entry 登録）:** Given `log_time` 権限と対象チケットの作業時間登録適格性を持つユーザー, when タイマーを開始（`createTimerSession`）し、停止（`stop` または `autoStop` による期限到達）後に記録を開始（`beginRecording` / `stopAndBeginRecording`）して Time Entry フォームを送信する, then `submitting` → `confirmed` を経てセッションがクリーンアップされる。
- [ ] **Happy Path（期限到達時の自動停止 / 延長）:** Given `autoStop: true` で期限到達した場合, then `tick` により `stopped_pending_record` へ遷移し、`notifiedType: 'stopped'` が設定される。Given `autoStop: false` で期限到達した場合, then `expired`（`notifiedType: 'running_expired'`）へ遷移し、計測継続または `extend` が可能となる。
- [ ] **Error / Boundary Case（バリデーションエラー）:** Given iframe 内の Time Entry フォーム送信で Redmine のバリデーションエラーが発生した場合, then `markValidationError` により `recordingAttempt.phase` が `'submitting'` から `'editing'` へ戻り、セッションは破棄されない。
- [ ] **Error / Boundary Case（送信結果不明とリカバリ・重複 POST 防止）:** Given `'submitting'` 中に通信断やタブ閉鎖等で結果不明になった場合, then `markUnknown` により `phase: 'unknown'` へ遷移し、`PendingWorkModal` 等でユーザーに「記録済み（`recorded`） / 未登録（`unregistered`）」の確認（`resolveUnknown`）を求め、リカバリ時に自動再 POST を行わない。
- [ ] **Error / Boundary Case（タブ間所有権競合）:** Given 別タブが記録セッション（`ownerTabId`）を保持している場合, then `takeOverRecording` 等の明示的操作なしに二重送信しない。
- [ ] **Backward Compatibility:** `timerDomain.test.ts`・`timerSessionContract.test.ts`・`timerStorage.test.ts`・`timeEntryOperation.test.ts`・`WorkTimer.test.tsx`・`useWorkTimer.test.tsx`・`kanban-worktime.spec.js` がパスする。

## 4. Public API / DB Schema（公開API・DBスキーマ）
- **Client Session Contract:** `TimerSession`（`version: 4`, `state: 'running' | 'expired' | 'stopped_pending_record'`, `recordingAttempt.phase: 'editing' | 'submitting' | 'unknown' | 'confirmed'`）
- **Redmine Integration:** Redmine 標準の Time Entry 作成 URL への iframe フォーム連携（`timeEntryUrl.ts` / `timeEntryOperation.ts`）
- **DB Schema:** 変更なし（Redmine 標準の `time_entries` テーブルのみ利用）。

## 5. Constraints（制約事項）
- **Security:** `PermissionPolicy#can_log_time?`（`log_time` 権限）および Redmine ネイティブの Time Entry バリデーション・プロジェクトメンバーシップ検証を必須とする。タイマーストレージはユーザー単位スコープで分離する。
- **Performance:** タイマーの `tick` 処理はクライアントローカル時刻差分で計算し、ポーリング API リクエストを発生させない。

## 6. Required Tests（必須テスト）
- **Unit:** `frontend/src/ui/workTimer/timerDomain.test.ts`, `frontend/src/ui/workTimer/timerSessionContract.test.ts`, `frontend/src/ui/workTimer/timerStorage.test.ts`, `frontend/src/ui/workTimer/recordingCommand.test.ts`, `frontend/src/ui/workTimer/timeEntryUrl.test.ts`, `frontend/src/ui/workTimer/WorkTimer.test.tsx`, `frontend/src/ui/workTimer/useWorkTimer.test.tsx`, `frontend/src/ui/iframe/timeEntryOperation.test.ts`
- **Integration / E2E:** `e2e/tests/kanban-worktime.spec.js`
- **Regression:** `phase: 'unknown'` および `phase: 'confirmed'` のリカバリ時に重複 Time Entry POST が発生しないこと。
