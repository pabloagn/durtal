# Task 0260: Timeline Rows Hold Only the Book Marker

**Status**: In Progress (draft PR, waits for Joris's choice on the timeline card)
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
On the /library timeline, old books with new editions filled the top rows.
Each book held its row from its original year to its newest edition, to make
room for the edition dots on that row. *Justine* (1791, an edition in 2012)
blocked the top row for 221 years. 21 books held a row for 50 years or more,
and the timeline needed 90 rows. Most of those books have one edition, so the
space held one faint dot.

## Implementation Details
- `src/components/timeline/work-timeline.tsx`, `packIntoLanes`: a book holds
  only its own marker (its year, 30px each side at scale 1). Editions reserve
  no space.
- `src/components/timeline/work-timeline-marker.tsx`: the edition line and
  dots show only while the book is hovered (and, as before, only above scale
  0.8). A hovered marker already sits above the others (z-index 20), so its
  dots draw over the books in the same row.

## Completion Notes
Checked on next dev with the live catalogue (read only), 548 books:
- Rows: 90 before, 66 after (canvas height 7920px to 5808px).
- Top row before: Vathek and Justine only (Justine held it to 2012). After:
  Vathek, Justine, The Manuscript Found in Saragossa and The Devil's Elixirs
  share it.
- No edition dots show at rest; hovering Justine shows its 2012 dot.
- `scripts/qa/alignment-audit.js` on /library: no issues at 1024px (17
  checked) and 390px (1 checked).
- `scripts/qa/design-audit.js` on /library: 0 unnamed, 0 nested. The
  timeline's 9px author labels in `fg-muted` are under 4.5:1 (9 at 1024px, 2
  at 390px). This task does not change them; PR #9 (SLN-404) does.
