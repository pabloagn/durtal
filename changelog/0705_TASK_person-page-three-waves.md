# Task 0705: The person page reads the database in three waves, not five

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-796, from the speed survey (findings/speed-survey-2026-10-15.md): the
person page waited for the credits before asking which books have an
e-book, and its gallery only started reading once the page had rendered.

## Implementation Details

- `src/app/(catalogue)/people/[slug]/page.tsx`: `catalogueAvailability`
  runs beside the credits, note counts and e-book suggestions; it needs only
  the person's works.
- `src/components/shared/gallery-section.tsx`: `preloadGallery` starts the
  gallery's reads early through a per-request `cache`, and `GallerySection`
  takes the same result. The person page calls it as soon as it has the
  person. `getGalleryWithLayout` itself is unchanged (SLN-794 makes its two
  reads run together).

## Completion Notes

Measured on a production preview of a disposable seed with every database
request held 200 ms (a temporary local bridge change, not committed), on
the third load of `/people/qa-author-19`:

| | Waves | Requests | Page |
| --- | --- | --- | --- |
| Before | 5 | 5 | 1.07 s |
| After | 3 | 5 | 0.65 s |
