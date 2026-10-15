# Task 0727: A person's roles keep one order; review and lookup counts read right

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0724, 0725
**Blocks**: None

## Overview

- SLN-793. A person's Credits and the role caption under each film, perfume
  and painting listed roles in the order of the titles, so "Translator"
  could sit above "Author". They now follow one fixed order: Author first,
  then the other seeded roles in their listed order (Co-author, Translator,
  Editor, Illustrator and the rest; for films Director, Screenwriter, Story,
  Cast…), then any role added later, by its label.
- SLN-808, from the review of #371:
  - Lookup history said "1 lookups"; it says "1 lookup" and groups
    thousands in "en".
  - "Review all 1107 filtered eBooks…" and "1100 pending" group thousands
    ("1,107", "6,000 pending"), as do the committed and skipped counts.
  - On touch from 640 up, the dictionaries' Cancel sat 8px below its status
    (and, measured here, 1.8px with a mouse too). It now sits on the
    status's cap height.

## Implementation Details

- `src/lib/catalogue/credits.ts`: `compareCreditRoles`, the one order, by
  `CREDIT_ROLES`' index of the role id. `people/[slug]/page.tsx` sorts the
  credits by it before building both the Credits summary and the captions;
  the cards keep their title order.
- `settings/reader/lookup-history.tsx`, `components/ebooks/review-section.tsx`,
  `components/ebooks/review-all-dialog.tsx`: the counts.
- `settings/reader/dictionaries.tsx`: from 640 up Cancel is wrapped as
  CapAligned wraps a control (`sm:block sm:h-[1lh]` around `sm:cap-box
  sm:cap-touch`, 28px, 44px on touch), only from 640, so the stacked layout
  under 640 from #371 is unchanged.
- Tests:
  - `src/__tests__/ui/person-credit-roles.test.ts` now renders the person's
    page with its data mocked: a person whose first title is a translation
    lists Author first; films keep one order in the summary and under each
    card; an added role comes after the seeded ones. It fails on main.
  - `src/__tests__/ui/review-and-lookup-counts.test.ts` (new) renders Lookup
    history (0, 1, 2 and 1,234 lookups) and a review section with 1,107
    eBooks; `review-all.test.ts` checks "6,000 pending".
  - `ghost-pull-out-and-plurals.test.ts` follows the Cancel row.

## Completion Notes

- Huysmans with an added translation reads "Author · 2 books", then
  "Translator · 1 book".
- Cancel, with the dictionaries' first load held open, Chromium at 1440 and
  640 with mouse and touch, Firefox at 1440 and 640: its center is 0.00px
  from the status's cap-height center (a CapAligned probe in the status's
  line). Under 640 it is unchanged: under the status, its icon on the
  text's edge.
- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 (touch at 390
  and 320) on Huysmans, Settings Reader, eBooks and the review queue:
  alignment, overflow, layout, touch and design audits are clean in all 36
  runs. Page weight passes every route.
