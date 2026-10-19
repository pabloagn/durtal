# Task 1034: Cover fallbacks

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1066, from findings/images-survey-2026-10-18.md (sections 1 to 3) and findings/duplication.md (section 15). Rows, pickers and queues showed a "No cover" text box, no box at all, an empty box or the browser's broken-image mark where every card shows the title's letter in a 2:3 box. About twenty places drew their own letter with `title[0]` (a quote mark, a lowercase letter or half a surrogate pair), and people got one letter where their cards show initials.

## Implementation Details

- New `src/components/books/cover-thumb.tsx` (`CoverThumb`): a small cover in its 2:3 box, the image through `FadeImage` with `CoverLetter` as its fallback, else `CoverLetter`. The class sets the width, or both sides where a row keeps its old box (`h-10 w-7`); `style` takes a poster's crop, `contain` keeps a perfume bottle whole.
- `CoverThumb` replaces the hand-made boxes in the Identify queue, e-book review rows and differences, Add books to a collection (editions and works), the reading book picker, Match again (chosen result and results), Add book search and confirm, the six provenance thumbnails (order steps, detail panel, pipeline, list), Harmonize's proposed poster and a person's edition contributions. Rows without a cover keep the box, so titles start on one edge.
- `FadeImage` fallbacks added where a failed image left a bare frame or a broken mark: the Add book duplicate step, the e-book link panel (whose letter is now `CoverLetter`), both people timelines and the people map popover (which now always shows a portrait box, with initials when there is no photo).
- `CoverLetter` replaces the letters in the book timelines (row and marker) and the place page header.
- `Monogram` (`no-photo.tsx`) is the `monogram` size container: 12px `fg-primary` initials under 40px wide, 21px `fg-primary` from 40px, and the card's 46px `fg-secondary` from 120px. It replaces the single letters in people list rows, the people list view, recommender list rows and both people timelines.
- `CoverFan` moves to `shared/cover-fan.tsx` (a client component, still exported from `no-photo.tsx`): a cover that fails leaves the fan and the others close up; with none left it shows its new `fallback`, the initials or the collection's letter. The author card, recent people, the people mosaic and the collections mosaic pass it, so a fan with no covers is the same call.

## Completion Notes

- A grep for `title[0]`, `title?.[0]` and `name[0]` in `src/app` and `src/components` is clean, and a unit test keeps it so (`cover-fallbacks.test.ts`).
