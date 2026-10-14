# Task 0543: Audits that see squeezed titles, text-looking commands and drifting edges

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: 0542 (SLN-693)
**Blocks**: None

## Overview

SLN-695, from the design audit (SLN-641 slice 1, section 5). Every page passed the overflow, alignment, design and touch audits, but the owner's complaints were still real. Those audits measure geometry, not grouping or whether something looks pressable. This task adds four checks and runs them with the phone audit.

## Implementation Details

- **`scripts/qa/layout-audit.js`**, a page script like the other audits, returns:
  - `squeezed`: the h1 wraps while it takes under 60% of its row, because controls share the row; or it runs past 2 lines on a screen 400px wide or less.
  - `plainCommands`: a button or link with no box, border, underline or icon, in a text colour (`fg-heading`, `fg-primary`, `fg-secondary`, `fg-muted`) or within 1.25:1 of the text beside it (or of its row when alone). It skips:
    - a link in a sentence of running text;
    - tabs and menu items, and the page or step in view (`aria-current`);
    - cover and card links, and titles that are links;
    - a button beside a boxed button (Cancel beside Save).
  - `drift`: in a card (an element with a border and a fill, 200px or wider), a block whose first-line ink starts 0.5 to 12px off the content edge of the column holding it.
    - The ink is text, an icon, or the box of a boxed element such as a badge or field.
    - A wrapping row of controls is checked line by line.
    - `data-inset` marks an intended inset.
  - `firstContent`: the top of the first card on the page, and `late` when it is below 60% of the screen.
- **`scripts/qa/phone-audit.mjs`** changes:
  - It runs the layout audit on every route, after the overflow audit.
  - It emulates a touch screen, so the page lays out as on a phone: 44px controls, a coarse pointer.
  - It adds `/library/*`, `/publishers/*` and `/films/*`, each the first record its list page links to.
  - It prints findings grouped by kind and element.
  - It marks findings listed in `scripts/qa/layout-audit-known.json` as known, with their ticket, and says when a known one is no longer found.
  - A new finding fails the run only with `--strict`, so the gate stays green while the known list is worked down.
- **docs/03** (Phone widths) describes the four checks.

## Completion Notes

- On main's preview (seed plus the audit fixture), at 375 and 390:
  - The checks catch the three cases the design audit found.
  - **Publisher header**: "Penguin Modern Classics" takes 56% of its row and runs to 3 lines.
  - **Edition card**: "Edit publisher links", "Add a quote" and the linked publisher look like text, and Edit and Add instance start 10px in.
  - **Books header**: the first card is at 594px of an 812px screen. People are at 490 to 542px and Publishers at 522px.
- They also find:
  - the film credits, "Show all", the rating's "Clear" and the "1 digital copy" link;
  - the eBook summary links and sort buttons;
  - a copy's Edit and Delete starting 10px in on a narrow card.
- All of these are in the known list with their ticket. The list is taken after SLN-693 part 1 (#262), which fixed the edition card: the run on its build no longer finds those.
- Overflow is unchanged: no page scrolls sideways with the touch screen either.
