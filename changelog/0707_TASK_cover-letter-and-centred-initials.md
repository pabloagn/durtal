# Task 0707: Blank covers show a capital, and initials sit on their frame's middle (SLN-822, SLN-823, SLN-840)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0654
**Blocks**: None

## Overview
A book with no cover shows its title's letter (`CoverLetter`, 0654). It took the title's first character as written, so "«Quoted»" showed «, "études" showed a small é and "...and Then" showed a dot. The cards also passed only `title[0]`, so a leading quote mark was all the letter had to go on. The initials on a person or publisher with no picture (`Monogram`) sat 4 to 5px above their frame's middle, because of the serif's line box. They also sat about half a pixel left of the middle, because of the letter spacing after the last letter.

## Implementation Details
- `src/components/books/cover-letter.tsx`: `coverLetter(title)` returns the first letter or digit, uppercased, after any leading quote marks, punctuation or spaces. A combining accent stays on its letter. A letter that would uppercase to two ("ß") stays as written. A title with neither a letter nor a digit shows nothing. `CoverLetter` draws it.
- `src/components/books/book-card.tsx` and `src/app/(catalogue)/library/[slug]/work-poster-image.tsx`: `CoverPlaceholder` takes the whole title (`title`, was `letter={title[0]}`), and a cover that fails to load falls back to the image's `alt`, which is the title.
- `src/components/shared/no-photo.tsx`, `Monogram`: the initials' line is trimmed to the cap height and baseline (`[text-box:trim-both_cap_alphabetic]`), as the cover letter's is, and `tracking-wide` is gone.
- `src/styles/globals.css`: the phone title steps (`data-title-length`) also apply to the controls beside the title. On a 320px phone a short name is 38px, but its star, Edit and menu still measured their cap height at 46px, which put them 2.4px below the title's cap-height center. The alignment audit found this on a publisher's page, which shows the monogram. It is the same offset the dashboard redesign thread found on an imprint with a short name ("Folio", 2.4 to 2.9px; SLN-840).
- docs/03, Cards without a photo: updated.
- Tests: `src/__tests__/ui/cover-letter.test.ts` (the letter rule, the whole title passed in, the monogram's classes) and `src/__tests__/ui/detail-title-row.test.ts` (the steps cover the controls).

## Completion Notes
Measured on production builds in headless Chromium, Firefox and WebKit, each frame's center against the initials' box:

| | Before | After |
|---|---|---|
| Vertical | box centered, capitals 4.0 to 5.0px above the middle (ink) | box centered on the cap height, within 0.01px |
| Horizontal | ink 0.5 to 0.8px left (Chromium, Firefox) | box within 0.01px |

Measured on /people, /publishers and a publisher's page at 1440, 1024, 390 and 320. What remains of the ink offset comes from the glyphs' own shapes (the J's tail, the side bearings of S and P), and it is under 0.7px.

The alignment audit is clean in all three browsers at 1440, 1024, 390 and 320 on /people, a person's page, /publishers, a publisher's page, an imprint named "Folio", an organization's page, /library, a book's page and /. Page weight passes.

The provenance pages' small tiles still draw `title?.[0]` themselves. They are not `CoverLetter` and are left as they are.
