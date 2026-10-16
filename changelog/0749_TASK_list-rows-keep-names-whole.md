# Task 0749: List rows keep names whole on a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-829. Design polish pass 4, item 1 (`findings/design-polish-4-2026-10-15.md`).

In list view on a phone:
- Places cut every name past the shortest ("Seed Museum…"). The kind chip, the star and the website link kept their width, and the name got what was left.
- Films, Perfumes and Paintings cut the line under each title, which names who made it: "Seed Person 120 · 1921 · 1h …", "Seed Organization 80 · 19…".

Books' list view had the same fault and was fixed in 0726.

## Implementation Details
- `src/components/shared/work-row.tsx`, `WorkRow`: one row for a film, perfume or painting in a list.
  - The title wraps in full.
  - The maker and the facts are a `FactsRow`, so they wrap between facts and no line starts with a separator.
  - What is held sits under the facts below 640px. From 640px it sits at the row's end, on the title's baseline.
  - The star sits on the title's first line (`CapAlignedControls`, 32px, 44px on touch).
- `FilmRow`, `PerfumeRow` and `PaintingRow` render `WorkRow`.
  - `filmFactParts`, `perfumeFactParts` and `paintingFactParts` give the facts as a list.
  - `filmFacts`, `perfumeFacts` and `paintingFacts` join them, as before, for the collection page.
- `src/components/venues/venue-list-item.tsx`:
  - The name and address wrap in full.
  - Below 640px the kind, Archived and the rating go under the address. From 640px they stay at the row's end.
  - The star and the website link sit on the name's first line. The website link takes the house's 32px icon target (44px on touch) and a "Website" tooltip.
- `src/components/shared/no-photo.tsx`: the perfume bottle drawing (`Flacon`) is marked `data-decorative`. In a 40px list thumbnail the alignment audit read it as an icon beside the title. It is a picture, not an icon.
- The mosaic's caption is unchanged. It is a hover overlay over the picture, hidden from screen readers, and the tile's label carries the full name.
- Test: `src/__tests__/ui/list-rows-whole.test.ts`.

## Completion Notes
See the PR's checks.
