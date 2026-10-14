# Task 0512: eBook uploads, part 1: ways in, a page that unlocks, and plain words

**Status**: In Progress
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-672, from the e-book review of 13 Oct. Nothing linked to the upload
page, and nothing could build a replace link. One refused request locked the
page in that browser for good. A finished upload led nowhere. Every file
needed Preview then Confirm. The page read like a protocol log, with MiB
sizes and the browser's own progress bar.

## Implementation Details

- Ways in:
  - /ebooks: an "Upload eBooks" button in the header and the first item of
    its Actions menu;
  - the eBook page: "Add a format…" on the Files heading, and "Replace
    file…" on each file row.
- The upload page (`src/app/(catalogue)/ebooks/upload/page.tsx`) reads the
  eBook it changes (`readUploadTargetSummary`,
  `src/lib/ebooks/upload/target-summary.ts`): the fingerprint the server
  checks at preview, its title, and the file a replacement takes the place
  of. So links need only the eBook and the file, and the page names them
  ("Replaces the EPUB (62 KB) of “The Distant Orchard”").
- The page says up front when the server runs without the upload service
  (`uploadsAvailable`, `src/lib/ebooks/upload/availability.ts`), and Choose
  files and Start upload stay off.
- A saved request (`browser-client.ts`):
  - a refusal the server will repeat (4xx other than 408 and 429, or 503) is
    an `UploadHttpError` that clears it, so the page unlocks;
  - a lost answer stays saved, with "Send it again" and "Discard request".
- The workbench (`upload-workbench.tsx`):
  - an added file links to Open eBook, Read and, when it is a new eBook,
    "Link to a book…" (the eBook page's book section, `#book`);
  - "Preview all" and "Confirm all" when several files are ready or
    previewed;
  - Resume sends a file chosen on this page again without choosing it twice;
    otherwise "Choose the file again" opens the picker. A different file
    (`UploadFileMismatch`) is forgotten;
  - a progress bar in the theme's colours, red when the file failed;
  - KB, MB and GB like the rest of Durtal, state labels that say what
    happened, plain messages ("Paused. Choose Resume to carry on.") and no
    schema dump; Pause and Start another upload share a spaced row; a
    styled file button replaces the browser's input.
- The previews say what they do in plain words (`upload-core/plans.ts`).

## Completion Notes

- Unit tests: the refusal that unlocks, Discard, uploads off, the finished
  file's links, and Preview all then Confirm all. A database test checks the
  page's fingerprint against the server's, a file of another eBook, and a
  change to the eBook.
- Checked headless in Chromium, Firefox and WebKit at 1440, 390 and 320 px,
  with the upload API answered by a mock (the service cannot run in the
  cloud): the entry points, the replace page naming its file, a bad link,
  and a batch with a sending, two ready, a failed and an added file. The
  alignment, design and overflow audits are clean on /ebooks, the eBook
  page, the upload page, the replace page and the batch, with previews open.
- Not done here (part 2): Cancel while a file is sending (it stays off until
  Pause), registering automatically when a preview has no conflicts, and
  one real upload from the iPhone on the Mac.
