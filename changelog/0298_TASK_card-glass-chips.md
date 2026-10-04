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
- `src/styles/globals.css`: a third glass, `glass-chip`, for small controls and marks on an image. A lighter tint than the panels (`--color-glass-chip-tint`, `bg-secondary` at 68%) over the image blurred 10px, saturated 180% and dimmed to 60%, a hairline edge and a top line lit from above, a faint sheen over the top third and a soft drop shadow. Both `backdrop-filter` and `-webkit-backdrop-filter`, for Safari. `glass-chip-lift` brightens the sheen, for a control's hover.
- Mark colors on glass: `--color-chip-gold`, `-rose`, `-red`, `-sage`, `-blue`, each accent mixed 45% with `fg-primary`, so a mark reads as light through the dark glass. `COVER_CHIP_TONE` uses them; a chip's label is `fg-primary` and the tone colors only its icon.
- `src/components/books/cover-chip.ts`: `COVER_CHIP` is `border glass-chip` (it was `border-white/10 bg-bg-primary/85`). Used by the book, film, perfume, painting and reader cards, and the rare, poison and digital edition marks.
- The card actions menu (book and author cards), the copy button on a book card (`CopyBookButton glass`), the selection boxes on book and author cards and list thumbnails, and the image adjustment button: `glass-chip` instead of `bg-overlay` or `bg-bg-primary/85`.
- The held chips on film, perfume and painting cards: the label is `fg-primary`, the sage tone moves to the icon. The reader's format chips: `fg-primary`.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Over images; Glass, where it goes), `CLAUDE.md` (Colors).

## Completion Notes
Two rounds of measurement.

**1. The material, on every card kind (Chrome).** `scripts/qa/preview-local.py` (2026-10-04 backup), headless Chrome at device ratio 2, each card hovered, 1440x900 and 390x844. The live app has no film, perfume or painting yet, so one of each, with a poster, a favourite mark and (for the perfume) a held bottle, was added to the disposable preview database only. "Before" is the same card with `main`'s backdrop put back inline. Contrast is read from the screen: each icon or label hidden, the lightest pixel under it against its color; icons need 3:1, labels 4.5:1. The first values (`brightness(0.32)`, the accents as they are) left a white cover's chips mid grey: the poison mark was 1.4:1 and a film heart over a red poster 2.8:1. Lighter mark tones and a darker glass fixed both; every card kind then passed at both widths, the white cover's poison mark lowest (3.29:1), with 0 alignment rows over 0.5px and 0 design-audit findings.

**2. The same glass in Chrome, Safari and Firefox.** The live app (`main`) with this PR's `glass-chip` CSS injected on a yellow and a white book cover, driven in Chrome (DevTools protocol), Safari (`safaridriver`) and Firefox 157 (WebDriver BiDi), device ratio 2:
- Chrome applies `brightness()` in linear light, Safari in sRGB. At `brightness(0.06)` Chrome drew smoked glass but Safari drew near-black squares, much like the look that was reported. So the dimming moved into the tint (`bg-secondary` at 68%, drawn alike everywhere) and the filter keeps a mild `brightness(0.6)`.
- With the shipped values both browsers draw the cover through the chips, blurred and saturated: on the yellow cover about (68, 59, 16) in Chrome and (65, 51, 4) in Safari; on the white cover about 65 to 77 in Chrome and 54 to 64 in Safari.
- Lowest contrast: Chrome 3.67:1 (the poison mark on the white cover; copy and actions 5.64 to 6.46), Safari 4.49:1 (copy and actions 6.53 to 7.14).
- Safari computes both `backdrop-filter` and `-webkit-backdrop-filter`. Firefox computes `backdrop-filter` and supports it (`CSS.supports`), but its screenshot command leaves backdrop filters out, even on a plain test page, headless or not; so Firefox's look is between Chrome's and Safari's by construction, not by picture.

- `pnpm typecheck`, `pnpm lint` (0 errors) and `python3 scripts/qa/test-local.py` (1,760 tests) pass on `main` 2f0a11e merged in. `scripts/qa/page-weight.js` was not rerun: the change adds only class names.
