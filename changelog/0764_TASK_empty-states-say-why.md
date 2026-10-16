# Task 0764: Four empty states say why, and what to do next

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0611
**Blocks**: None

## Overview

SLN-816, from the third loading and error states survey
(`findings/survey-loading-3-2026-10-15.md`, item 6). Empty states said
nothing, used internal words, or offered no next step. Of the survey's six,
two landed elsewhere first: People's (#415, the one empty state of every
list) and Provenance's (#400, "No orders yet"). This task does the other
four.

## Implementation Details

- **`ebooks/ebooks-view.tsx`**:
  - With no filter, but one side of the eBook library empty while the other is
    not, the page said "No eBooks found / No eBooks match these filters."
  - Set aside, with nothing set aside, now says "Nothing set aside / An eBook
    you set aside leaves the library and waits here.", with Back to eBooks.
  - The library, with every eBook set aside, now says "No eBooks in the
    library / Every eBook is set aside.", with Show set aside.
- **`taxonomy/page.tsx`**: "No taxonomy families" had no text. It now says
  what a family is, and that New family adds one.
- **`taxonomy/[familySlug]/[itemSlug]/page.tsx`**:
  - "No associated entities / No works are linked to this item yet" becomes
    "Nothing tagged yet".
  - For a work-level family, the text is "No book, film, perfume or painting
    is tagged <item> yet. Tag one from its page."
  - For an edition-level family, the text is "No edition is tagged <item>
    yet." Editions have no tagging control to point to.

Tests:
- `src/__tests__/ui/loading-audit-states.test.ts` (the eBooks cases);
- `src/__tests__/ui/empty-states-say-why.test.ts`.

## Completion Notes

- **Browser.** I checked each state on a production preview in Chromium,
  Firefox and WebKit at 1440, 390 and 320:
  - Set aside, with nothing set aside, and its Back to eBooks;
  - an untagged item of a work-level family.
- **Audits.** The alignment, touch and design audits report nothing on any of
  them, and no page scrolls sideways.
- **What I could not draw.**
  - The library with every eBook set aside: the preview's eBooks could not
    all be set aside without breaking their links. It is the same empty view,
    with a different title, text and link. The unit test covers it.
  - Taxonomy with no families: the database keeps its system families, so a
    real library never shows this state. The unit test covers it.
- Typecheck is clean, and the tests pass.
- No migration, no new package.
