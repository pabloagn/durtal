# Task 0585: eBook uploads, part 2: Cancel while sending, and files added on their own

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0512
**Blocks**: None

## Overview

SLN-672 leftovers from 0512 ("Not done here"): Cancel stayed off while a
file was sending (only Pause worked), and every file still needed Preview
then Confirm, even when nothing needed a decision.

## Implementation Details

- **Cancel while sending** (`upload-workbench.tsx`): the file being sent
  keeps its "Cancel upload" on. It stops the parts in flight (the same
  abort as Pause), then sends the cancel. A Cancel pressed while the last
  answer is on its way still cancels the file. Each file of a batch has its
  own abort, so canceling one goes on to the next file; Pause still stops
  them all. The server's answer now reads "Upload canceled." rather than
  "Retained bytes remain reserved until verified cleanup."
- **Added on its own**: a file sent from this page is previewed and
  confirmed by the page once the server has checked it. These are the same
  two requests as by hand, with the same preview check. When the preview is
  refused (the file is already in the library, a format clash), the page
  says why and the file waits with Preview. A replacement always waits for
  its Confirm. The page and the Choose files text say which.
- **A file already in the library** (review): the preview refused it as an
  uncertain answer ("The upload response is uncertain..."), which the page
  would now show after every duplicate upload. `planUploadRegistrationOn`
  (`ingest/upload-atomic.ts`) now refuses it as `upload_already_stored`
  (409), "This exact file is already in the library.", and the file waits
  with Preview, as for any other refusal.
- **The server's worker is busy**: the preview is refused while the upload
  worker checks or receives another file (`upload_not_settled`). The page
  then tries again on later refreshes, about a minute in all, then leaves
  the file waiting with Preview. `UploadHttpError` now carries the server's
  `code` for this.
- **"Checking the file" until it is checked**: a received file showed as
  "Received, ready to preview" before its check had run, and Preview then
  failed. The item view (`viewedUploadState`, upload-core `store.ts`) shows
  it as being checked until the inspection receipt exists. Only the view
  changes; the server's own state checks read the row.

## Completion Notes

- Tests: `upload-workbench` (Cancel while sending stops the part and sends
  only the cancel; a sent file is previewed and confirmed once checked; a
  busy worker is tried again and a refused file waits with Preview; a
  replacement waits for Confirm), `viewed-state`, and `ebook-upload-target`
  (a file already in the library is refused in plain words).
- `pnpm test:local` passes the upload suites (23 files, 213 tests).
- The upload page and a batch with a file being checked, one ready, one
  canceled and one sending (upload API mocked): the alignment, design,
  overflow and touch audits are clean in Chromium at 1440, 768, 390 and 320
  and in Firefox and WebKit at 1440 and 390. Page weight passes.
- Not covered: one real upload from the iPhone on the Mac. The upload
  service cannot run in the cloud, so the page was checked against a mocked
  upload API, as in 0512.
- No migration and no new packages.
