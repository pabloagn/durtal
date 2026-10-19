# Task 0960: A person page without a portrait shows the card's tinted initials

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A person page with no portrait, or one that failed to load, showed the name's first character, untinted and faint: an apostrophe for "'Abd al-Rahman", a lowercase "d" for "de Sade". The person's card and the publisher page show `Monogram`: initials on the name's tint, punctuation skipped. Source: findings/people-survey-2026-10-18.md, finding 2. Fixes SLN-1007.

## Implementation Details

- `src/app/(catalogue)/people/[slug]/author-detail-header.tsx`: the portrait's fallback is the card's `Monogram` in the same 192 by 256px frame. A missing portrait and a failed one share it, since the portrait shows only while it has not failed.
- Tests: `ui/person-header-initials.test.ts` ("'Abd al-Rahman" reads "AR", "de Sade" reads "DS"; the header uses `Monogram` once and no longer prints `name[0]`).

## Completion Notes

Checked on a production build with a private preview database, in Chromium, Firefox and WebKit at 1440, 390 and 320px. "'Abd al-Rahman" reads "AR", "de Sade" "DS", a 53-letter name "MH", and a person whose portrait fails to load "GL". Each header shows the same initials and tint as that person's card on /people, centered in its frame within 0.01px. The alignment audit found no deviation on four person pages, and page weight passes every route (/people/abd-al-rahman 73 of 400 KB).
