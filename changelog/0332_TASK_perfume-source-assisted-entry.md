# Task 0332: Perfume source-assisted entry

**Status**: Completed
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: 0331 (SLN-375), SLN-357
**Blocks**: None

## Overview

SLN-377. Perfume facts can be entered from a source without conflating
perfumes or formulations. The sources were evaluated: Wikidata is the one
with a documented public API and is looked up; Fragrantica, Basenotes and
Parfumo have no public API, so they are cited and only their addresses are
read. Every lookup is reviewed against the perfume before anything is saved.
Manual entry stays complete without any source. No schema change.

## Implementation Details

- `src/lib/catalogue/perfume-sources.ts`: the evaluation (`PERFUME_SOURCES`:
  access, why, what each has), `readPerfumeLink` (the perfume, house, source
  id and concentration a Fragrantica, Basenotes, Parfumo or Wikidata address
  names; never the page) and `splitConcentration` (a concentration only from
  the last words of a name).
- `src/lib/providers/wikidata-perfumes.ts`: the SLN-375 contract for
  Wikidata: search keeps items whose P31 is Q131746 (perfume); detail reads
  the label, description, brand (P1716), manufacturer (P176), perfumers
  (P14539) and launch (P571, else P577) at its own precision. A brand is
  proposed as a brand and a manufacturer as a manufacturer.
- `src/lib/actions/perfume-sources.ts`: `searchPerfumeSource`,
  `reviewPerfumeSource` (each field `fill`, `same`, `conflict` or `locked`;
  brands and perfumers matched by Wikidata id, then by one exact name),
  `applyPerfumeSource` (fetches again; keeps an accepted observation with the
  item's id, which another perfume cannot hold; fills chosen empty fields;
  adds chosen brands, manufacturers and perfumers, created when missing,
  perfumers credited as attributed; replaces nothing; a locked Wikidata source
  refuses the save) and `recordPerfumeEntrySource` (a new perfume's link,
  cited without reading it, or a Wikidata item kept as an observation).
- Add perfume: an optional source link above the form. It says what the
  address names, can take the name, can add the formulation the name ends
  with, and looks a Wikidata item up ("Use these" fills empty fields and adds
  matched brands and perfumers). Saving keeps the link as the source.
- Perfume page: "Look up" beside "Add source" searches Wikidata and shows the
  review with a switch per fillable field and per brand or perfumer.
  `SourcesSection` takes a `lookup` control. Notes: the notes added cite the
  source chosen above the editor; `NotePyramid` names a note that its sources
  place in more than one tier.
- Docs: 04, 06, 08 (perfume sources table), 14.

## Completion Notes

See the PR for test and browser results.
