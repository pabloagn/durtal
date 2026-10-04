# Task 0276: Merges and Duplicate Checks for Films, Perfumes and Paintings (SLN-373)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-347, SLN-349, SLN-350, SLN-352, SLN-357, SLN-358, SLN-360, 0268 (work relations)
**Blocks**: None

## Overview
Harmonization knew books only. Its scan skipped films, perfumes and
paintings, and a merge of two of them was refused ("Book harmonization can
only merge books"), because the database refused to move their versions,
copies, formulations, listings and objects to another work. Now the scan
flags two works of one kind with the same title by the same maker, and a
merge joins them with everything under them. A remake, a second painting of
one subject or a flanker stays apart, and a merge between two kinds is
refused.

## Implementation Details

**Migration** `0060_domain_work_merges` (custom SQL; generated as 0059 first,
regenerated on main once `0059_collection_works` landed, with the same SQL;
no migration in between touched these functions). It replaces six guard functions at
their latest definitions, changing only the move checks:
`guard_catalogue_source_owner` (0042) maps film, perfume and painting sources
to the `works` merge; `guard_film_record`, `guard_film_holding` (0046),
`guard_perfume_record` (0044), `guard_perfume_retailer_link` (0045) and
`guard_painting_record` (0047) allow a change of `work_id` only when
`harmonization_allows_move('works', old, new)` holds for the current audited
merge. A painting's reproduction may point at an object that moves in the
same statement. Every other change is refused with the same message as
before.

**Merge** (`src/lib/harmonization/merge.ts`, `domain-merge.ts`, `store.ts`):
- `mergeReferences("works")` adds the tables keyed to a profile's `work_id`
  (`referencesToDetail`: film companies, countries, languages, versions and
  copies; perfume notes, houses, formulations and listings; painting
  objects). The snapshot, the fingerprint, the locks and the moves use it.
- A merge needs two works of one kind; otherwise "A film and a book cannot
  be merged. Choose two records of one kind."
- `domainMergeConflicts` reads the snapshot and blocks identities the
  database keeps unique per work: two film versions with one label, two
  formulations with one concentration and labels, two listings of one
  retailer page, two originals or versions of a painting with one label.
  Each says what to fix first.
- The preview shows the profile's differing values as `detail.*` fields
  ("Original title", "Release date", "Source record reference"), with dates
  as text and sources by provider. `executeMerge` splits the choices, keeps
  the kept work's profile (a copy of the merged one's when it has none, made
  after the sources move), applies the chosen values after the merged work
  goes, and removes profile dates nothing points at.
- `mergeOrder`: sources and identifiers first, then profiles and editions,
  then versions, formulations, objects and acquisition targets, then the
  rest, then orders. Credits the kept work already has collapse to one
  (`workCreditMergeQueries`).
- The fail-closed check now covers each profile table too: an unknown key to
  a profile blocks the merge.

**Scan** (`domain-duplicates.ts`, `engine.ts`, `store.ts`): `loadDataset`
adds `domain_works` (title, slug, release or creation year, makers, linked
works). The `duplicate-work` rule pairs works of one kind and one normalized
title that share a maker (director, perfume house or brand, painter). A
different maker, years more than one apart, or a `work_relations` link keeps
a pair out. High confidence with a shared maker and one year; medium when a
year is missing or one apart; low when a side has no maker. Findings carry
the collection's label ("Films", "Perfumes", "Paintings") and link to the
collection's page; the Harmonize entity filter lists the three.

**Addresses** (`redirect.ts`, `engine.ts`, `src/app/{films,perfumes,paintings}/[slug]/layout.tsx`):
a merged work's old slug or id opens the kept work on its collection's
page, and finding records link there.

**Docs**: 02 (Book scope paragraph; Harmonization), 04 (`/harmonize`), 14.

## Completion Notes
- Tests: `domain-harmonization.test.ts` (8): a plain change of work is still
  refused on film versions and copies, film sources, perfume formulations and
  listings, and painting objects; an audited merge of each kind moves every
  row (counts per table before and after, only duplicates collapse), keeps a
  copy on its version and release, a container on its formulation, a
  reproduction on its original and a location record on its object; profile
  values are chosen and unused profile dates removed; colliding identities
  and a book/film pair are blocked; a change after the preview moves nothing;
  the scan flags a same-title, same-maker pair and never a remake, a pair
  years apart, a linked pair or two makers. The book isolation test now
  expects the new cross-kind message.
- The first full run found one bug: credits moved by a person merge went
  through the new per-work credit step. It now applies to a work's credits
  only; `people-credits` and `film-services` pass again.
- `pnpm typecheck` clean; `pnpm lint` 0 errors, 81 warnings (main's count).
- Browser, preview from the 2026-10-04 11:37 backup with seeded films and
  duplicate films, perfumes and paintings: Harmonize in Chrome, Firefox and
  Safari at 1440 and 390 px. Each kind's finding (Films, Perfumes,
  Paintings) shows its evidence ("Same director: John Carpenter."), the merge
  review shows the profile's "Release date" choice, and the confirm dialog
  lists the moves. `alignment-audit.js` and `design-audit.js`: 0 issues, 0
  low-contrast texts, no console errors, except Safari's confirm dialog,
  whose buttons the dialog bug below hid (2 unnamed controls). One merge in Chrome moved the
  version, the copy and the credits; the old address opens the kept film in
  all three browsers. Safari's dialog bodies collapse on main; that is fixed
  separately (SLN-443, PR #81).
