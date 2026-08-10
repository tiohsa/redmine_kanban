# Freshness Authority Ownership／Lifecycle整合 実装判断ログ

日付: 2026-08-10
ステータス: 実装完了・最終SHA CI待ち
プロジェクトルート: `/home/glorydays/projects/src/ruby/redmine-all/plugins/redmine_kanban`
参照元: `/mnt/c/Users/glory/.codex/attachments/3e9c9298-671b-4c8b-8378-655713bb5921/pasted-text-1.txt`
実装対象: `BoardFreshnessAuthority` registry、通常／bulk reconciliation、snapshot invalidation、およびconcurrency/resource tests

## 依頼と参照元の要約

`BoardFreshnessAuthority` のcanonical ownerをregistryへ統一し、Authorityをhook render lifetimeで保持せずrequest開始時に取得して終了時にreleaseする。Product変更前にsplit-brainを再現する失敗テストを追加し、normal、aggregate、bulk、invalidateの全経路とresource lifecycleを検証する。

## 記録方針

このファイルには、参照元に明記されていなかった実装中の判断、変更、妥協点、仕様解釈、未解決事項、検証上の制約を記録する。

## 判断一覧

### D-001 既存registry APIを維持してcall siteのownershipを修正する

- 種別: 解釈
- タイミング: 実装前
- 参照元に書かれていたこと: Authorityはrequest開始時にregistryから取得し、finish/releaseまで同一instanceで完結させる。必要な場合のみlifecycle helperを検討する。
- 参照元に書かれていなかったこと: request handle用の新しい公開型・helperを必須とするか。
- 判断: まず既存の `getBoardFreshnessAuthority`／`releaseBoardFreshnessAuthority` APIを維持し、各requestで局所変数としてAuthorityを取得する最小変更を採用する。
- 理由: 既存APIがrequest-scoped ownershipに必要な機能を満たし、新しい抽象化なしでsplit-brainの根本原因を除去できるため。
- 代替案: `{ authority, request }` handleを生成する共通helperを追加する。
- 影響: 公開APIとreducer/backend contractを変えずにcall siteとテストへ変更を限定する。
- 可逆性: 高。重複が高リスクと判明した場合は後からhelperへ集約できる。
- 制約: 任意判断
- ユーザー確認: 事後報告

### D-002 invalidation直後にidentity-safe releaseを行う

- 種別: 解釈
- タイミング: 実装中
- 参照元に書かれていたこと: invalidateはpending requestを失効させ、active requestがないAuthorityをregistryへ残さない。active/idle双方をテストする。
- 参照元に書かれていなかったこと: `invalidate()` がactive request集合をclearした直後の具体的なrelease順序。
- 判断: registryから取得したAuthorityを `invalidate()` し、直後に既存のidentity check付き `releaseBoardFreshnessAuthority()` へ渡してからquery resetを開始する。
- 理由: old tokenはlocal Authority上のgeneration差で拒否され、registry entryはactive集合clear後に削除できる。old requestのfinallyが後から新Authorityを削除することもidentity checkで防げるため。
- 代替案: reset完了後にreleaseする、activeだったAuthorityをregistryに残す。
- 影響: idle leakを除去しつつ、pending response invalidationを維持する。
- 可逆性: 高。順序は単一関数内で変更可能。
- 制約: 制約により必須
- ユーザー確認: 事後報告

### D-003 失敗再現ではEntity DTO identityを保持する

- 種別: 技術制約
- タイミング: 実装中
- 参照元に書かれていたこと: rerenderなしのrequest 2とauthoritative reset後にstale responseがstateを破壊する失敗を確認する。
- 参照元に書かれていなかったこと: 既存negative freshnessの `JSON.stringify(issue)` snapshot防御とownership invalidationをテスト上でどう分離するか。
- 判断: request 2開始時のcacheをそのままauthoritative snapshotの基礎にし、columnsだけを変更してEntity JSON snapshotを一致させる。
- 理由: DTOを作り直すと構造差により既存negative freshness防御が先に働き、split-brain反例を検出できないため。
- 代替案: positive responseで高いrevisionを返す。
- 影響: テスト失敗原因をAuthority split-brainのみに限定する。
- 可逆性: 高。
- 制約: 制約により必須
- ユーザー確認: 不要

### D-004 frontend testの一時ディレクトリをWSL `/tmp` へ限定する

- 種別: 検証制約
- タイミング: 検証中
- 参照元に書かれていたこと: frontend full gateをgreenにする。
- 参照元に書かれていなかったこと: 現在のshell環境ではNodeの既定temp pathが存在しないWindows pathを指している。
- 判断: test実行時だけ `TMPDIR`／`TEMP`／`TMP` を `/tmp` に設定する。
- 理由: 初回Vitestはtest読込前にWindows temp pathへの `mkdir` で失敗し、Product/test failureを判定できなかったため。
- 代替案: Windows側temp directoryを作成する。
- 影響: test processの一時ファイル配置だけを変更し、repositoryやProduct behaviorへ影響しない。
- 可逆性: 高。
- 制約: 一時対応
- ユーザー確認: 事後報告

### D-005 最終SHA GitHub Actionsは未確認としてrelease blockerに残す

