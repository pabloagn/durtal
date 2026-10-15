# Task 0598: Collection member cards without blank lines, their buttons in two groups

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Main audit of 15 October (`/mnt/project-files/findings/audit-2026-10-15.md`,
finding 1). On a collection's page:

- every member card kept a blank second line under a one-line title, and a
  blank line for a missing byline or fact;
- the card's foot spread its buttons apart: Copy on the left, Read in the
  middle, and on a readable book the move and remove buttons wrapped onto a
  line of their own, so no two cards matched;
- Copy sat 6px inside the text's edge at 1440 in all three engines.

On the collections list, a collection with no description kept two blank
lines under its name.

## Implementation Details

- `member-card.tsx`: no `min-h` on the title, byline, facts or note. A
  missing byline, fact or note renders nothing. The row still stretches every
  card to its tallest, and the foot stays at the bottom (`mt-auto`). The
  title link takes `touch-hit`: one line is 29px, so on touch it grows to 44px.
- The foot is two groups. Copy and Read come first, pulled out by their
  padding (`-ml-1.5`, `pointer-coarse:-ml-3.5`) so Copy's icon is on the
  text's edge. The collection's controls (earlier, later, remove) come last
  with `ml-auto`: on the right, also when they wrap to a line of their own,
  with remove's padding past the text's right edge.
- `collection-card.tsx`: a collection with no description gives
  `CardHeading` no subtitle, so no blank lines.

## Completion Notes

- Measured on a production preview against main, in Chromium:

  | Card | Main | Now |
  |---|---|---|
  | A one-line title at 1440 | 216px | 187px |
  | A readable book at 390 | 252px, its buttons on two lines | 187px, on one line |
  | Copy's icon from the text's edge | 6px | 0px |

  A collection with no description now ends its card's text at its name.
- Audits on the collections list and a collection, in Chromium, Firefox and
  WebKit at 1440, 1024, 768, 430, 390 and 320: alignment, overflow, design and
  touch are clean, and the 6px Copy drift is gone. What remains is on main
  too: the item titles read as plain-looking to the layout audit, a long
  collection name is squeezed at 390 and 320 (0597 fixes that), and WebKit
  at 768 counts the collection cards' own 8px padding as drift.
- At 320 a readable book's controls take a second line, on the right.
- Tests: `member-card.test.ts` (no blank lines, the title's touch area, the
  foot's two groups, a collection card with no description).
- No migration, no new package.
