# Task 0481: Import existing

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0480 (Calibre library snapshot), SLN-495 (matching)
**Blocks**: SLN-658 (differences and personal data), SLN-498 (the load)

## Overview

SLN-657, mode A of the two modes Joris asked for on 13 Oct 2026. Of the
Calibre books, find the ones already among Durtal's books and give them their
e-books, and nothing else. Import existing never creates a work, an author, a
series or a publisher. Every other Calibre book is left untouched for Bulk
import (SLN-659).

## Implementation Details

- `src/lib/ebooks/calibre/import-existing.ts` is the dry run:
  - It scores every Calibre book from the snapshot against Durtal's book
    works with `MATCH_MODEL` version 1, before any file is read.
  - A book is in scope when its tier is `exact`, `strong`, `likely`,
    `to_choose` or `conflict` with a Durtal book as a candidate.
  - Only books in scope are checked on the drive: each format's presence, and
    DRM by a quick look (`quickDrm`: an EPUB's `encryption.xml`, a Kindle
    file's header or KFX wrapper). Then they are scored again.
  - It writes the report, a CSV with one row per Calibre book, and a
    selection bound to the snapshot hash, the catalogue fingerprint and the
    model.
  - `planSelectionMatchingOn` plans the matching of the e-books a selection
    became, after the ingest.
- `src/lib/ebooks/calibre/selection.ts`: the selection's type, `readSelection`
  and `requireCurrentSelection`.
- `src/lib/ebooks/match/clashes.ts`: one book, one e-book. It only ever takes
  an automatic link away. The clashes are several e-books for one book, an
  e-book that scores for several books or is an omnibus, and a book that
  already has an e-book. `holdForReview` keeps in review a book that a wider
  look sent there.
- `scoreNewGroups`, `planGroupMatching` and `planRegisteredMatchingOn` take
  `ScoringOptions` (`oneEbookPerWork`, `holdForReview`). They are applied
  before the plan's fingerprints, so the frozen results, the sample and the
  apply all agree. The registered matching document records
  `oneEbookPerWork`.
- `planIngest` takes `select`: with `calibre`, only the selected books are
  planned. It refuses a selection from another snapshot, against a changed
  catalogue, or with another model. The plan and its report name the
  selection.
- Commands:
  - `pnpm ebooks:import-existing --calibre SNAPSHOT [<folder>]` is the dry
    run.
  - `pnpm ebooks:import-existing --match SELECTION` plans the matching after
    the ingest.
  - `pnpm ebooks:ingest --calibre SNAPSHOT --select SELECTION` plans the
    selection's ingest.
- The Calibre allowlist in `no-calibre.test.ts` adds the new script and its
  database suite.
- `docs/09_INGESTION_PIPELINE.md`: "Two modes: Import existing, then Bulk
  import".

## Completion Notes

- The database suite `src/__tests__/integration/ebook-import-existing.test.ts`
  runs on its own disposable database, with the bucket in memory. It covers
  13 Calibre books against 10 Durtal books:
  - exact, strong, conflict with a shared ISBN, an omnibus, two Calibre books
    for one book, a different-language edition, a digital copy waiting for
    its file, a DRM file, a file missing on the drive, `same_author` and
    `not_in_durtal`.
  - It checks the exact dry-run counts, the refusal of a stale selection,
    and the ingest of the selection alone, with a resume after an
    interruption.
  - The matching gives 3 automatic links and sends the rest to review. The
    labelled apply and its undo add no work, author, series or publisher. A
    second dry run and a second ingest write nothing, and the ingest's undo
    works.
- Unit tests cover the clashes (`clashes.test.ts`) and the quick DRM look.
- One deviation from the ticket's wording: inside the selection alone, an ISBN
  is no longer shared by books left out, so a book could link that the dry run
  sent to review. The selection therefore records each book's dry-run verdict,
  and the matching keeps those books in review.
- 6,000 synthetic Calibre books took about seven minutes to score. Durtal's
  books are therefore read in one read-only session, and the scoring runs
  after it closes, with progress on the terminal.
- The review queue's rows passed the audits only after two fixes in
  `review-row.tsx` and `review-view.tsx`. "· valid" and the flag line moved
  from `fg-muted` to `fg-secondary`, and the "Other identifiers", "N editions"
  and "Keyboard shortcuts" summaries are 44px tall on touch. Checked in
  Chrome, Firefox and WebKit at 1440, 768 and 390 px.
- From the review: a format whose path leads outside the library folder is
  reported as skipped, apart from a file missing on the drive. Durtal's books
  whose only Calibre e-book has no file to give are listed on their own, never
  among the books Calibre lacks. The database suite covers it with a symlink
  leading out of the library.
- No migration and no new package.
