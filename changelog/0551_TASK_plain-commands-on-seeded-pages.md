# Task 0551: The commands left on pages that had no data to audit

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: 0547 (SLN-693 part 3)
**Blocks**: None

## Overview

SLN-693 part 4, the last. Task 0547 listed about 30 ghost buttons outside dialogs that still had no icon. Their pages had no seeded data, so the layout audit could not measure them. This task gives those buttons an icon. It then seeds the data those pages need and runs the plain-command scan on them. The scan found 14 more links that read as text, and this task fixes them too.

## Implementation Details

Each new icon is a Lucide icon with `aria-hidden` and a 1.5px stroke.

- **Reading**:
  - The reading section:
    - Start timer (Timer) and Stop timer (Square);
    - Pause and Resume (Pause, Play);
    - Finish (Check);
    - the header's Log progress (PenLine) and Re-read (RotateCcw).
  - Other reading buttons:
    - the hub's Resume (Play);
    - the passage of the day's Another (Shuffle);
    - the session list's Add a session and the notes' Add a quote (Plus);
    - the hidden list's Undo and the import's Undo (Undo2).
  - "Read it again" (`start-again.tsx`) has the BookOpen icon. It pulls out by its full 10px padding (`-ml-2.5`); it was 2px short.
  - A long note's "Show all" is a text command.
- **Publishers**:
  - The name inbox:
    - Choose house (Search);
    - Create (Plus);
    - Not a publisher (Ban);
    - Undo (Undo2);
    - Restore (RotateCcw).
  - An acquisition's Record return (PackageX).
  - The edition's publisher links:
    - Edit or Link publisher (Link2);
    - Use automatic matching (WandSparkles).
- **E-books**:
  - Set aside (Archive) and Match again (RefreshCw);
  - Unlink… (Unlink);
  - the review selection's Clear (X);
  - Link eBook (Link2);
  - the upload's Discard request (Trash2).
- **Books**: the identify queue's No ISBN (Check) and Other sources (Search).
- **Shared**:
  - the series suggestions' Link (Link2);
  - the perfume source's Use the name and Use these (Check);
  - the selection toolbar's Select all (CheckCheck) and Deselect (X);
  - `ViewStatus`'s Retry (RefreshCw).
- **What the scan found on the seeded pages:**
  - Book titles in lists are links in fg-primary and change only on hover. They now sit in an `h3`, which names their row, as the dashboard tile's title has since 0547. Preflight keeps their type and box. This covers:
    - the hub's suggestions and paused rows;
    - Up next;
    - the journal;
    - /reading/suggestions and its hidden list.

    The journal's rows and the hub's paused rows had their controls (format, rating and menu; Resume) centred on the two-line row. A heading makes the row a title row, so those controls now sit on the title's first line in `CapAlignedControls`, as Up next's do. The line under the title now spans the row, and a phone row whose line used to wrap is 16px shorter.
  - These links and buttons are now text commands (`text-command`):
    - **Book page:**
      - the Series value;
      - the Orders group's Pipeline link;
      - "Show all" under a long notes list.
    - **/reading:** the passage of the day's book.
    - **/reading/stats:**
      - the book values (Longest, Fastest and the rest);
      - Most re-read;
      - every chart's "Show as table".
    - **e-book page:**
      - the breadcrumb;
      - the files table's Download, Open first and Replace file. These were in the accent colour, too close to the grey text around them (1.1:1).

  Where a touch layout was tuned, `pointer-coarse:my-0 pointer-coarse:py-0` keeps the old box: the stats re-read rows and the chart toggle, which keeps its 44px height.
- **Publisher name inbox**: each name's cover strip wraps, and on touch its covers sit 12px apart, each with a 44px press area (`touch-hit`). At 320px the strip of eight covers had made the page scroll 42px sideways, and each cover was a 32px-wide target.
- **Orders** under an acquisition target: the summary has a 44px press area on touch (`touch-hit`).
- **Design audit**: `visible()` skips the content of a closed `<details>`. Chromium keeps that content's boxes but gives it no text, so a named button in there (the target's Record return) was counted as unnamed.
- **Not changed**:
  - **Inside dialogs:** "Change choices" in the review confirmation, "Back to results" in Match again and the match preview, and the timer chip's Discard (a menu item). The audit skips dialogs. "Change choices" also sits beside a filled button.
  - **Beside Save:** a Cancel next to its Save.
  - **Reader file:** reader tracking.

## Completion Notes

Seed (preview only, `--seed-large 5 --seed-reader --ebooks 40 --seed-review`):

- `scripts/qa/reading-journey.sql`.
- Book fixtures, recommender fixtures, and a scratch SQL file. The scratch file adds:
  - a reading with a paused timer, four sessions and six quotes, under way and then paused;
  - a finished reading;
  - three hidden suggestions, the same three books in Up next;
  - an ignored publisher name;
  - a delivered order against a publisher target.

Checks on a production build of this branch with that seed:

- **Plain-command scan** (`layout-audit.js`), Chromium 1440 and 390: clean on 17 pages:
  - pages: /, /reading, its suggestions, next, notes, journal and stats; three book pages; /ebooks/review; /library/identify; /publishers/review; a publisher; /series/suggestions; two e-book pages.
  - The first run found 38 on the reading and book pages, and 3 on each e-book page.
- **Before and after** on the same data, Chromium and WebKit at 1440 and 390, every link, button, list item and paragraph on nine of these pages:
  - Nothing moved at 1440.
  - At 390, only the new text commands' boxes grew on touch, by the padding and negative margin of `text-command`; their text stayed put.
  - Page heights are unchanged.
- **Shared browser runner** (alignment, design, overflow, touch): 204 of 204 page loads pass, on those pages and /settings/reader, in Chromium, Firefox and WebKit at 1440, 768, 390 and 320.
- **`phone-audit --strict`**: the only new finding is /recommenders' first card at 490px, which is SLN-639.
- **page-weight**: every route passes.
- **Typecheck** passes, the UI tests pass (82 files) and lint has no new findings.
- **Journal and paused rows**, after moving their controls:
  - The alignment audit is clean with the controls on the title line. With them centred under the heading, it measured 10px off, and 20px on touch.
  - The runner passes 48 of 48 page loads on /, /reading, /reading/journal and /reading/year, and 18 of 18 with an 82-character title and a rated reading.
