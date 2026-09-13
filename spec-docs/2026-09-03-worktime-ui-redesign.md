# Worktime UI再設計 実装判断ログ

日付: 2026-09-03
ステータス: 完了
プロジェクトルート: `/home/glorydays/projects/src/ruby/redmine-all/plugins/redmine_kanban`
参照元: `spec-docs/issue-20260903-1.md`
実装対象: `frontend/src/ui/workTimer/`、Worktime連携UI、関連CSS・locale・テスト・生成済みassets

## 依頼と参照元の要約

Worktimeの開始、実行中、未登録状態を提示画像のデザイン体系へ統一し、既存の操作フローとCanvas Gantt互換TimerSessionを維持する。あわせて、Stop/recordingAttemptの排他性、fallback lock、Tab ID、Time Entry iframeのsubmit・成功判定を堅牢化し、UI・操作・複数タブのテストを追加する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 現在の作業ツリー上で実装する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: 対象ブランチは `add-worktime`。
- 参照元に書かれていなかったこと: 実行環境の現在ブランチは `main` で、既にWorktime実装が存在する場合の扱い。
- 判断: ブランチを切り替えず、ユーザーが指定した現在の作業ツリー上の既存Worktime実装へ仕様を適用する。
- 理由: ブランチ切り替えはユーザーの未追跡仕様書を含む作業状態へ影響し得る一方、対象実装は現在ブランチに存在しているため。
- 代替案: `add-worktime` へ切り替える、または新規ブランチを作成する。
- 影響: 変更は現在の `main` 作業ツリーに作成される。コミットやブランチ作成は行わない。
- 可逆性: 高。差分を別ブランチへ移せる。
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-002 Worktime UIを状態別コンポーネントとCSSトークンへ分割する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: 巨大な `WorkTimer.tsx` へ集中させず、画像のデザイン体系を共通トークンで実装する。
- 参照元に書かれていなかったこと: Kanban側での最終的なファイル境界と、既存importの互換方法。
- 判断: `GlobalTimer`、`TimerStartModal`、`PendingWorkModal`、`OtherNoticeModal`、`WorkTimerIcon` に分け、`WorkTimer.tsx` は既存importを維持するre-export境界とした。色・角丸・shadow・buttonは `styles.css` の `--rk-timer-*` 変数へ集約した。
- 理由: 状態別テストと保守を可能にしつつ、`App.tsx` のimport互換性を保つため。
- 代替案: 単一コンポーネント内で条件分岐を維持する。
- 影響: WorktimeのUI責務が分離され、running/pending/expired/管理/競合通知を個別に変更できる。
- 可逆性: 高。re-export境界があるため統合も可能。
- 制約: 任意判断
- ユーザー確認: 不要

### D-003 Pending再開は15分延長、破棄は確認後に実行する

- 種別: 仕様ギャップ
- タイミング: 実装中
- 参照元に書かれていたこと: Pending管理画面からTimer再開と未登録時間破棄を可能にする。
- 参照元に書かれていなかったこと: 再開時の予定時間と、破棄前確認の有無。
- 判断: 常設shortcutと同じ15分で再開し、破棄は確認メッセージを承認した場合だけsessionを削除する。
- 理由: 新しい時間選択UIを管理画面に推定追加せず、誤操作による未登録時間消失を防ぐため。
- 代替案: 再開時間選択を追加する、確認なしで破棄する。
- 影響: 管理画面の「再開」は `+15分` と明記される。破棄には1段階の確認が入る。
- 可逆性: 高。UI callbackの局所変更である。
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-004 fallback lockをCanvas Ganttの実データ形式へ合わせる

- 種別: 変更
- タイミング: 実装中
- 参照元に書かれていたこと: lock key、DB、store、lock data format、transaction boundaryをCanvas Ganttと完全互換にする。
- 参照元に書かれていなかったこと: Kanban現行のlocalStorage leaseが `owner/until`、Canvas Gantt現行が `token/expiresAt` と食い違っていた。
- 判断: sibling pluginの `timerStorage.ts` を正本として、localStorage leaseを `token/expiresAt`、IndexedDBを `redmine_canvas_gantt_timer_locks` / `locks` のreadwrite transaction内callbackへ統一した。legacy ownerも `legacy-owner` に揃えた。
- 理由: 片方のpluginが他方のlockを未知形式として無視する相互排他破りを解消するため。
- 代替案: Kanban側の形式を維持し、Canvas Ganttも同時変更する。
- 影響: 両pluginのfallback lockが相互認識される。旧Kanban固有leaseは期限切れ後に新形式へ置換される。
- 可逆性: 中。両plugin間protocolのため単独で戻すべきではない。
- 制約: 制約により必須
- ユーザー確認: 不要

