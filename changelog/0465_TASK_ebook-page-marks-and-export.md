# Task 0465: Highlight counts and Export on the e-book page

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

The e-book page did not say whether a book had any highlights, notes or
bookmarks, and Export lived only in the reader's marks panel (SLN-500). A book
with marks now shows a "Highlights and notes" block: the counts, linked to the
highlights page filtered to that book, and the same two Export buttons the
reader has.

## Implementation Details

- `getEbookMarkCounts` (`src/lib/ebooks/highlights.ts`) counts one book's
  live marks with the same kind conditions as the highlights page, so the
  numbers match its filters. Notes are highlights with a note, as there.
- `EbookMarksExport` (`src/components/ebooks/ebook-marks-export.tsx`) fetches
  `/api/reader/[ebookId]/annotations` only when a button is pressed, so the
  marks never add to the page's weight, then saves through
  `downloadAnnotationExport`, now shared with the reader's panel
  (`src/components/reader/annotation-export-controls.tsx`). Both save the
  same Markdown and W3C files with the same names. A failed load says so
  beside the buttons and saves nothing.
- The block is left out when a book has no marks.

## Completion Notes

- `ebook-highlights.test.ts`: the counts cover highlights, notes and
  bookmarks, leave out deleted marks and other books.
- New `src/__tests__/ui/ebook-marks-export.test.ts`: nothing is fetched until
  a button is pressed; both files are saved with the reader's names and
  contents; a failed load shows the message and saves nothing.
