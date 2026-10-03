# Task 0193: One tooltip for the whole app instead of native title tooltips

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0181
**Blocks**: None

## Overview

SLN-390. Controls explained themselves with the native `title` attribute: it showed after about a second, in the system's light style, and never on keyboard focus. Many icon-only controls had no name at all. Now one tooltip layer serves the whole app, it shows on keyboard focus with the control's shortcut, and every icon-only control has a name and a tooltip.

## Implementation Details

- `src/components/ui/tooltip.tsx` (`TooltipLayer`, mounted once in `src/app/layout.tsx`): one `popover="manual"` element in the top layer (above open dialogs, never clipped) and delegated listeners on the window. Any element with `data-tooltip` gets it: on hover after 300 ms (no wait when moving from one tooltip to the next), at once on keyboard focus (`:focus-visible`). It closes on Escape, a click (until the pointer leaves that control), scroll, resize, Enter or Space, and when the control leaves the page. Escape closes a focus tooltip only; with a hover tooltip it also reaches the dialog.
- `data-tooltip-keys` shows the shortcut with the existing `KeyCombo` key caps (`"b"`, `"alt f"`, `"a then l"`). `data-tooltip-side` picks the side; the tooltip flips when it does not fit and stays 8px inside the window.
- Text cut by `truncate`, `lines-1` or `lines-2` shows its full text on hover, with no attribute.
- A tooltip that says more than the control's name becomes its `aria-describedby` while it shows. No tooltip shows on a control whose menu is open (`aria-expanded="true"`).
- Plain attributes, so server components use it with no import.
- The `title` attribute: 52 interactive sites (button, a, Link, Button, input) moved to `data-tooltip` by a codemod; "(B)"-style suffixes moved to `data-tooltip-keys`; icon-only ones also got an `aria-label`. The badges, the `time` stamps and the poster image moved by hand; icon badges are `role="img"` with an `aria-label`. Only the reader's `iframe` keeps `title` (its accessible name).
- `ToolbarButton` in the comment editor and the rich text editor: prop `title` renamed `label`; it gives the `aria-label` and the tooltip.
- 21 icon-only controls with no name got an `aria-label` and a tooltip (close, previous and next image, select and delete image, remove chips, column settings, collapse in the taxonomy tree, the order panel close, tracking link, status menu, comment send, back to Reader). 18 icon-only controls that had an `aria-label` got the same text as a tooltip.
- `DropdownMenu`: new `label` prop names an icon-only trigger and shows as its tooltip. The four "more" menus (entity actions, taxonomy row, author card, book card) use it; their inner `<button>` became a `<span>`, so each menu is one tab stop with a name. The taxonomy trigger shows on keyboard focus (`group-focus-within`).
- Sidebar: the collapsed mode's own tooltip divs are gone. Collapsed, the links and the search button have an `aria-label` and a right-side tooltip with their shortcut ("G then L", "⌘ K").
- `docs/03_DESIGN_LANGUAGE.md` (Tooltips; Iconography rule) and `CLAUDE.md` state the rule.

## Completion Notes

Measured on the dev server at 1440x900:

- Tooltip: opens 300 ms after hover, 6px from the control, centered within 0.14px; 30px tall with or without key caps (key caps 4px from top and bottom). Right-side tooltip in the collapsed sidebar: 6px gap, 0px off center. In a modal dialog: opens above the dialog. Tab opens it, Escape closes it and keeps the focus, Tab away closes it.
- Cut text: hovering the cut title of a Provenance pipeline card shows the full title, wrapped at 320px.
- Audit of icon-only controls (visible buttons, links and `role="button"` with no text) on the dashboard, Books, a book page, an author page, Authors, Publishers, Provenance, Taxonomy, Collections, Places, Series, Settings, Reader, Harmonize, Recommenders, Locations, the collapsed sidebar and the Edit Edition dialog: every one has a name and a tooltip; no `title` attribute is left. The only hits are the recommender cards' full-card overlay links, which repeat the visible name.
- `scripts/qa/alignment-audit.js`: no deviations on the dashboard, Books, the book page (also with the Edit Edition dialog open), the author page, Taxonomy, Locations and Provenance.
- `pnpm typecheck` and eslint on the changed files pass.
- Not changed: menu triggers that wrap a text button (export, bulk toolbar) still nest a button in the trigger.
