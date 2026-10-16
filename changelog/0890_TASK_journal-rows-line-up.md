# Task 0890: The journal's rows line up and keep their titles on phones; the layout audit reads divided lists

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-893. A browser sweep reported two rows on `/reading/journal` 12px out of
line, on main as well. Measured, the rows line up: every row's cover and text
start at the same x, 12px inside the list's box. The two findings came from
the layout audit's drifting-edge rule (`scripts/qa/layout-audit.js`), not the
alignment audit, and from a gap in that rule. Two earlier surveys
(`findings/audit-2026-10-15.md`, `findings/design-polish-2026-10-15.md`) had
reached the same reading.

A divided list (`divide-y`) pads its rows rather than itself, so its rules
run to the box's edges. The rule measured each row from the box's edge, so
the padding read as a 12px drift. It also counted the rule under a row as a
box, and skipped any boxed block. So it checked only the last row of each
group, the one without a rule: one finding per journal group, the "two rows"
of a two-group journal. A row truly out of line anywhere else in such a list
went unseen.

Looking closer on phones found the real fault. Each row's marks and menu sat
beside the title at every width, so on a 320px screen the title was crushed:
to nothing in rows that carry Log or Resume, to 82px in the others. At 375
and 390, ten rows of the 714-reading catalogue had titles 35 to 50px wide,
one or two letters a line.

## Implementation Details

`src/components/reading/reading-tiles.tsx`, `JournalRows`:
- The title and its controls sit in a container. Where the controls would
  leave the title under 9rem (a container under 25rem for a reading or
  paused row, which carries Log or Resume, under 17.5rem for the others),
  the controls go under the title instead of beside it.
- Stacked, the controls keep a 14px margin, so they clear the title and the
  meta line below them with mouse and touch targets alike.

`scripts/qa/layout-audit.js`, drifting edges:
- A row's divider no longer makes it a box (`boxed(el, apart)`, and
  `inkLeft`'s `apart` for the row itself), so every row of a divided list is
  checked.
- When every row of a divided list carries the same left padding and starts
  at the column's edge, ink is measured from that padding.
- A row with different padding from the others still measures from the
  box's edge, so it is reported.

The rule's description in the script and in `docs/03_DESIGN_LANGUAGE.md`
(Layout audit) says so.

## Completion Notes

- **Phone titles.** The narrowest journal title is at least 158px at 320,
  375 and 390 in Chromium, Firefox and WebKit, where it was 0 to 50px. The
  stacked controls leave 22px under the title and 10px above the meta line
  with a mouse, 16px and 4px with touch targets. From 768 up the rows look
  as before.

- **The journal.** The alignment and layout audits report nothing on
  `/reading/journal` and `/reading` at 1440, 1024, 768, 390, 375 and 320 in Chromium, Firefox and
  WebKit. Both catalogues were checked: one with 48 rows shown (714 readings)
  and one with no readings.
- **Real drift is caught.** With one middle row's cover moved 6px, the audit
  reports that row at 6px; main's audit reported nothing. With one row's
  padding changed to 18px, the rows that no longer match are reported.
- **No other change.** Main's audit and this one ran on 28 pages at 1440 and
  390: the dashboard, the lists, settings (whose groups are divided lists),
  reading's tabs, statistics and detail pages. The only findings that
  differ are the journal's three and the Paused row on `/reading`, the same
  false reading. Nothing new.
- `scripts/qa/phone-audit.mjs` finds no drift. Its four new findings are a
  plain-looking year link and two late first cards, outside this change.
- The browser audit passes 30 of 30 page loads on `/reading/journal` and
  `/reading` at 1440, 1024, 390, 375 and 320 in three browsers. Page weight
  is within budget on every route; `pnpm typecheck` is clean.
- The layout audit's plain-command check reports "Edit goals" on `/reading`
  in Firefox and WebKit with main's audit too; it is outside this change.
