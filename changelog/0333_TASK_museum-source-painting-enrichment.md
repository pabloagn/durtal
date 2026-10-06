# Task 0333: Museum-source painting enrichment

**Status**: Completed
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0331 (SLN-375), 0332 (SLN-377, for the `lookup` control), SLN-360
**Blocks**: None

## Overview

SLN-378. A painting and its original can be filled from a museum's open
collection, reviewed field by field. A location is never taken from
ownership: only a museum's own dated answer that the work is on view can
record, check or move a location, through the same history rules as a manual
record. A museum that does not show the work changes nothing, so an unknown
location stays unknown. No schema change.

## Implementation Details

- `src/lib/catalogue/painting-sources.ts`: the evaluation
  (`PAINTING_SOURCES`): the Art Institute of Chicago and The Met are looked up
  (open APIs, no key, CC0 data); the Cleveland Museum of Art is open but not
  connected yet; the Rijksmuseum and Smithsonian need keys; Wikidata's
  collection and location statements have no dates. `compareSizes` compares
  sizes across mm, cm and in within 0.5 cm; `sourceChanges` names what changed
  between two answers.
- `src/lib/providers/museums.ts`: both museums through the SLN-375 contract,
  in one answer shape (`MuseumArtwork`): title, attribution, date, medium,
  size in cm, accession number, credit line, on view (true, false, or not
  said) with the gallery, and a public-domain image with its credit and
  license. Proposals are split: the work (title, date, painter) and the
  object (owner with the museum's Wikidata id, accession number, size,
  display, image).
- `src/lib/actions/painting-sources.ts`: `searchPaintingSource`,
  `reviewPaintingSource` (verdicts per field; the painter matched by one exact
  name and never in place of a painter here; the owner matched by Wikidata id,
  then one exact name; the location evidence with its day and what saving
  would do; the museum's last answer, its age, stale after a year, and what
  changed) and `applyPaintingSource` (fetches again, checks the painting, the
  original and the location history fingerprints, keeps the answer as an
  accepted source that follows the museum's previous answer, fills chosen
  empty fields, credits the painter as attributed, adds the original when the
  painting has none, and writes a location only from an "on view" answer: a
  first record at the museum's operated venue since an unknown day, a check
  of the current record there, or a move dated the day of the answer). Sources
  the person already cited stay on the date, the object and the location
  record. A locked source stops the save.
- Painting page: "Look up" in Sources: choose the museum (and the original
  when there are several), search, then a review with a switch per field, the
  painter, the original, the location step (a move is off by default) and the
  museum's image, which goes to the original through `/api/media/from-url`
  with its credit, license, source link and source record.
- Docs: 04, 06, 08 (museum sources table), 14.

## Completion Notes

- `src/__tests__/integration/painting-sources.test.ts` (7 tests, local
  PostgreSQL, The Met answered by a fixture): results from the museum's
  collection; an original owned by the museum and on loan elsewhere is moved
  back only when the person takes the step, on the day of the answer, and the
  loan closes; a work the museum does not show fills the owner and accession
  number but no location, which stays unknown; a size in inches matches the
  museum's centimetres, a different size stays, an empty one fills; an
  attribution the museum changed and an answer 401 days old are shown, the new
  answer follows the old one and the painter here stays; a locked source
  refuses the save and the museum unreachable leaves manual entry working; a
  painting with no original gets one with its owner and a first location.
  One museum object belongs to one painting.
- `src/__tests__/catalogue/painting-sources.test.ts` (6): the evaluation, both
  museums' answers, proposals without a location, sizes across units, answer
  diffs.
- Both museums answered live once through the adapters (Art Institute 27992,
  Met 437394). The Met's `v1/search` answered 410: it was retired on
  2026-10-01, so the adapter uses `v1.1/search`.
- `python3 scripts/qa/test-local.py` on main 4f5642e: 2,473 tests passed,
  none skipped. Typecheck and lint of the changed files are clean.
- Headless Chrome, Firefox and WebKit at 1440 and 390 px: the painting page,
  the look-up dialog, The Met's results and the review of a real answer. No
  alignment deviation over 0.5 px, no low contrast, no unnamed or nested
  control, no overflow. Fixed on the way: a fixed two-line height under each
  value, and a key warning on the lookup control.
- Production build preview: `page-weight.js` within every budget except
  `/organizations/*`, which has nothing to measure (no organization in the
  preview seed). A painting page 90 KB.
- Limitations: each museum knows its own collection only and places an object
  only when it shows it. The steps of a save are each atomic, not one
  transaction.
