# Task 0746: A wrapped byline never starts a line with a comma

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0656
**Blocks**: None

## Overview

Review of #355. The book page's byline put each comma at the start of the
next author's name, so a byline that wrapped started its new line with it
(", Hugo von Hofmannsthal"). The comma also stood 4px clear of the name
before it ("Huysmans , Hofmannsthal").

## Implementation Details

- `src/app/(catalogue)/library/[slug]/page.tsx`: each comma closes the name
  before it, inside that name's item. The row's 4px gap is the space after
  it. A single author has no comma, as before.
- Test: `src/__tests__/ui/book-byline-wraps.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit at 1440, 640, 390 and 320. The seed has no
  book with two authors, so the real byline row was given three names
  (Joris-Karl Huysmans, Hugo von Hofmannsthal, Marguerite Yourcenar), first
  in the old markup and then in the new.
  - Old: wherever the byline wrapped (640, 390 and 320 in Chromium and
    Firefox, 390 and 320 in WebKit), each new line started with a comma.
  - New: each new line starts with a name, in every engine and width. On
    one line the next name starts 4px after the comma.
- With the real single author the byline is unchanged. Alignment and
  overflow audits clean. `page-weight.js` passes. The build's TypeScript
  check and lint are clean. No migration, no new package.
