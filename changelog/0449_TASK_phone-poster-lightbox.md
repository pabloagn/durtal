# Task 0449: Bound phone poster and lightbox rendering

**Status**: In Progress
**Created**: 2026-10-10
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0448
**Blocks**: Physical phone acceptance

## Overview
The owner reported an intermittent iOS browser failure after tapping a book poster. Mac WebKit navigation and repeated opening did not reproduce the crash; those results do not establish the cause or physical acceptance.

## Implementation Details
- Native picture sources select the existing 800px app-owned media variant on coarse pointers before the first request. Book posters and person portraits retain canonical image src, crop and saved-adjustment identity; desktop and external images retain their original sources.
- Coarse-pointer lightboxes start without scale/opacity animation. A stable frame provides explicit loading/error states, a 44px touch close control, focus containment and restoration of previous scrolling and focus.
- The adjustment control retains the canonical source. No ambient/glow, media route, schema, dependency or owner-data changes.

## Completion Notes
Focused poster/loading/exit, media URL and saved-adjustment tests passed: 32/32 across three files. TypeScript checking passed; changed UI source lint has zero errors (the test file is excluded by repository lint policy). Combined full gates and actual candidate browser checks remain pending, including currentSrc width <=800, no coarse original-image requests, full opacity/visible image bounds, failed loading, person/book/absent/external callers and desktop originals. Physical iOS acceptance remains open.
