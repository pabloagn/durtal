# Task 0202: Perfume Home, Detail and Editing (SLN-366)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0188 (SLN-364), SLN-357 (perfume services), SLN-361 (domain media), 0200 (SLN-281)
**Blocks**: SLN-382 (opening perfumes), SLN-380 (responsive and alignment verification)

## Overview
Perfumes get their own screens on top of the SLN-357 services: a home with
filters, a detail page, and every editing workflow. A reader can add a
fragrance with its house, perfumers, dates and notes; add formulations
(concentrations as sold) with their own perfumers, notes, families, accords
and image; keep bottles, samples and decants; note retailer listings and their
prices; cite sources; and curate (favourite, rating, personal notes).

Perfumes stay closed (`WORK_DOMAINS.perfume.enabled = false` and the database
kind check) until SLN-382 opens them, so `/perfumes` still answers 404 on the
live app. Every screen was checked on a local preview with perfumes open.

## Implementation Details

**Home** (`src/app/perfumes/page.tsx`): title, Add perfume, the collection
switch, search, sorts (title, release, added, rating), grid and list views,
paging, and empty, no-results, loading and error states.
- Filters (`perfume-filters.tsx`) live in the URL: house, perfumer, family,
  accord, note, concentration, holding, container, favourite and release years
  (`from`, `to`). `perfumeQueryFromParams` (`src/lib/catalogue/perfume-params.ts`)
  drops unknown or malformed values, swaps reversed years, and treats "owned"
  plus "not owned" as no filter. Broader families take in their narrower items.
- `PerfumeCard`: the bottle contained in a square frame over its own tone, or a
  flacon drawn from the title (`Flacon`, `src/components/shared/no-photo.tsx`);
  title on two fixed lines, house, and "1925 · EDP · Extrait"; chips for a
  favourite and the count held. `PerfumeRow` is the list form.
- Cards per row: `COL_CLASSES` (`src/components/domains/domain-home-shell.tsx`)
  now uses container queries inside an `@container`, so a narrow page holds
  fewer cards (two on a phone, each about 115px or wider). Desktop keeps every
  slider value. Films and paintings use the same map.

**Detail** (`src/app/perfumes/[slug]/page.tsx`, `loading.tsx`, `not-found.tsx`):
the hero image (the chosen formulation's, else the perfume's), the favourite
toggle and action menu beside the title, house and perfumer links into the
filtered home, creative direction, launch and discontinuation, manufacturer,
concentrations, what is held and the rating. Then the description (`Prose`),
the note pyramid (edited in place), families and accords, formulations
(`?formulation=` shows one formulation's own values), bottles and samples with
a gauge of what is left, retailers with prices, gallery, sources, personal
notes, and related perfumes (same house, same perfumer, shared notes).

**Editing**: `PerfumeForm` (create page and edit dialog), `FormulationDialog`
(own or inherited perfumers, notes, families and accords), `BottleDialog`
(formulation, kind, size, what is left, status and disposal, storage place,
acquisition date, supplier, shop, price), retailer listing and price forms,
source citation, and `ConfirmDeleteDialog`, which lists what blocks a delete.
Pickers (`SearchPicker`) take arrow keys and Enter and can create a house,
person or shop; `⌘Enter` saves the form or dialog in front.
`CatalogueDateField` edits a date of any precision (unknown, year, month, day,
range, approximate) with plain error messages (`src/lib/catalogue/date-draft.ts`).

**Services**:
- Readable slugs: `{title}-by-{house}`, numbered when taken, set at creation
  and kept on edit. A slug race retries twice, the last time with the id.
- The organization role a link needs (house, brand, manufacturer; retailer for
  a supplier or listing) is added in the same transaction as the link.
- `getPerfumes` filters by concentration and returns each card's formulations
  and image tone. New: `getPerfumeFilterOptions()` and `getRelatedPerfumes(id)`.
- Sources: `citeSource()` records a reader's citation (accepted, provider from
  the URL host) and `deleteCitedSource()` removes an unlocked one that nothing
  cites. Provenance, curation, taxonomy and retailer writes return readable
  messages for database rule failures, never SQL.

**Shared changes**:
- `CapAlignedControls` (`src/components/shared/cap-aligned.tsx`, new export):
  puts controls that open a menu on the title's cap-height center. It clips
  nothing, so the menu shows, and the controls take the body type again.
  `CapAligned` is unchanged.
- `Select`: a generated id when none is given (labels name the field), an
  `ariaLabel` prop, and keys with a modifier are left to the shortcuts
  provider, so `⌘Enter` saves from a select.
- `GridSizeSlider` has an accessible name. `MediaManagerDialog` and
  `UploadZone` accept formulation images with a square slot.
  `TaxonomyItemSearch` is exported for the note editor.
- `scripts/qa/preview-local.py`: the Neon bridge passes JSON parameters through
  unchanged and encodes array and JSON results by column type; a dump restore
  drops the rehearsal schema first. `neon-batch-contract.test.ts` checks the
  same encoding.

## Completion Notes
- Tests: the full local suite passes 1326 tests across 102 files on the
  task commit, and 1359 across 103 after merging fix/backlog-0116-0121, none
  skipped, plus the Python book import checks. New: `perfume-home.test.ts`,
  `date-draft.test.ts` and `perfume-experience.test.ts` (slugs, roles,
  filters, filter options, related perfumes, formulation images, cited
  sources); updated perfume services, render and Neon contract tests.
  `pnpm typecheck` and `pnpm lint` are clean.
- Browser, on the preview with perfumes open: create, edit and delete flows;
  formulations, bottles, samples, a disposed bottle, listings and prices,
  sources, favourite, rating and personal notes, each saved and reloaded; every
  filter in the URL; portrait, square and transparent images.
- Measured with `alignment-audit.js` (the 9073348 baseline) and
  `design-audit.js`: the home (grid and list), detail (with and without a
  formulation), a sparse perfume, the create page and the dashboard at 1440,
  768 and 390px; the home list and the detail also at 1024px; all ten dialogs
  at 1440 and 390px. Everywhere: no deviation over 0.5px, no text under 4.5:1,
  no unnamed control, no horizontal overflow. Title and row menus sit
  0.00–0.01px from the title's cap-height center.
- Follow-ups outside this task: the book and other slider grids have the same
  phone-width fault (a separate session is on it); the book title buttons sit
  5.35px above the cap-height center (SLN-398 session); the audit misses icons
  more than four levels below their row (alignment audit session); the book
  list toolbar overflows by 12px at 1024px and its view icons measure 10.09px
  off where it wraps (older than this task, `entity-filters.tsx`).
