# Task 0724: A person's credits name what they count

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass two (findings/design-polish-2-2026-10-15.md, item 8).
A person's Credits panel read "Books / Author 2" and "Films / Cast 13,
Screenwriter 1": a bare role and number, which read as a person called
Author 2.

## Implementation Details

- `src/app/(catalogue)/people/[slug]/page.tsx`: each role is its own line
  with its count's noun: "Author · 2 books", "Cast · 13 films",
  "Screenwriter · 1 film". "Author of" would not fit every role (Cast,
  Foreword, Introduction, Story), so the role and the count are separate.
- Test: `src/__tests__/ui/person-credit-roles.test.ts`.

## Completion Notes

- On a production preview of a disposable seed database (with seed-large):
  Huysmans reads "Author · 2 books"; a person with films, a perfume and a
  painting reads "Perfumer · 1 perfume", "Cast · 13 films", "Screenwriter ·
  1 film" and "Painter · 1 painting".
- Alignment, overflow, layout, touch and design audits are clean on three
  people in headless Chromium, Firefox and WebKit at 1440, 390 and 320.
- Page weight passes every route. Typecheck clean, lint no new warnings. No
  migration, no new package.
