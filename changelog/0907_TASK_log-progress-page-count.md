# Task 0907: Log progress asks for the page count instead of promising pages it won't count

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1095, from item 4 of `findings/settings-export-survey-2026-10-18.md`.

On a book whose edition has no page count, Log progress said "Page 120 · 120
pages since last time" and saved a session that counts no pages. That is the
counting rule (`countedPagesSql`: a session without a page total counts
nothing), and the rule stays. The dialog now matches it.

## Implementation Details

- **The line** (`logPreview`, `src/lib/reading/log-preview.ts`): "N pages
  since last time" shows only when the log has a page total. Without one the
  line reads "Page 120".
- **The field** (`log-progress-dialog.tsx`):
  - When a page is logged ("120", "p 120", "+20", or the Page field on a
    touch screen) on a reading with no page total, the dialog shows "Pages in
    this edition (optional)", or "Pages in this book" for a reading with no
    edition. `asksPageTotal` decides when.
  - It is not shown for a sitting in another edition, when "212/480" already
    gives the count, or while stopping the timer.
  - With a count, the line becomes "Page 120 of 300 · 40% · 120 pages since
    last time". A count below the page, or one that isn't a whole number,
    is refused before saving, in the words the server and Edit reading use.
  - On Log, the count is saved to the edition when it has none, then to the
    reading (as "212/480" already did), then the session is logged against
    it.
- **Why the field and not a link.** The field fits the dialog on a phone: at
  390 and 320 it is one full-width row, and the footer stays in view. It also
  makes this log count, which a link to the edition could not.

## Completion Notes

- **Browsers.** Checked on a private preview, on books whose edition has no
  page count, after starting a reading from the book page:
  - Chromium, Firefox and WebKit at 1440, Chromium and WebKit at 390 with
    touch, Chromium at 320 with touch, and Firefox at 320.
  - Every run shows "Page 120" before the count and "Page 120 of 300 · 40% ·
    120 pages since last time" after it. Nothing scrolls sideways, and there
    are no page errors.
  - The sessions export gives each of those sessions `pages_counted` 120,
    and the edition and the reading have 300 pages.
- **Audits.** The browser audit passes 18 of 18 loads: the book page and
  `/reading`, in three browsers at 1440, 390 and 320. Page weight passes
  every route.
- **Tests**:
  - `reading/book-page-labels`: the line with and without a page total, and
    when `asksPageTotal` asks.
  - `ui/reading-dialogs`: the field with a mouse and with touch, its two
    refusals, and the order of the saves. A log with no count leaves the
    book alone.
