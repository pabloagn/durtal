# Task 0639: Damaged and locked eBooks say why

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0638
**Blocks**: None

## Overview

SLN-685, from the e-book review of 13 Oct. A damaged file looked healthy on its
e-book page until opened, and the reader then offered a Retry that could never
work. A DRM file was named only by a code in the files table. The reader kept
its whole toolbar over an error, and e-book addresses that named nothing led
to unrelated pages. Now:

- When the reader cannot open a file, it records why, and the e-book page says
  "This EPUB file is damaged · Replace file…" beside any other format to read.
  The record goes when the file next opens.
- A DRM file is named in plain words on the e-book page and in the reader:
  "This file is locked with Adobe DRM; Durtal can't open it. Replace it with a
  DRM-free copy."
- A reader error keeps only Back and the title in the bar, and no bottom bar.
  Retry is a secondary button, offered only where opening again can help (the
  connection, an expired link, a reader feature); a damaged or locked file
  offers Replace file… instead.
- `/ebooks/<unknown>` shows "eBook not found" with Back to eBooks, and the
  reader's not-found leads to /ebooks too. `/ebooks/runs` is titled Ingestion
  runs under an eBooks link, and an unknown run says "Run not found".
  `/reader/offline` with no book asks for one.

## Implementation Details

- No migration, as the coordinator chose: the failure is kept as
  `ebook_files.metadata.openFailure` (`{ reason, at }`), and the file's
  `status` and `updated_at` do not change, so Retry and downloads still work.
  - `src/lib/ebooks/open-failure.ts`: `openFailureOf()`, `recordOpenFailure()`
    (only stored or verified files with no DRM; the reason cut at 300
    characters) and `clearOpenFailure()`.
  - `POST` and `DELETE /api/ebooks/files/[fileId]/open-failure`, same-origin
    through `src/proxy.ts`.
  - The engine's `error` event carries `cause`, the file's own error, only
    when the file itself failed to open (`engines/foliate/engine.ts`); the
    reader records it for a damaged file. A reader page whose file has a
    record (`openFailed`) clears it once the book opens.
- `src/lib/ebooks/locked-file.ts`: `lockName()` and `lockedFileMessage()`.
  `readReaderBook()` returns `locked`, a DRM file, when the e-book has
  nothing else to read.
- `reader-view.tsx`: an error says whether Retry can help and which file to
  replace; `ReaderToolbar` takes `backOnly`. `open-error.tsx`: Retry is
  secondary, Replace file… is added, and Back alone starts on the text's edge.
- E-book page: the damaged or locked notice under the author line; the files
  table says "Damaged: did not open on <date>" and "Locked with Adobe DRM".
- New `ebooks/not-found.tsx` and `ebooks/runs/not-found.tsx` (an unknown run
  would otherwise have read as a missing eBook); the run page's tab title
  follows.
- Docs: `02_DATA_MODEL.md` (`metadata.openFailure`), `05_API_REFERENCE.md`
  (the new route).

## Completion Notes

- Preview with the fixtures' damaged EPUB (012) and Adobe DRM EPUB (013):
  - Opening 012 shows the error with Replace file… and Back, no Retry, and
    only Back in the bar; its e-book page then says the EPUB is damaged. The
    stored record was "End of central directory not found".
  - A record put on Against Nature's EPUB showed the notice beside "Read the
    PDF"; opening the book cleared it.
  - 013 names Adobe DRM in the reader and on its page, with Replace file….
- Chromium, WebKit and Firefox at 1440, 390 and 320 on the reader's errors for
  012 and 013, both e-book pages, `/ebooks/<unknown>`, `/reader/<unknown>`,
  `/ebooks/runs`, an unknown run and `/reader/offline`: 81 of 81 with 0
  alignment, design-audit, overflow and touch findings.
- `reader-engine-check.mjs` 284 of 284; `page-weight.js` within budget.
- Tests: `reader-view.test.ts` (a damaged file offers no Retry, its
  replacement and only Back, and is recorded; a network failure offers a
  secondary Retry and records nothing; an open clears a record);
  `open-failure.test.ts`; `ebook-delivery.test.ts` (the route on PostgreSQL:
  status, `updated_at` and metadata kept, still served, the 300-character
  cut, refusals); `reader-core.test.ts` (`locked`); `error-views.test.ts`.
- No migration and no new packages.
