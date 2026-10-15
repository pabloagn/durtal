# Task 0622: Reading settings in sections, with only what fits the book

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

The reader audit's top finding (SLN-723). Reading settings were one flat
list of about 25 bare browser controls: number boxes for the font size,
weight, line height, spacing, brightness and warmth, system selects and
native checkboxes. PDF and comic options showed on an EPUB, and text
options showed on a PDF and a comic.

Now the panel is in four sections (Page, Text, Layout, Turning pages) and
uses the app's own controls: sliders with their value beside the name,
segmented choices and switches. A book shows only the settings that change
it.

## Implementation Details

- `src/components/reader/presentation-settings-dialog.tsx`
  - New `kind` prop (`reflowable`, `pdf` or `fixed`). The reader passes it
    from the open file: a PDF, a pre-paginated book (comics and
    fixed-layout EPUBs), or reflowable text. The defaults page passes none
    and shows every setting, with the PDF and fixed-page ones named as such.
  - `Section`: a `type-label` heading, a rule above every section but the
    first.
  - `RangeField`: a label with an `<output>` holding the value, over a range
    input styled as the app's `Slider` (44px tall on touch, 4px track).
    `aria-valuetext` reads the value with its unit. Paragraph spacing and
    indent keep "the book's value" (none of ours) as the slider's first
    stop. Values are rounded to whole steps, so 1.2 never saves as
    1.2000000000000002.
  - Choices (alignment, flow, spreads, line length, page fit, page margins,
    page turn) are `SegmentedControl`s; on/off settings are `Switch` rows
    whose words toggle them too.
  - What shows where:
    - Text: reflowable books only.
    - Flow, line length, side margins: reflowable only.
    - Spreads and page turn: only when the book turns pages (a paginated
      EPUB, a PDF, a comic). Scrolled text hides them.
    - Page fit: PDFs and fixed-layout books. PDF page margins and "Apply the
      page colour to the PDF's pages": PDFs only.
    - "Dim images in the dark theme": everything but a PDF.
- `src/app/reader/[ebookId]/reader-view.tsx`: passes `kind`.
- `scripts/qa/reader-engine-check.mjs`: the font and clear rows turn the
  settings on through their switches (`switchOn`).
- From #310's review: `src/vendor/foliate-js/page-hold.js` slides a turn in
  a whole-screen hold only where `view-transition-name: match-element` is
  supported; an older Safari fades instead, so its bars do not slide with
  the page (patch 26 in `VENDORED.md`, new test in `page-hold.test.ts`).

## Completion Notes

- Reading settings in Chromium, WebKit and Firefox at 1440, 390 and 320, for
  the EPUB, the text PDF and the comic, scrolled through every screen of
  the panel: 0 alignment deviations, 0 low-contrast or unnamed controls, 0
  touch targets under 44px.
- The defaults page (/settings/reader) and its dialog with every setting,
  in the three engines at 1440 and 390: the same, all zero. One Escape
  closes it.
- No settings, defaults or saved values changed; only how they are shown.
- No migration and no new packages.
