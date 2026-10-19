# Task 0963: One refused or failed upload fails only its own row, and says why

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0961
**Blocks**: None

## Overview

SLN-1388 (findings/malformed-ebooks.md 2 and 3, findings/background-jobs.md B1). Any failed upload job quiesced the supervisor, so one PNG renamed `.epub` stopped the whole upload service, and the item said only "Needs attention". A damaged, DRM or password file got a page-level "retained for review" and a Preview that refused every time.

## Implementation Details

- `upload/supervisor.ts`: a job that fails while the service is still ready and its abort came only from a cancel (a refusal, a crashed or non-zero inspector, a failed publication, a lost create response) records the item's failure with its reason and no longer quiesces. The existing finally still proves the inspector's exit, removes scratch and persists the cleanup proof; if any of that fails the service is blocked as before. Lost ownership or lease, a deadline, or a stop still quiesce the service. It then throws `UploadItemFailed`.
- `upload/dispatcher.ts`: `UploadItemFailed` is logged through `onItemFailure` and the next job is scheduled; anything else still stops the service.
- `upload/worker-entry.ts`: a source that is not an e-book is a report (`refusal: {reason: "not_an_ebook", what}`), not a crash. `published-inspection.ts` checks its binding and throws `UploadItemRefusal`. An inspector image built before this change still crashes on it, which is now an item failure ("couldn't be checked").
- `upload/store.ts`: `jobFailureV1` carries `reason` and `what`.
- `upload-core/store.ts`: a failed item's row says "Not added: not an e-book (PNG image)." (refused: no Try again) or "Not added: the file couldn't be checked. Try again, or cancel it."
- `upload-core/refusal.ts` (new): a checked file that can't be added says "Not added: the file is locked with a password." (or the named DRM), "Not added: damaged PDF: …", or that Durtal can't check the format. `service.ts` puts it on the item's row with `refused: true`; prepare's 409 uses the same words.
- `upload-workbench.tsx`: a refused row shows "Checked", its reason and Cancel, never Preview, Try again or the automatic add. A chosen file whose first bytes say it is not an e-book (the server's own `sniffFormat`; zips left to the server) is refused before sending. Past two minutes without a ready service, "restarting" becomes "Uploads are stopped on the server".

## Completion Notes

- Tests: supervisor (per-item failure keeps the service ready and a second job works; non-zero exit; cancel; unproved exit still blocks; lost lease still quiesces), decoder refusal binding, dispatcher carry-on, row messages, quarantine wording, workbench rows, browser refusal and the stopped wording.
- Not done here: a real inspector run (the image can't build in the cloud container), and the cover-budget ticket filed with this one.
