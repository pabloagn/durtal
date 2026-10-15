# Task 0599: Dictionary sites, journal counts and palette authors wrap at their natural breaks

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Main audit of 15 October (`/mnt/project-files/findings/audit-2026-10-15.md`,
findings 4, 6 and 7; SLN-720, SLN-721, SLN-722).

- Settings > Reader at 320: a lookup source's site broke inside a word,
  "logeion.uchicago.e / du", in its 170px column.
- The journal at 390: the counts line broke at a hyphen, "0 re- / reads".
- The command palette at 390: a book's author was cut off, "The Cathedral ·
  Joris-Karl Hu…".

## Implementation Details

- `lookup-settings.tsx`: `hostBreaks` puts a `<wbr>` after each dot of the
  site, so it wraps as "logeion. / uchicago.edu". `break-words` stays for a
  single part too long for the line.
- `reading/journal/page.tsx`: each count is a `whitespace-nowrap` span, joined
  by " · ", so the line breaks between counts. Its text is unchanged.
- `command-palette.tsx`: below `sm` a book result's author is a second line
  under its title, and both lines wrap in full instead of truncating. From
  `sm` up the row is as before.
- The Quick-win thread had drafted the same three fixes; this takes its
  palette change as it was and agrees with it on the other two.

## Completion Notes

- On a production preview, in Chromium, Firefox and WebKit:
  - Settings > Reader at 320: no word splits on the page; the dictionary
    sites wrap after a dot.
  - The journal at 1440, 390 and 320: each count sits on one line.
  - The palette at 390 and 320: "The Cathedral" with "Joris-Karl Huysmans"
    whole on the line under it, nothing cut off, a 60px row. At 1440 the row
    reads as before, on one line.
- Alignment, overflow, design and touch audits are clean on Settings > Reader
  and the journal at 1440, 1024, 768, 430, 390 and 320, and alignment,
  overflow and touch with the palette open at 1440, 390 and 320. The journal
  rows' 12px "drift" is the list's own row padding, as on main.
- Tests: `settings-ui.test.ts` (the site's break points), `phone-text-breaks`
  (the journal counts and the palette's author line).
- No migration, no new package.
