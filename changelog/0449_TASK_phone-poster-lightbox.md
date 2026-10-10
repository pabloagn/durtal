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
- Cold WebKit acceptance exposed an original fallback request while React constructs a detached lightbox image before its picture parent. The viewer now assigns canonical `img.src` through a stable ref after insertion; a native cold reproduction confirms only the bounded source is fetched on coarse pointers, while fine pointers retain the original. A regression checks connected-picture assignment and no reassignment on load, including external sources. This confirms a request-timing defect, not the physical iOS failure cause.
- Coarse-pointer lightboxes start without scale/opacity animation. A stable frame provides explicit loading/error states, a 44px touch close control, focus containment and restoration of previous scrolling and focus.
- The adjustment control retains the canonical source. Empty frame/backdrop taps dismiss the viewer; protection is restricted to the loaded image rectangle. No ambient/glow, media route, schema, dependency or owner-data changes.

## Completion Notes
Initial focused poster/loading/exit, media URL and saved-adjustment tests passed: 32/32 across three files. After the backdrop correction and combined grid changes, 43/43 focused tests passed across five files, including the new image-protection/backdrop regression. TypeScript checking passed; changed UI source lint has zero errors and two existing image warnings on unchanged lines (test files are excluded by repository lint policy). The first combined source passed all 3465 local tests and a production build, but actual cold browser checks found the client-mount fallback described above. That artifact is superseded for acceptance. The timing correction requires fresh independent source review and its own gates/build/render evidence, including currentSrc width <=800, no coarse original-image requests, full opacity/visible image bounds, failed loading, person/book/absent/external callers and desktop originals. Physical iOS acceptance remains open.

The connected-picture correction passed 45/45 focused tests across five files, TypeScript checking and lightbox lint (zero errors or warnings). All shared viewer callers were assessed: book poster and person portrait; external source timing and canonical identity are covered by the regression. Independent review and fresh combined gates/build/render remain pending for this correction.

## Ordinary navigation recurrence (2026-10-10, candidate)

A later owner report reproduces the browser failure during an ordinary book
navigation. The earlier viewer fix is retained; its passing checks did not
establish the physical crash cause. The current source still permits original
backdrop and edition fallback requests, alongside multiple large blur surfaces.

This candidate bounds the initial poster/backdrop img fallback at the supported
800px derivative, with explicit native fine-pointer sources retaining desktop
artwork. Edition thumbnail frames use the supported 240px derivative, including
their original-poster fallback. Keys, crop styles and saved adjustment selectors
are preserved. Coarse-pointer atmosphere uses the same palette in a clipped
gradient plane without per-blob blur or oversized rotation; desktop layers and
glass are retained.

Source review, affected checks and a bounded baseline/candidate ordinary
navigation diagnostic remain pending. Initial/client navigation, selected image
sources and repeated back/forward must be measured before attributing the crash
or calling physical reliability restored. No schema, stored-media rewrite,
dependency or service change is included.
