# Task 0282: Collection Journeys and Export of the New Kinds

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0267
**Blocks**: None

## Overview

SLN-379, the gaps task 0267 left open: no automated browser journeys for perfumes, films and paintings, and no way to export them (the export half of SLN-375). This task adds both.

## Implementation Details

- `src/lib/export/collections.ts`: one row per record for perfumes, films and paintings, in title order, read through the same card loaders as the lists (500 ids a call). Records of another kind are left out.
  - Perfumes: title, houses, manufacturers, perfumers, released, concentrations, families, accords, top, heart, base and other notes, bottles, samples, decants, rating, favourite, notes, description.
  - Films: title, original title, directors, writers, cast, released, runtime, countries, languages, genres, physical and digital copies, rating, favourite, notes, description.
  - Paintings: title, painters, painted, movements, genres, techniques, media, supports, the original (or a version), its owner, height and width in cm, objects owned, rating, favourite, notes, description.
- `POST /api/export` takes `perfumes`, `films` and `paintings` as `entity`, with `ids` or `all`. A closed collection answers 404. File names: `durtal-perfumes-all-<date>.csv` and so on.
- Settings › Data: an export row for each open collection.
- `scripts/qa/journeys.mjs`: drives a headless Chrome over the DevTools protocol (no dependency) through each collection against a running server: create through the add form, reload, favourite and reload, edit the title through the Actions menu and reload, find the record by search and by the favourites filter, export it, delete it, then its page shows the not-found view and the export leaves it out. Exit 1 on the first failed step. It writes and deletes records, so it runs against a disposable database only:

  ```bash
  python3 scripts/qa/preview-local.py --port 3410 --from-dump <backup.dump>
  node scripts/qa/journeys.mjs http://127.0.0.1:3410
  ```

- Docs: `docs/05_API_REFERENCE.md` (export entities) and `docs/04_ROUTES_AND_VIEWS.md` (Settings › Data).

## Completion Notes

- Integration tests: each collection exports one row per record with its makers, classification and holdings; a film id asked for as a painting gives no row; the route answers 200 with `durtal-perfumes-all-…`.
- `node scripts/qa/journeys.mjs http://127.0.0.1:3410` on a disposable restore of `live-before-0053-0056-20261004-113735.dump`: perfumes, films and paintings pass all eight steps.
- Settings › Data at 1440, 768 and 390 px: `alignment-audit.js` and `design-audit.js` report 0 deviations, 0 low-contrast texts, 0 unnamed controls, no console errors.
- `node scripts/qa/page-weight.js`: 9 of 10 routes within budget; `/library` stays at 313 of 300 KB, as on main (left to the page-speed work).

### Found, not changed

- A deleted or mistyped perfume, film or painting address shows its not-found view with status 200, not 404. The collection and detail segments have a `loading.tsx`, so the page streams and the status is sent before the page finds no record. Books have no loading boundary and answer 404. Readers see the right page; only the status differs.
- A whole-collection export of an empty collection answers 404 (no record matched), as books and authors do.

### Not covered (SLN-379 stays open)

- **Collect:** collections hold book editions only, so perfumes, films and paintings cannot be collected yet.
- **Books in the browser:** the book entry, edition and copy, reader, series, publisher, acquisition, API and harmonization flows are covered by the suites, not by a browser journey.
- **Scenarios:** shared person identity across kinds, a perfume sample of one formulation, a film cut with characters and a museum-owned painting on loan with a separate reproduction are not in the journeys.
- **Import** of the new kinds (the other half of SLN-375).
