# Task 0207: Book, author and place pages: reading column and record column

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0203
**Blocks**: None

## Overview

SLN-398. Below the header, the book page was one column of up to twelve blocks, each with the same 30px title. Record data (catalogue status, media counts, metadata source) had the same weight as the description and the editions, and empty blocks still showed ("No taxonomy assigned", "Hunting for" with only a hint on owned books, an empty map on places). The author page showed its name fields before the books. Now each detail page has a reading column and, from `lg` up, a narrow record column; empty blocks are left out.

## Implementation Details

- `src/components/shared/detail-layout.tsx`: `DetailColumns` (reading column + 18rem record column from `lg`, 48px apart; below `lg` the record follows the reading content; with no reading content the record keeps its own width), `RecordPanel` (one bordered `bg-secondary` panel, groups split by hairlines), `RecordGroup` (caption title, optional text action), `RecordFields` and `RecordField` (label over value).
- Book page (`src/app/library/[slug]/page.tsx`):
  - Reading column: description, notes (moved up from the bottom), hunting targets, editions.
  - Record (`work-record.tsx`): Details (`work-metadata-grid.tsx`, now `WorkDetails`), Taxonomy (`work-taxonomy-section.tsx`, now a record group, left out when the book has none; "Edit Taxonomy" and T stay in the actions menu), Media (counts that are not zero), Orders (status, date, venue; link to the pipeline), Links (external links and the metadata source).
  - Full-width rows below: gallery, series, more by the author, collections, similar books, marks, activity.
  - "Hunting for" shows when the book has targets or is still looked for (wanted, shortlisted, tracked); owned books with no target leave it out.
  - `work-media-inline.tsx` deleted: it only showed the counts, now in the record; "Manage Media" stays in the actions menu.
  - The cover-color glow (`ambient-crystals.tsx`) now fades out by 58% of its height (was 100%), so it stays behind the header and ends above the description.
  - The recommender's website icon in the header sat 0.72px off the name's cap-height center (found by the new probe-based audit); it now uses the CapAligned technique inline, at the name's size.
- Author page: reading column with the bio, the books (3 per row beside the record, 245px cards; 4 per row with no record) and edition contributions; record with Details (sort, first, last and real name, metadata source, in sentence case) and Links (website, Open Library, Goodreads); gallery and activity full width below.
- Place page: reading column with specialties, tags and notes (a description, when there is one, in `Prose`); record with Contact, Opening hours and Visits. The "Map integration coming soon" placeholder is gone.
- `docs/03_DESIGN_LANGUAGE.md`: "Detail pages".

## Completion Notes

Measured on the dev server at 1440x900:

- `/library/i-by-wolfgang-hilbig` (one edition): 2,856px tall before, 2,110px after: 26% shorter. Reading column 768px, record 288px, 48px apart. The ticket's 30% was an estimate: the rest of the height is the description, the edition and the related books, which stay; moving the activity (with its comment editor) into the 288px record would need a toolbar that does not fit.
- Empty blocks left out: no "No taxonomy assigned", no empty "Hunting for" on owned books, no map placeholder. A wanted book (*A Fairly Honourable Defeat*) keeps its hunting prompt; *Discipline and Punish* shows its taxonomy in the record.
- `/authors/karl-ove-knausgard`: books first, 3 per row at 245px, one card height (511px); the name fields in the record.
- `/places/antiquariaat-a-kok-zn`: Specialties and Notes in the reading column, Contact in the record.
- Phone (375px): the record stacks after the editions and before the related rows; the page is no wider than before (SLN-312).
- `scripts/qa/alignment-audit.js` (the new probe-based version): no deviations on two book pages, an author page and a place page. Contrast: 0 texts under the limit; the record's weakest text is 5.04:1. Rendered sizes stay in the scale.
- `pnpm typecheck` and eslint pass.
- Found, not fixed here: the book title's buttons sit 5.35px above the title's cap-height center (before and after this change). `CapAligned` would clip the actions menu; the fix uses `CapAlignedControls`, which SLN-366 adds. Follow-up once it lands.
