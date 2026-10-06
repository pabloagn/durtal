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

- `src/__tests__/integration/perfume-sources.test.ts` (6 tests, local
  PostgreSQL, Wikidata answered by a fixture): search keeps perfumes only; a
  review sets each field against the perfume; a save fills only empty fields,
  adds a brand and a perfumer with their source and Wikidata ids, and the same
  save again adds nothing; a different launch year and description stay, the
  source keeps what Wikidata said, and a locked source refuses the save; one
  Wikidata perfume cannot be given to a second perfume of the same name, and
  two people of one name match neither; a Fragrantica link is cited without a
  fetch, its formulation is added once, and two sources that place one note
  differently are both kept; with Wikidata unreachable every action answers
  with a message and manual entry works, and a lookup leaves a stale retailer
  listing as it was.
- `src/__tests__/catalogue/perfume-sources.test.ts` (5): the evaluation, link
  reading for each source, concentrations, Wikidata dates and proposals.
- The three providers answered live once (Wikidata Q820507: Chanel brand,
  Ernest Beaux, 1921).
- `python3 scripts/qa/test-local.py` on the stacked SLN-378 branch, which
  holds this branch unchanged, on main 4f5642e: 2,473 tests passed, none
  skipped. Typecheck and lint of the changed files are clean.
- Production build preview: `page-weight.js` within every budget; the one
  failing row, `/organizations/*`, has nothing to measure (the preview seed
  has no organization). `/perfumes/new` 56 KB, a perfume page 88 KB.
- Headless Chrome, Firefox and WebKit at 1440 and 390 px: the add form, a
  Fragrantica link, a Wikidata look-up, the perfume page, notes in edit, the
  look-up dialog, results and review. No alignment deviation over 0.5 px, no
  low contrast, no unnamed or nested control, no overflow. The checks found a
  fixed two-line height under each proposed value and a missing key; both are
  fixed. Wikidata answered 429 when the checks called it too fast; the dialog
  showed "Wikidata asks to wait before the next call".
- Review fixes (PR #123): a link whose path holds a stray "%" (not an
  escape) threw a URIError in the field's change handler, so Add perfume
  refused the text and logged an error. `readPerfumeLink` now keeps such a
  part as it is ("No 5%"); a unit test covers it.
- Limitations: Wikidata covers well-known perfumes only, without notes or
  concentrations. Fragrantica, Basenotes and Parfumo are read by address only.
