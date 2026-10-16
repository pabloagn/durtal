# Task 0761: Places, organizations, recommenders, taxonomy and locations errors lead back

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0612, 0619
**Blocks**: None

## Overview

SLN-813, from the third loading and error states survey
(`findings/survey-loading-3-2026-10-15.md`, item 4). Five sections had no
error view of their own. Their failures fell through to the catalogue's view,
which said only "An error occurred while loading this page." and led to the
dashboard. The sections were Places, Organizations, Recommenders, Taxonomy
and Locations.

## Implementation Details

Each section gets an `error.tsx` built on `ListSectionError`, as Collections,
Publishers and (since 0619) Series have:
- **The list** says "<Section> could not be loaded." and leads to the
  dashboard.
- **A record** says "This place / organization / recommender / family could
  not be loaded." and leads back to the list.
- **A deeper page**, such as a taxonomy item, leads back to the list.
- **Locations** has only its list.

Try again is primary and the way back secondary, through `SectionError`.

Test: `src/__tests__/ui/loading-audit-states.test.ts` gains a row per view.

## Completion Notes

- **Browser.** I ran a production preview with every database query failing,
  in Chromium, Firefox and WebKit at 1440, 390 and 320. Each view showed
  Try again first, then its way back:

  | Address | Description | Way back |
  |---|---|---|
  | `/places` | Places could not be loaded. | Go to the dashboard |
  | A place | This place could not be loaded. | Back to places |
  | An organization | This organization could not be loaded. | Back to organizations |
  | A recommender | This recommender could not be loaded. | Back to recommenders |
  | A taxonomy family | This family could not be loaded. | Back to taxonomy |
  | A taxonomy item | An error occurred while loading this page. | Back to taxonomy |
  | `/locations` | Locations could not be loaded. | Go to the dashboard |

  - `/taxonomy` itself kept showing its cached list, so its own error view
    was checked by the unit test only.
- **Audits.** The alignment, touch and design audits report nothing on any
  of these views, and no page scrolls sideways, in all three browsers at all
  three widths.
- Typecheck is clean, and the error view tests pass.
- No migration, no new package.
