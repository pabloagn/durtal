# Task 0236: One glass material for every floating surface

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0233 (command palette thumbnails build on the glass palette)

## Overview
Pablo asked for "a very elegant, controlled glassmorphism component, like apple did with liquid glass, but more subtle, and less aggressive border radius", in the spirit of Linear. Before this task, each floating surface had its own look: the command palette a 70% glass with a blur, dialogs opaque with a large shadow and a heavy 16px blur behind, menus and pickers opaque `bg-secondary` with one of four shadows, the selection toolbars 95% with a blur, tooltips opaque with `shadow-lg`.

Now they share one material: a dark tint over a blurred, dimmed view of what lies behind, a hairline edge lit from above, a faint sheen at the top, 4px corners and one soft three-layer shadow. Behind dialogs and the palette, one veil: the page stays in view, dimmed and softly blurred.

## Implementation Details
- `src/styles/globals.css`: new tokens `--color-glass-tint` (`bg-secondary` at 88%), `--color-glass-edge`, `--color-glass-edge-lit`, `--color-glass-sheen`, `--color-glass-veil`; new utilities `glass` (floating panels), `glass-bar` (bars fixed to a screen edge: square corners, no shadow) and `glass-veil`. The old `glass-surface` utility and token are gone (only the palette used them; no pushed branch uses them elsewhere).
- The material is drawn on a `::before` layer (`isolation: isolate`, `z-index: -1`), not on the element: a `backdrop-filter` on the element would become the containing block of its `position: fixed` children, such as the collection icon picker and the mark hover card inside a dialog.
- A glass surface never scrolls itself. The `::before` layer is absolute, so on an element that scrolls it scrolled away with the first screenful and left the rest of a long list on the bare page (found in a pre-merge review). The glass element takes `overflow-hidden` and an element inside it scrolls: the select list (`ui/select.tsx`), the place search results (`venues/google-places-search.tsx`) and the wizard's search results (`library/new/wizard.tsx`). The dialog clips (`overflow-hidden`, a flex column when open) and its body scrolls, so its header also stays in view. `src/__tests__/glass-surfaces.test.ts` fails on any glass surface with `overflow-*-auto` or `-scroll`, and on a glass `<dialog>` that does not clip (the browser makes a modal dialog scroll).
- `src/components/ui/glass.tsx` (new): `<Glass>` for new code, `variant="panel"` or `"bar"`; it adds `relative` unless the class already positions the element.
- Applied to: the command palette and its overlay (`layout/command-palette.tsx`), the leader menu (`shortcuts/leader-menu.tsx`), dialogs and their `::backdrop` (`ui/dialog.tsx`; `border-0 bg-transparent` against the browser's dialog defaults), menus (`ui/dropdown-menu.tsx`), select lists (`ui/select.tsx`), the date picker, the filter panel (`shared/filter-dropdown.tsx`), tooltips (`ui/tooltip.tsx`), the mark hover card (`books/mark-toggle.tsx`), the collection icon picker, the taxonomy color picker, the place search results, the instance status menu, the wizard's search results, the provenance row menu, and both selection toolbars.
- `ui/button.tsx`: the secondary button drops its `backdrop-blur-sm`. Inside a glass panel a nested backdrop filter reads the page behind the panel, not the panel, so the button turned into a window onto a white cover.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Glass replaces Glassmorphism; Modals; Tooltips), `CLAUDE.md` (Design Language).

## Completion Notes
Text contrast on glass is measured on the screen: each surface open on `scripts/qa/preview-local.py` (2026-10-03 backup, covers from the live app's image endpoint), a screenshot with the surface's text hidden, and the lightest pixel under each text against its color. `design-audit.js` cannot see through a backdrop filter.

| Surface (1440x900) | Before (live app) | After |
|---|---|---|
| Command palette over the library grid | 4.32:1 ("then" key hint) | 4.70:1 |
| Card menu over the white cover of *A Clockwork Orange* | 5.04:1 (opaque) | 4.77:1 |
| New collection dialog | 5.04:1 | 5.06:1 |
| Selection toolbar over covers | 4.48:1 ("Delete") | 4.69:1 |
| Tooltip | 11.26:1 | 11.10:1 |

- Tuning: the first values (84% tint, backdrop brightness 45%, 3% sheen) gave 4.09:1 at the lit top edge over pure white. The shipped values (88%, 30%, 2%) give 4.64:1 there.
- Before, the palette was the only surface under 4.5:1; after, none is.
- Long lists and tall dialogs, 1440x900 and 390x844: a white panel behind each surface, its text hidden, the list or dialog body scrolled to the end, and the mean luminance of the surface's last 24px. With this task: 19.8 (the glass). With the glass element itself scrolling, as before the review fix: 255 (the bare white panel). Checked on the Nationality select in Add Author (251 options), the Add Author dialog (taller than 90% of the screen at both widths) and the wizard's search results (10 results). The glass box never moves and never scrolls; the list inside it does.
- The alignment audit from #26 checks 37 rows in the Add Author dialog: 0 over 0.5px. With the dialog open, it also pairs the dialog's buttons with the page title behind the modal (28-31px); that pair is the same before the fix and is not a real row.
- Left to the follow-up after the phone layout (#11) lands: the mobile navigation bar and the phone drawer (`glass-bar`, scrim `glass-veil`), and films' search picker.
- `pnpm typecheck`, `pnpm lint` and `python3 scripts/qa/test-local.py`: see the PR.
