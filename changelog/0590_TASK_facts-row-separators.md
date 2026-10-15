# Task 0590: A facts-row separator never starts a line

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-641 design contract, section 12, piece 4. On a phone the publisher
header's facts row ("Imprint of Penguin Books · United Kingdom · Founded
1961") wrapped with a separator at the start of a line ("· United
Kingdom"). The painting page's whereabouts did the same in WebKit at 320.

## Implementation Details

- **`FactsRow`** (`src/components/shared/facts-row.tsx`): each fact carries
  the separator before it, centred in the 20px gap that parts it from the
  fact before (8px either side of the dot, as before). The row reaches 20px
  past the column's left edge and clips 16px of it, so the separator of a
  fact that starts a line falls outside the row and is not drawn; the 4px
  left over keep room for a focus ring on a linked fact. The separators stay
  hidden from screen readers, which read the same facts as before.
- **Publisher header**: its facts row is `FactsRow`.
- **Paintings**: where it hangs now on the painting page, the custody text
  ("On loan for an exhibition · On display", `custodyText`) and the art
  object card's "Now:" line are running text in one line box, so there the
  separator keeps to the word before it with a no-break space and ends the
  line instead (the custody text and the card from the #290 review).
- The contract named `detail-facts.tsx` and the person, book, film and
  perfume headers too. There is no such file; the publisher header held the
  only separated facts row. The other headers' separators were measured and
  none starts a line, so they are unchanged.

## Completion Notes

- Every "·" and "," in the page's main area measured against its line's
  start, with the contract's publisher fixture, in Chromium, Firefox and
  WebKit at 320, 390, 430 and 768, on two publishers, a person, a book, a
  film, a perfume and a painting: on main 16 start a line, on the
  publisher fixture and the painting; on this branch 0.
- At 1440 the publisher facts sit where they did on main, to the pixel; at
  320 every wrapped line starts on the column's edge (x = 16).
- Alignment, design, overflow and touch audits clean on both publishers and
  the painting in three browsers at 1440, 1024, 768, 430, 390 and 320 (54 of
  54). `page-weight.js` passes. New `facts-row` test pins the classes and
  both callers.
- No migration and no new packages.
