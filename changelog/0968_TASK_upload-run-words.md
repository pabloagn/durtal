# Task 0968: Upload runs say what they wait on, and count their files

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: 0961, 0963, 0964
**Blocks**: None

## Overview
Four rough edges of browser-upload runs, from the reviews of the upload refusal and run settle changes (SLN-1467):

1. A failed file that nobody retried kept its run "Running" with no word why.
2. A finished upload run read "Nothing to do", because upload runs keep no counts.
3. A missing inspector image failed every check one by one, and the service kept going, so it never read as an outage.
4. One upload whose stored check couldn't be read made its whole batch fail to show.

## Implementation Details
- **Counts** (`src/lib/ebooks/runs.ts`). An upload run's `counts` stay empty: its batch registration checks `r.counts='{}'`. `listRuns` and `getRun` count an upload run's files where they are instead, in one grouped query per page: added (a committed confirmation, as the run settle reads it), canceled, expired, failed, and waiting. They also return the run's batch id. `run-text.ts` names the new keys, so a settled run reads, for example, "3 added · 1 canceled", on the runs list and on the run's page.
- **Waiting** (`run-text.ts`, run page). `uploadWaitingLine` says "Waiting on 1 failed file: retry or cancel it." once only failed files are open, and the run page shows it, with "Open the upload" linking to `/ebooks/upload?batch=<id>`, in place of the "counts refresh" line.
- **Outage** (`src/lib/ebooks/upload/dispatcher.ts`, `job-failure.ts`). The dispatcher counts checks that fail in a row. A refusal or a published file starts the count again; a check someone canceled leaves it as it is (`UploadItemFailed.canceled`, set by the supervisor). The third failure throws `UploadChecksFailing`, which stops the service like any other service failure, so the app says the service is not running; the launchd agent starts it again a minute later.
- **Unreadable check** (`src/lib/ebooks/upload-core/refusal.ts`). `checkedItemView` reads a checked file's stored inspection and, when it can't, shows that row as refused with "Not added: Durtal can't read this file's check. Cancel it and upload the file again." The other rows still show. A retry is only offered for a failed check, so the row offers Cancel.

## Completion Notes
- Tests: `run-text.test.ts` (counts and the waiting line), `upload-run-settle.test.ts` (a database test of the counts through `getRun` and `listRuns`, before and after the run settles), `upload-dispatcher.test.ts` (three failures in a row stop the service; a refusal, a published file, a cancel and an idle turn), `item-refusal.test.ts` (an unreadable check, and rows left alone). Each new test fails with the change taken out.
- No migration, no new package.
