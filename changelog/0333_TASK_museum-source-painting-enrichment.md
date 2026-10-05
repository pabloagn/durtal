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

See the PR for test and browser results.
