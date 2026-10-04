# Task 0298: The controls and marks on a card's image are real glass

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0285 (stacked on it), 0270, 0236
**Blocks**: None

## Overview
SLN-435. Pablo, on the live app: the transparency on the cards "does not even have blur" and is not what he asked for in his glass note. On every card with an image (books, authors, films, perfumes, paintings, the reader) the small controls and marks on the cover were flat squares of the page color at 85%: the copy button, the actions menu, the selection box and the cover chips (rare, poison, digital edition, favourite, held). Nothing blurred; the cover showed through sharp and muddy. 0270 had taken the blur off the actions button to follow the SLN-395 spec; Pablo's note wins over the spec.

## Implementation Details
- `src/styles/globals.css`: a third glass, `glass-chip`, for small controls and marks on an image. A lighter tint than the panels (`--color-glass-chip-tint`, `bg-secondary` at 50%) over the image blurred 10px, saturated 180% and dimmed (`brightness(0.06)`: the filter works in linear light, so white comes out near 70), a hairline edge and a top line lit from above, a faint sheen over the top third and a soft drop shadow. Both `backdrop-filter` and `-webkit-backdrop-filter`, for Safari. `glass-chip-lift` brightens the sheen, for a control's hover.
- Mark colors on glass: `--color-chip-gold`, `-rose`, `-red`, `-sage`, `-blue`, each accent mixed 45% with `fg-primary`, so a mark reads as light through the dark glass. `COVER_CHIP_TONE` uses them; a chip's label is `fg-primary` and the tone colors only its icon.
- `src/components/books/cover-chip.ts`: `COVER_CHIP` is `border glass-chip` (it was `border-white/10 bg-bg-primary/85`). Used by the book, film, perfume, painting and reader cards, and the rare, poison and digital edition marks.
- The card actions menu (book and author cards), the copy button on a book card (`CopyBookButton glass`), the selection boxes on book and author cards and list thumbnails, and the image adjustment button: `glass-chip` instead of `bg-overlay` or `bg-bg-primary/85`.
- The held chips on film, perfume and painting cards: the label is `fg-primary`, the sage tone moves to the icon. The reader's format chips: `fg-primary`.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Over images; Glass, where it goes), `CLAUDE.md` (Colors).

## Completion Notes
`scripts/qa/preview-local.py` (2026-10-04 backup), headless Chrome at device ratio 2 (and 1), each card hovered so its buttons show, 1440x900 and 390x844. The live app has no film, perfume or painting yet, so one of each, with a poster, a favourite mark and (for the perfume) a held bottle, was added to the disposable preview database only. "Before" is the same card with `main`'s backdrop put back inline.

| Card | Before | After | Lowest contrast after (1440 / 390) |
|---|---|---|---|
| Book (*'I'*, yellow cover): copy, actions | flat `rgba(3,5,7,0.85)`, no blur | glass, `blur(10px) saturate(1.8) brightness(0.06)` | icons 6.92 / 6.92 |
| Book (*A Clockwork Orange*, white cover): poison mark, copy, actions | the same | glass | icons 3.34 / 3.29 |
| Author: actions | the same | glass | icon 7.89 / 7.89 |
| Film: favourite | the same | glass | icon 5.33 / 4.64 |
| Perfume: favourite, held | the same | glass | icons 7.78 / 7.7; label 10.68 / 6.35 |
| Painting: favourite | the same | glass | icon 7.77 / 6.87 |

- Contrast is read from the screen: each chip's icon or label hidden, the lightest pixel under it against its color. Icons need 3:1, labels 4.5:1.
- The first tuning (`brightness(0.32)`, the accents as they are) left a white cover's chips mid grey: `brightness()` works in linear light. The poison mark was 1.4:1 and the film heart over a red poster 2.8:1. The shipped values pass everywhere above.
- The served stylesheet carries `-webkit-backdrop-filter` next to `backdrop-filter`. Safari itself was not run: driving it needs a system setting changed.
- `scripts/qa/alignment-audit.js`: 0 rows over 0.5px on every card above, at both widths. `scripts/qa/design-audit.js`: 0 low-contrast texts, 0 nested controls.
- Rechecked after merging `main` (2f0a11e, whose cards now show their buttons through `hover-reveal`): the same blur on the book and author cards, lowest contrast 3.34:1 on the white cover, 0 rows over 0.5px.
- `pnpm typecheck`, `pnpm lint` (0 errors) and `python3 scripts/qa/test-local.py` (1,760 tests) pass. `scripts/qa/page-weight.js` was not rerun: the preview was stopped to free the shared lock, and the change adds only class names.
