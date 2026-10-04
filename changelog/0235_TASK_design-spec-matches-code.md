# Task 0235: The design spec matches the code; overlays use the palette

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: 0246 (list rows, stacked on this branch)

## Overview
SLN-395. `docs/03_DESIGN_LANGUAGE.md` and `CLAUDE.md` described a different system than the one shipped, so each change followed either the spec or the code. For each item, one side is now made to match the other.

| Item | Decision |
|---|---|
| Serif font | Already settled: PP Cirka for display, EB Garamond for long text (`<Prose>`), in the spec and the code |
| Type scale | Already settled: seven sizes, Tailwind's own cleared (SLN-389) |
| Mono | Keep the code: mono is for metadata a reader scans or compares (years, counts, dates, prices, ISBNs, codes, key hints, captions). The spec now says so |
| Glass | Settled by #16: one glass material for floating surfaces, never on page content |
| Black and white over images | Replaced by three palette tokens (`overlay`, `scrim`, `scrim-deep`); text on them and on rose fills is `fg-primary` |
| Dialog shadow | Settled by #16: a dialog is a glass surface, and the glass carries one soft shadow |
| Icons over 16px | Keep the code: 16px is the maximum for interface icons; image placeholders may use larger decorative icons. Mark and status icons take their accent |

## Implementation Details
- `src/styles/globals.css`: `--color-overlay` (`bg-primary` at 85%: a control on an image), `--color-scrim` (70%: a banner behind a header), `--color-scrim-deep` (90%: the lightbox).
- Banner dims on the book, author and collection pages: `bg-black/70` → `bg-scrim`.
- Selection checkboxes (book and author cards, list rows, the detailed table), the book card's copy button and the media managers' hover actions: `bg-black/50-65` → `bg-overlay`, `text-white` → `text-fg-primary`. The lightbox: `bg-black/80` and a blur → `bg-scrim-deep`. Primary buttons and selected states on `accent-rose`: `text-white` → `text-fg-primary` (5.0:1).
- Not changed here: the card action menu triggers (`book-card-actions-menu.tsx`, `author-card-actions-menu.tsx`) are in #4; the cover chips (`cover-chip.ts`) are in #14; the dialog is in #16. Each takes the tokens once those land.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Over images, Typography, Iconography), `CLAUDE.md` (Colors, Icons).

## Completion Notes
- On `scripts/qa/preview-local.py` (2026-10-03 backup): the overlay controls render `rgba(3, 5, 7, 0.85)` and the lightbox `rgba(3, 5, 7, 0.9)`; `scripts/qa/design-audit.js`: 0 low-contrast texts on a book page, an author page and `/collections`.
- `grep -rn "bg-black\|text-white" src` now finds only the three files left to #4, #14 and #16.
- `pnpm typecheck`, `pnpm lint` and `python3 scripts/qa/test-local.py`: see the PR.
