# Task 0930: Placeholders fit a phone

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-946, finding 5 of `findings/forms-survey-2026-10-15.md`. Thirteen forms had a placeholder too long for its field on a phone, so it was cut mid-word. Each is now short enough to show whole at 320px, and a format the reader needs moved to a hint line under the field.

## Implementation Details

- `Input` (`src/components/ui/input.tsx`) takes an optional `hint`: a line under the field that names the field's description. An error takes its place. A description the caller passes is kept beside the error's, where before it replaced it.
- Shorter placeholders:
  - Book links: `goodreads.com/book/show/…` and `app.thestorygraph.com/…` (a link without its scheme is still accepted and saved as https).
  - Sort name: `Last, First`; on Add person the hint says an empty sort name is made from the name.
  - Place: `Search for a place…`, `e.g. rare books, first editions`; Type and Subtype stack on a phone.
  - Series: `e.g. The Human Comedy`, `e.g. La Comédie humaine`.
  - Taxonomy family: `e.g. Reading mood`.
  - Sources (films, paintings, perfumes, and Link a work): a short example name; Address is `https://` with the hint "None for a book or a box".
  - A film's version: `e.g. Director’s cut` with the hint "Leave it empty when the version has no name".
  - A painting's version or reproduction: `e.g. framed, 95 × 120 cm`.
  - Add to collection: `Find or create…` (its name stays "Find or create a collection").
  - Add book and Match again: `Title, author or ISBN`; Match again's field gets that as its name, which it had only from the placeholder.
  - Add painting: `e.g. The Night Watch`.
  - Log progress: `212, 44% or +20`, with every format in the hint line.
- Add a quote: Page and Chapter stack on a phone, so the page formats show whole, and the Edition field wraps a long edition name (the `wrap` of SLN-932), as Start reading's does.

## Completion Notes

- Measured every placeholder in each form against its field's content box in Chromium, Firefox and WebKit at 390 and 320 (touch), and Log progress with a mouse at 320: none is cut. Textarea placeholders wrap and were left.
- Alignment and design audits clean on the routes that hold these forms, in three engines at 1440 and 390.
- Tests: `src/__tests__/ui/short-placeholders.test.ts`; `add-book-query.test.ts` finds the search by its name.
