# Task 0188: Collection Navigation, Dashboard and Add Actions (SLN-364)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0155–0182 (curated-library model), 0183 (cookie preferences), 0186 (contrast)
**Blocks**: SLN-365–SLN-370

## Overview
The app names each collection: Books now, and Perfumes, Films and Paintings
once each opens. Navigation, the Add and Go menus, the command palette and the
dashboard list only open collections, and each add action names its
collection. `/perfumes`, `/films` and `/paintings` exist behind their readiness
gates. Book URLs do not change.

## Implementation Details
- One list of sections: `NAV_SECTIONS` and `DOMAIN_SECTIONS`
  (`src/lib/navigation.ts`) drive the sidebar and the command palette;
  `isSectionActive` no longer matches a path that only starts with the same
  letters. `GO_TO` and `ADD` (`src/lib/shortcuts/shortcuts.ts`) take their
  collection entries from the registry, which gives each collection its menu
  keys (`WORK_DOMAINS[kind].keys`: Books keeps `G L` and `A B`). Collections are
  listed in the plan's order: Books, Perfumes, Films, Paintings (`DOMAIN_ORDER`).
  Icons: `DOMAIN_ICONS` in `src/components/shortcuts/section-icons.ts`.
- "Library" becomes "Books" in the sidebar, the Go menu, the palette, the
  `/library` title, its counts ("books", not "works"), its empty state and the
  book page's back link. The palette's search action is per collection
  ("Search books for …").
- Readiness gate: `requireEnabledDomain(kind)` (`src/lib/catalogue/domain-gate.ts`)
  in `src/app/{perfumes,films,paintings}/layout.tsx`. A closed collection
  answers a real 404 for its home and anything below it.
- Collection homes: `DomainHome` (header, add action, switch, empty state),
  `DomainHomeFilters` and `DomainHomeShell` (search, the collection's sorts,
  grid and list views, paging, no-results), `DomainTileCard` and
  `DomainTileRow` (image contained in the collection's slot, or the title's
  first letter; credited people; years), loading and error states. Data:
  `loadDomainHome`, `loadRecentTiles` and `loadDomainCounts`
  (`src/lib/catalogue/domain-homes.ts`) over the existing perfume, film and
  painting services. `catalogueDateYears` (`src/lib/catalogue/dates.ts`) prints
  "1888", "c. 1503–1519", "44 BC" or the date's label.
- Collection switch: `DomainSwitch` under a home's title, shown when two or
  more collections are open. `domainSwitchHref` keeps the search, the
  destination's own filters and a sort it offers (with its order); the page and
  page size start again, so each home keeps its own saved size.
- Saved views: `useViewModePreference` returns the saved view only when the
  page offers it. `/library` uses it (`LIBRARY_VIEW_MODES`); each collection
  home saves its own (`durtal-perfumes-view-mode`).
- Dashboard: a block per open collection (heading, counts, add actions; Books:
  Books, Editions, Instances, Authors, Add book, Import books), Recent additions
  across the open collections, newest first, the first 4 collections in their
  curated order, then Highest rated (was "Favourites", which counted top
  ratings, not the favourite flag), Recent authors and Wanted. On a phone the
  count cards drop their decorative icon box so labels fit.
- `PageHeader` takes `tabs` (navigation under the title). `DomainAddLink` is a
  link styled as a button, not a button inside a link.

## Completion Notes
- Tests: `src/__tests__/catalogue/domain-navigation.test.ts` (only open
  collections in every menu, unique menu keys including unready collections,
  section matching, switch rules, the gate and each layout, year labels) and
  `src/__tests__/integration/domain-homes.test.ts` (counts per collection and
  creator role, a home page from its URL, newest records). The full local suite
  passes 1,216 tests across 91 files; lint and typecheck pass.
- Browser QA on the disposable preview: `/perfumes`, `/films`, `/paintings`
  and `/films/x` answer 404, and the dashboard has no link to them, even with
  records of those kinds in the database. The alignment audit (with the
  `holder ?? text` fix) and the design audit report 0 issues and 0 low-contrast
  text on `/` and `/library` at 1440, 768 and 390 px.
- The collections were also opened for QA only (not committed): the switch kept
  `q`, `sort=rating&order=asc` and dropped `status=wanted`; Perfumes, Films
  (empty state) and Paintings (no results) showed grid and list views; an
  invalid saved view fell back to the grid; the dashboard mixed recent records
  across collections. Alignment and contrast were clean at 1440 and 390 px; on
  a phone the toolbar search takes its own row and the sorts wrap.
- Known, not changed here: on a phone the book grid and the `/library` toolbar
  overflow, and book cards spill "0 copies" at 768 px (SLN-312). The grid-size
  slider and book card menus have no accessible name (shared components).