### D-005 Time Entry成功redirectをIssue詳細へ限定する

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: `/time_entries/new + success notice` と確認済み正常redirectだけを成功とし、login/error/想定外画面は成功扱いしない。
- 参照元に書かれていなかったこと: `back_url` が指す具体的な正常redirect。
- 判断: 既存URL builderが `back_url=/issues/:id` を設定するため、success notice付きnew formとIssue詳細URLのみをallow-listにした。それ以外は `unknown` へ遷移させる。
- 理由: 登録未確認のTimerSession削除と二重登録を防ぐため。
- 代替案: `/time_entries` 一覧や任意の同一origin URLも成功扱いする。
- 影響: カスタムredirectは自動完了せず、利用者による結果確認が必要になる。
- 可逆性: 高。`resolveSaveLoadOutcome` のallow-list変更である。
- 制約: 制約により必須
- ユーザー確認: 不要

### D-006 Screenshot baselineは追加しない

- 種別: 検証制約
- タイミング: 検証中
- 参照元に書かれていたこと: Visual Regressionは可能であれば追加する。
- 参照元に書かれていなかったこと: 提示画像そのものと承認済みpixel baselineのリポジトリ内配置。
- 判断: DOM/class/stateのUIテストと実ブラウザE2Eを追加し、pixel screenshot baselineは作成しない。
- 理由: 正本画像ファイルがworkspaceに存在せず、今回生成した表示を自己承認baselineにすると画像一致の検証にならないため。
- 代替案: 現在の実装スクリーンショットをbaselineとして追跡する。
- 影響: 構造・状態・操作回帰は検出するが、pixel単位の外観差は自動検出しない。
- 可逆性: 高。承認済み画像が得られれば追加可能。
- 制約: 一時対応
- ユーザー確認: 事後報告

### D-007 添付画像に従いPending再開を時間選択式へ変更する

- 種別: 変更
- タイミング: 実装後
- 参照元に書かれていたこと: 追加提示された画像では「作業を続ける」欄に `+5分`、`+10分`、`+15分`、`+30分`、`+60分` を並べる。
- 参照元に書かれていなかったこと: recordingAttemptの復旧・unknown状態を同じダイアログでどう表示するか。
- 判断: 通常Pendingは画像どおり、警告ヘッダー、Issue、経過時間、全幅記録button、区切り、5段階の再開時間、破棄／閉じるfooterで構成する。復旧・unknown時はヘッダーと経過時間を共通化し、中央だけ既存の安全な解決操作へ切り替える。D-003の15分固定判断は本判断で置き換える。
- 理由: 添付画像が今回の明示的なデザイン正本であり、既存のTimerSession復旧機能も失わないため。
- 代替案: 通常Pendingだけ別コンポーネントにし、復旧系は旧レイアウトを維持する。
- 影響: Pendingから任意の規定時間で再開できる。破棄確認はnative confirmではなく同じダイアログ内に表示される。
- 可逆性: 高。Pending表示とcallback引数の局所変更である。
- 制約: ユーザー指定により必須
- ユーザー確認: 確認済み

## 変更・逸脱

指定された安全性・操作フロー・UI状態に対する意図的な逸脱はなし。Visual Regressionのみ「可能であれば」の条件に対し未追加。

## 妥協点と残課題

追加添付画像により再開時間は5/10/15/30/60分の選択式へ更新した。Visual Regressionは承認済みbaseline不足により未追加。

## 検証と制約

- 実行した検証: `bash script/ci/frontend-static.sh all`（build/lint/typecheck/Vitest）、対象46テスト、`node --check e2e/tests/kanban-worktime.spec.js`、Worktime Playwright E2E 3件、Ruby構文確認、locale YAML parse、`git diff --check`。
- 実行できなかった検証: `docker compose exec -T redmine bundle exec rails test plugins/redmine_kanban/test` は稼働コンテナにtest database設定がなく `ActiveRecord::AdapterNotSpecified` で開始不能。Screenshot Visual Regressionは承認済みbaseline不足のため未追加。

## 結果

開始・running・expired・pending・管理・他Issue競合通知を画像由来のデザイン体系へ統一した。追加画像に従いPending管理を経過時間、全幅記録操作、区切り、5段階の再開時間、破棄／閉じるfooterへ更新した。StopとrecordingAttempt取得を単一排他mutationにし、Canvas Gantt互換fallback lock、Tab ID fallback、Time Entry form限定と成功allow-listを実装した。frontend CI検証とWorktime E2E 3件は成功し、Ruby suiteのみ環境設定不足で未実行。
