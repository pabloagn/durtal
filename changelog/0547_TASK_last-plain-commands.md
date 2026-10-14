# Task 0547: The last commands that look like text

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: 0544 (SLN-693 part 2)
**Blocks**: None

## Overview

SLN-693 part 3. Part 2 left these commands looking like the text around them:

- Settings > Reader: ghost buttons with no icon ("Edit settings", "Refresh overrides", "Restore the default sources", "Clear history" and the rest of the page's ghost buttons);
- the dashboard tile's "Open eBook" and Log;
- the book page's "Recommended by" links;
- the /library/new step list and its Cancel;
- the dashboard tile's title, a link the audit could not tell from text.

From the #281 review, the taxonomy fields' Add button: on a film, perfume or painting with an empty field (and on a line its chips wrapped to), its icon started 6px in from the column (7px in Firefox and WebKit).

## Implementation Details

- **Settings > Reader** ghost buttons carry an icon:
  - Edit settings (Pencil);
  - Clear override and Restore the default sources (RotateCcw);
  - Refresh overrides, Try saving again and Try again (RefreshCw);
  - Clear history (Trash2);
  - Show 50 more (ChevronDown);
  - Previous and Next (chevrons);
  - a dictionary import's Cancel (X).
  - A lookup's book link is a text command instead of a bare underline.
- **Dashboard tile**:
  - "Open eBook" is a text command in a `text-xs` line, so the touch padding of `text-command` cannot move it.
  - Log has the PenLine icon.
  - The title link sits in an `h3`, which names the tile. Preflight leaves its type as it was.
- **Taxonomy Add** (`taxonomy-assignments.tsx`): the button pulls out by its own 6px padding (`-ml-1.5`). Its icon starts on the column edge when it starts a line, and 6px after the last chip otherwise, the same gap the chips keep between them.
- **Recommended by**: the links are text commands. `pointer-coarse:my-0` and the existing `pointer-coarse:py-3` keep the tuned touch layout, so the comma and the website icon stay on the name's first line.
- **/library/new steps**:
  - A done step is still a button. It shows its check and puts the text-command look on its label. The check's stroke is 1.5, not 2.
  - The step in view and the steps ahead are spans, because they are states, not commands. The step in view has `aria-current="step"`.
  - The wizard's Cancel has the X icon, and the confirm step's four Edit buttons have the pencil.
  - On the search step, the "Enter details manually" icon is `CapAligned` on the label's first line. At 320px the label wraps, and the icon sat 12px off between the two lines.

## Completion Notes

- **Layout audit, plain-command scan.** It runs in Chromium at 1440, 768 (touch), 390 and 320, Firefox at 1440 and 390, and WebKit at 1440 and 390.
  - Pages: the book page with recommenders, / with an e-book reading under way, /settings/reader, and /library/new on the Details step.
  - Result: none left.
- **Alignment and touch audits** (shared browser runner): 48 of 48 page loads pass. The runs cover Chromium, Firefox and WebKit at 1440, 768, 390 and 320, on /, /settings/reader, /library/new and the book page. The alignment audit also passes on the Details step.
- **`phone-audit --strict`**: run with recommenders and a reading tile seeded, it finds one new entry. /recommenders' first card is at 490px of 812. That is the SLN-639 list-header finding: the page had no card to measure before the recommender fixture, and this change does not touch it.
- **page-weight**: every route passes.
- **Recommended by**: before and after, every box and every line of ink is in the same place at 1440, 390 and 320. Only the underline is new.
- **Tile title**: wrapping the link in the `h3` leaves its box, type and the tile's height unchanged in Chromium, Firefox and WebKit.
- **"Open eBook"**: its ink is in the same place. The tile's text column is 1px shorter (1.5px in Firefox and WebKit), because the link is no longer an inline-flex box. On touch the link's target is 47px tall.
- **Step list**: every step is 26px tall on one row, in Chromium (1440, and 768 on touch), Firefox and WebKit.
- **Confirm step**: reached by walking the wizard. The alignment audit, the plain-command scan and the drift check are clean in Chromium (1440, 768, 390 and 320), Firefox and WebKit (1440 and 390).
- **Taxonomy Add**: on the seeded film, perfume and painting pages, an Add that starts a line has its icon 0px from the column (6px before). After a chip it is 6px from it (12px before). Chromium, Firefox and WebKit, 1440 and 390. The shared runner passes 84 of 84 page loads on those pages, the book page, /library/new, / and /settings/reader at 1440, 768, 390 and 320.
- `pnpm test:local`: 644 files, 7000 tests passed. It ran before the confirm-step and taxonomy edits; after them, typecheck and the 78 UI test files (490 tests) pass.

**Still open under SLN-693.** A code scan finds about 30 more ghost buttons with no icon outside dialogs. The audit has no seeded data on their pages, and some sit beside a filled button, which the audit allows:

- reading: the reading section's timer, pause, finish and re-read buttons, Resume, "Another", Undo and "Read it again" (whose `-ml-2` is 2px short of its padding), the session list, "Show all" on a long note, the timer chip's Discard, the import's Undo;
- publishers: the name inbox, an acquisition's Returned, the edition's publisher links;
- e-books: Set aside, Match again, Unlink…, Clear, Change choices;
- books: the identify queue's two choices, "Back to results";
- the series suggestions' Link, the perfume source's two Use buttons, the selection toolbar's Select all and Deselect, `ViewStatus`'s Retry.
