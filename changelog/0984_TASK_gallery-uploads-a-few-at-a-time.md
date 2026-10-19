# Task 0984: Gallery uploads go a few at a time, with Cancel and a leave warning

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1461. A gallery drop sent every photo at once: `UploadZone` started `processFile` for each file together. Thirty 12-megapixel photos grew the server process by 1.1 GB, and on the Mac that is the live process. Nothing could stop a drop, and a reload six seconds in silently lost 22 of 30 photos.

## Implementation Details

- New `src/lib/utils/upload-queue.ts`: `createUploadQueue` sends `UPLOADS_AT_ONCE` (2) at a time and starts the next as each finishes, whether it succeeded or failed. `cancel()` drops the uploads not yet started and returns their ids; the ones being sent finish.
- The queue asks before the page is left or reloaded while anything waits or is being sent, and stops asking once it is empty. The listener belongs to the queue, not the drop zone, so it still holds after the media dialog closes with uploads under way.
- `src/components/media/upload-zone.tsx`: dropped files, chosen files and dragged URLs all go through the queue. A waiting photo's row says "Waiting". While any wait, a line says "2 sending, 6 waiting" with Cancel. After Cancel the zone says "Cancelled. Finishing the 2 images already sending…", then "Cancelled. 8 images added, 22 not sent." A new drop clears the note and counts afresh.
- After Cancel the focus moves to the "Cancelled…" note, since Cancel itself goes away (Fifth reviewer).
- The page has one queue (`pageUploadQueue`): a drop zone closed and reopened while photos are sending waits its turn instead of sending two more at once (Fifth reviewer).
- Refused files are still said at once and never queued. The per-image decode cap stays with SLN-1366.

## Completion Notes

- `src/__tests__/ui/upload-queue.test.ts`, 8 tests (the focus after Cancel and a reopened drop zone added after review): two at a time with the next starting as each finishes; the leave warning while pending and not after; Cancel after six of thirty gives "8 images added, 22 not sent" and calls `onUploadComplete` 8 times; a failed photo says why and the rest still go; a new drop counts afresh; the queue keeps sending and warning after the zone closes; `cancel` returns what was waiting. Four of them fail against the old zone.
- Headless Chromium, Firefox and WebKit at 1440 (mouse), 390 and 320 (touch), on a production build with a disposable database and local file storage: 30 photos of 3000×2000 chosen in the gallery tab show "2 sending, 28 waiting" with 28 "Waiting" rows; leaving asks first; Cancel shows "Cancelled. Finishing the 2 images already sending…", then, for example, "Cancelled. 6 images added, 24 not sent." In all nine runs the database held exactly the number the note gave (6 to 19), and leaving no longer asks. Measured by response, at most 2 uploads were in flight at once. Escape closes the dialog. Alignment audit empty while sending and after Cancel; no sideways scroll.
- After review, again in all three engines at 1440, 390 and 320, choosing through the file picker. Cancel by keyboard (mouse widths) or tap (touch) leaves the focus on the "Cancelled…" note while the last images send and after.
- Ten photos dropped, the dialog closed with Escape and reopened, then four more dropped: still at most 2 in flight, and all fourteen arrive.
- Page weight: every route passes.
