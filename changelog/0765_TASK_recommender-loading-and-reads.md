# Task 0765: A recommender shows a loading screen, and its reads run together

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0613
**Blocks**: None

## Overview

SLN-817, from the third loading and error states survey
(`findings/survey-loading-3-2026-10-15.md`, item 2).
- A click on a recommender kept the last page, with no sign, until theirs
  arrived. Every other record page has a loading screen.
- The page read the recommender, then their books' eBooks, then the
  recommender stats, one after another. The stats need nothing from the
  other two reads.

## Implementation Details

- **`recommenders/[id]/loading.tsx`** (new) draws the page's layout:
  - the way back;
  - the name, with the star and menu at the row's end;
  - the count line;
  - the Books heading, the "Showing" line and the grid of covers.
  Below a 22rem row, as on a 320px phone, the star and menu go under the name,
  as they do on the page for a person's name.
- **`recommenders/[id]/layout.tsx`** checks that the recommender exists before
  the loading screen starts the response, through `liveRecord` and the new
  `recommenderExists` (`src/lib/catalogue/record-exists.ts`):
  - A missing recommender still answers 404.
  - A merged one still opens the one it was merged into.
- **`recommenders/[id]/page.tsx`**:
  - **Reads.** The stats read starts first and runs beside the recommender and
    their books' eBooks, so the page waits for two reads in a row, not three.
  - **Header.** It is drawn with `DetailTitleRow`, as a series is:
    - The star and menu go under a name that is too long for them. Before,
      they went under the whole block of name and counts.
    - The way back is `BackLink`, the same markup as before.
    - The controls take the row's own type, not `DetailControls`. Beside a
      short name on a phone under 375px the name steps down a size, while
      `DetailControls` keeps the full size, which put them 2.4px off its cap
      height. No other page shows its controls beside a title at that width.
  - **Count line.** It is 24px tall with or without a website, so the loading
    screen can draw it.
- **Tests**:
  - `not-found-status.test.ts` lists the recommender among the pages under a
    loading screen.
  - `loading-pass-2.test.ts` checks the screen's label and way back.
  - `record-exists.test.ts` finds a recommender by id in either case, and
    nothing else.

## Completion Notes

- **Timing.** I compared main with this change on a production preview, each
  database query delayed by the given time. The figures are medians of 7
  runs in Chromium, from a click on the recommender list, and from opening
  the address directly.

  | Delay per query | | Click: loading screen | Click: page | Open: first byte | Open: page |
  |---|---|---|---|---|---|
  | 0 ms | main | never | 230 ms | 298 ms | 434 ms |
  | 0 ms | change | 159 ms | 229 ms | 116 ms | 474 ms |
  | 40 ms | main | never | 317 ms | 398 ms | 513 ms |
  | 40 ms | change | 157 ms | 485 ms | 139 ms | 512 ms |
  | 200 ms | main | never | 775 ms | 712 ms | 830 ms |
  | 200 ms | change | 134 ms | 590 ms | 276 ms | 720 ms |

  - The query log confirms that the reads run in two rounds, not three.
  - At 40 ms the page itself shows about 160 ms later after a click. The data
    is ready at about 230 ms, but React keeps a loading screen up for at
    least 300 ms once it has shown, so the page arrives at about 450 ms.
    Every loading screen in the app does the same.
  - At 200 ms the page shows 185 ms sooner, and something shows at once.
- **The loading screen against the page.** I compared them in Chromium,
  Firefox and WebKit at 1440, 390 and 320.
  - The way back, the name, the star and menu, and the count line sit where
    the page puts them at every width.
  - At 1440 everything below matches too.
  - On a phone, a recommender with a website, reads and ratings has a count
    line that wraps to more lines, which moves what is below it. No loading
    screen can know that.
- **Audits.** The alignment, touch and design audits report nothing on the
  page and on its loading screen, in all three browsers at all three widths.
  This was checked for a short name, a long name, and a recommender with no
  books. Before the header change, the star and menu sat 2.4px off a short
  name at 320, in all three browsers.
- **Other.**
  - A missing recommender answers 404, and an address that is not an id
    answers 404.
  - Typecheck is clean, and the tests above pass.
  - No migration, no new package.
