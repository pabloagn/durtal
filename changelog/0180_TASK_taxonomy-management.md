# Task 0180: Taxonomy management and domain-specific assignment controls

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-352
**Blocks**: SLN-366, SLN-367, SLN-368, SLN-380

## Overview
SLN-353 (and SLN-290): custom taxonomy families can be created, edited,
reordered and deleted from the app, and records can be classified with them.
Each family states where it applies; changes that would be refused are
explained before saving.

## Implementation Details
- Server (`src/lib/actions/taxonomy-families.ts`): create with explicit scopes in
  one transaction; edit fields and scopes in one transaction; usage preview per
  scope; safe delete of an unused custom family with its items; reorder that
  keeps hidden families after the visible ones; a scoped directory; assignment
  listing and bounded item search for one record. Inputs in
  `src/lib/validations/taxonomy-management.ts`; scope labels and options in
  `src/lib/catalogue/taxonomies.ts`.
- Screens: "New family" and "Reorder" on `/taxonomy`; cards say where a family
  applies; family pages have Edit and Delete. `FamilyForm` offers only enabled
  domains and keeps other scopes; used scopes are locked with a reason.
- `TaxonomyAssignments` on the book page (inside the taxonomy section): terms per
  custom family, removable; Add opens a search marked `data-picker` (↑ ↓ Enter
  from the shortcuts provider, Escape closes), with "Create" for a new term.
  Focus returns to Add after a pick, a removal or Escape.
- Page and family headers wrap on narrow screens so their buttons stay reachable.
- `scripts/qa/preview-local.py`: postgres:16 on loopback, all migrations, a small
  synthetic catalogue, `next dev` through a Neon HTTP bridge that refuses any
  other host or database; no environment file is read.

## Completion Notes
- `pnpm test:local`: 1,140 tests across 86 files, zero skipped, plus five Python
  checks. New database tests: exact scopes and slugs, rename keeps the URL,
  directory hides unopened domains, one family shared by books and films with
  used scopes explained, blocked and allowed deletion.
- Browser (disposable preview, synthetic data): created a family with two book
  scopes, added items, assigned and created terms on a book with the keyboard,
  reloaded, removed, renamed, removed a scope, reordered, saw the in-use
  refusal, then deleted it. Alignment audit at 390, 768 and 1440 px: 0
  deviations over 0.5 px on the changed pages and controls. Older book-page
  parts show 0.52–0.61 px offsets (marks, comment box); not changed here.
- Found and fixed while testing: reorder arrows 0.61 px off (now `CapAligned`);
  headers clipped buttons at 390 px; focus fell to the page after Escape; the
  preview bridge and the Neon contract bridge failed on statements without
  columns (LOCK TABLE).
- A film or perfume page does not exist yet, so the two-domain check runs in the
  database tests; the control is generic over domain and level.
