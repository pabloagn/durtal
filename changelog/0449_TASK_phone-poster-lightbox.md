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
- The adjustment control retains the canonical source. Empty frame/backdrop taps dismiss the viewer; protection is restricted to the loaded image rectangle. No ambient/glow, media route, schema, dependency or owner-data changes.

## Completion Notes
Initial focused poster/loading/exit, media URL and saved-adjustment tests passed: 32/32 across three files. After the backdrop correction and combined grid changes, 43/43 focused tests passed across five files, including the new image-protection/backdrop regression. TypeScript checking passed; changed UI source lint has zero errors and two existing image warnings on unchanged lines (test files are excluded by repository lint policy). Combined full gates and actual candidate browser checks remain pending, including currentSrc width <=800, no coarse original-image requests, full opacity/visible image bounds, failed loading, person/book/absent/external callers and desktop originals. Physical iOS acceptance remains open.
