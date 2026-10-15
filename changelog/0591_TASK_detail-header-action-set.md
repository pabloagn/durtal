# Task 0591: One header action set on every detail kind

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0589
**Blocks**: None

## Overview

SLN-641 design contract, section 12, piece 3 (slice 1 Q3, default). The
person, film, painting, perfume, organization and place pages show the
publisher page's set beside the title: the favourite, a labelled Edit and the
Actions menu. Export moves into the menu. The book keeps its own set (its
collection and copy buttons) until Joris decides; the series page was not in
the piece.

## Implementation Details

- **`DetailEditButton`** (`src/components/shared/detail-layout.tsx`): the
  publisher's outlined Edit, 32px (44px on touch), a link to an editor page
  or a button that opens the edit dialog. Its tooltip names the item ("Edit
  film") and the E then letter key that does the same. The publisher header
  uses it in place of its own link; nothing it renders changes.
- **Edit** sits between the favourite and the menu on the film, painting,
  perfume, organization and place action components and the person header.
  The menu keeps its Edit item, as on the publisher page.
- **Organization**: gains the favourite (organizations share the publisher's
  flag), passed into `OrganizationActions` like the film's.
- **Person**: the Export button goes; the menu gains "Export as CSV", "Export
  as TSV" and "Export as Parquet" (`exportActionItems` in `export-menu.tsx`),
  which download and toast as the button's menu did ("Exported 1 person as
  CSV").
- **Where the controls go under a long title**: the wider set grows headers
  whose controls stay beside a long title. Each kind takes the row rule
  that grows its header least, measured against piece 2 with the contract's
  fixtures: the film keeps `stacked`; the person, painting, perfume,
  organization and place take the book's `wide` rule. The review measured
  588 headers: `wide` is never taller than `free` for those kinds, and a
  line shorter in 23 (long titles at 1024 and up, the painting's column at
  1440); the place ties. The organization's and place's own `icons` rule is
  gone, and `free` is left to the series.

## Completion Notes

- Header controls at 1440 and 390 on the seven pages: the favourite, Edit
  (53 x 32px, 53 x 44px on touch) and the Actions menu on each.
- Header heights against piece 2, the four fixtures, three browsers, seven
  widths (84 each): the publisher and person pages are the same or shorter
  (a person loses Export's width). The film, painting, perfume, organization
  and place headers grow where a long title stays beside the wider set: in
  sum 780px over 11 film measures, 208px over 4 painting, 624px over 12
  perfume, 1612px over 31 organization and 636px over 15 place measures,
  most of them the 90-letter and 32-letter fixtures at 768 to 1024 and on a
  phone; the place is shorter in 15 others. With the old rules the growth
  was 676px (painting), 1300px (perfume), 2288px (organization) and 940px
  (place). The star's icon is 0px from the title's edge in every wrapped
  header; nothing moves after load and no page scrolls sideways.
- Interaction audit (keyboard, dialogs, motion, touch at 390) passes on the
  seven pages. E then letter keys and A then C: the `edit-keys` tests pass.
- Alignment, design, overflow and touch audits clean on the seven pages with
  their own titles and the 90-letter one, in three browsers at 1440, 1024,
  768, 430, 390 and 320 (252 of 252).
- Export from the person's menu downloads the CSV and toasts.
- `page-weight.js` passes. New tests in `detail-title-row` pin each kind's
  set and the Edit button's label, tooltip and size.
- No migration and no new packages.