- 種別: 検証制約
- タイミング: 実装後
- 参照元に書かれていたこと: commit／push／PRは行わず、最終commit SHAのGitHub Actions greenまで確認する。
- 参照元に書かれていなかったこと: 未commit差分に対応するGitHub Actions SHAをどう生成するか。
- 判断: 外部write禁止を優先し、commit/pushは行わない。baseline `a6b839dbe4e3bc0439cbb28f62626485170e186e` のGitHub combined status、Checks API、branch workflow runをread-only確認し、全て0件だった事実を記録する。
- 理由: GitHub Actionsはcommit SHAなしでは実行・確認できず、SHA生成やremote反映は明示的禁止事項に反するため。
- 代替案: commit/pushしてworkflowを起動する（禁止）、local-only greenをCI greenとみなす（完了条件違反）。
- 影響: 実装とlocal/matrix検証は完了したが、仕様上はmerge/release不可のまま。
- 可逆性: 高。別途authorized commit/push後にActionsを確認できる。
- 制約: 制約により必須
- ユーザー確認: 確認済み（後続指示でcommit/pushを明示許可）

### D-006 後続の明示指示によりcommit/push禁止を解除する

- 種別: 変更
- タイミング: 実装後
- 参照元に書かれていたこと: 当初仕様ではcommit/pushを行わない。
- 参照元に書かれていなかったこと: 最終SHA CI blocker解消のための後続承認。
- 判断: ユーザーの「コミット、プッシュして」という明示指示を最新の権限として扱い、今回の7ファイルだけをcommitして `review-20260809` へpushする。
- 理由: 変更後SHAを生成してGitHub Actionsを確認する唯一の手段であり、commitとpushの双方が明示的に許可されたため。
- 代替案: blockerを維持する。
- 影響: remote branchが更新され、GitHub Actions確認が可能になる。
- 可逆性: 中。remote履歴へcommitが追加される。
- 制約: ユーザーの明示承認により実行
- ユーザー確認: 確認済み

## 変更・逸脱

Product/API/Backend仕様からの逸脱はなし。検証順序では、既存dev Composeがproduction DB設定のみだったため、その環境を使わずCI定義と同じ専用一時stackを固有project名で起動した。当初のcommit/push禁止は後続の明示指示により解除された。

## 妥協点と残課題

実装差分に対応するcommit SHAが存在しないため、GitHub Actions greenの確認だけが残る。baseline branch HEAD `a6b839dbe4e3bc0439cbb28f62626485170e186e` はcombined status 0件、check runs 0件、branch workflow runs 0件だった。commit/pushを許可する別workflowなしでは解消できない。

## 検証と制約

- 実行した検証: 実装前HEAD／branch確認、CodeGraph ownership確認、Product変更前deterministic Red、targeted Vitest、frontend typecheck、lint、Vitest 297件、production build、Redmine 7.0/MariaDB Ruby full 88件・507 assertions、snapshot gate 40件・354 assertions、PostgreSQL 16 unit 14件・198 assertions、focused API 5件・37 assertions、Redmine 7.0 E2E 4件＋native 2件＋large-data 1件、Redmine 6.1 E2E 4件＋native 2件、Redmine 6.0 compatibility 2件、`git diff --check`、GitHub baseline status/checks/workflow read-only確認。
- 実行できなかった検証: 実装差分の最終commit SHAに対するGitHub Actions。commit/push禁止により対象SHAが存在しない。

## 結果

Authorityをnormal、aggregate、bulkの各request開始時にregistryから取得し、finallyでfinish/releaseする構造へ統一した。snapshot invalidationもinvalidate後にidentity-safe releaseし、idle registry entryを残さない。deterministic split-brain/resource testsと全local/DB/E2E matrixはgreen。最終SHA GitHub Actionsだけは未確認のため、merge/release不可条件は残る。

## 完了条件監査

| 要件 | 証拠 | 判定 |
| --- | --- | --- |
| Registry canonical ownership / no render-lifetime capture | `useKanbanActions.ts` と `useBulkSubtaskMutation.ts` のlookupは各request開始直前のみ。全lookup/release siteを再検索済み。 | 達成 |
| Released Authorityを後続requestが再利用しない | mounted hookの同一callbackでrequest 1 release後にrequest 2を開始するpositive／negative deterministic tests。 | 達成 |
| Active request invalidate / native authoritative reset | pre-reset entity、counts、bulk follow-up、native mutation E2E。 | 達成 |
| Idle Authority / completed historyを保持しない | idle invalidation test、single-key release test、32個のsequential query-key resource test。 | 達成 |
| stale target / non-target positive / stale missing / latest counts | `asyncFreshness.repro.test.tsx` の各独立test。 | 達成 |
| Scope race / rollback / differential state machine | scope-A→B test、`useIssueMutation.test.tsx` overlapping rollback tests、production differential state-machine tests。 | 達成 |
| Normalとbulkのownership統一 | normal entity/countsとbulk entity/countsの全4 call site、およびbulk authoritative invalidation test。 | 達成 |
| Contract v3 / Backend・DB・pagination不変 | Backend変更なし、Contract v3定義を再検索、MariaDB/PostgreSQL/Redmine 7.0・6.1・6.0 matrix green。 | 達成 |
| Frontend full gate / generated asset | typecheck、lint、Vitest 297件、production build green。 | 達成 |
| 最終commit SHA GitHub Actions green | 未commit差分のSHAなし。remote baseline SHAにはstatus/check/workflow runが0件。 | **未達・release blocker** |
