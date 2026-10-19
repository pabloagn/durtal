# Task 0837: A book's acquisition targets: honest choices, app words, Undo

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0835 (SLN-1029)
**Blocks**: None

## Overview

SLN-1120, from findings/recommenders-acquisitions-survey-2026-10-18.md (items 3 and 4). On a book's "Hunting for" section: "Any edition" was offered when that target already existed (the server then refused it); states read "wanted" and "on order" in lower case; order rows showed the ISO date and the raw status; every Remove was named "Remove target", with no confirm or Undo; the add toggle had no `aria-expanded`; links were `accent-blue`; and the focus fell to the body after Add target.

## Implementation Details

All in `components/publishers/acquisition-targets.tsx` unless named:

- The add form offers only choices that can succeed: "Any edition" only when no such target exists, "Exact edition" only for editions with no target of their own, and the first choice left is the default.
- States use `TARGET_STATE_LABELS` ("Wanted", "On order", "Received"); order rows read "4 October 2026 · Placed" (`formatDate`, `orderStatusLabel`), as the provenance page does.
- Each Remove is named after its target ("Remove target: Penguin Classics edition"). Its toast names it too and offers Undo: `restoreAcquisitionTarget` (`lib/actions/publishers.ts`, wrapped in `catalogue-ui.ts` and `catalogue-client.ts`) makes it wanted again, and refuses ("This acquisition target already exists") when the same target was added since.
- The add toggle carries `aria-expanded`; the publisher and Order links use `accent-primary`.
- After Add target the focus goes to the new target's Remove (or its row) once it shows.
- The section's actions run with busy states, not a transition. On this page the list an action revalidates sometimes never arrived: the action's own refresh was dropped (Add target showed no new row in four of six tries in Chromium), the transition then stayed pending, and every control stayed busy with it. A later refresh brings the list, so the section asks again every 1.5 seconds, three times at most, until the page's targets change. A removed target still leaves at once (0835), and one brought back by Undo returns at once.

## Completion Notes

Checked in Chromium, Firefox and WebKit at 1440: the choices before and after an "Any edition" target exists; the focus on the new target's Remove after each Add; the names; Remove then Undo; an order's line and the "On order" state; the link colour. The 0835 focus checks still pass. Alignment, design, overflow, layout and touch audits are clean on the book page with two targets and an order at 1440, 390 and 320, and page weight passes. New database test for Undo in `publishers.test.ts`; the publishers and typed acquisitions suites pass; typecheck, lint and unit tests pass.
