# Task 0179: Publishing house taxonomy

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0171, 0172
**Blocks**: None

## Overview
The owner asked for an industry-standard, impeccable taxonomy for publishing houses. Houses were flat (no imprints, a one-level parent that could not change once used), so the big groups could not be expressed: ISBNdb names every Penguin book "Penguin", Vintage UK and Vintage US shared one house, and 192 editions waited in the inbox. Approved proposal: group → publisher → imprint, books link to the imprint printed on them, one brand across markets (decision 1), same-name companies kept apart, defunct imprints kept under their last owner, ISBN prefixes on publishers.

## Implementation Details
- Migration `0036_publisher_hierarchy`: `group` type; parents imprint → publisher → group; types and parents may change while the houses below fit, logged in `publisher_hierarchy_changes`; `publisher_family()` roll-ups for pages, counts, the library filter and `target_accepts_edition`; same-name houses decided by the ISBN rule of their family; only the most specific link stays; `durtal.defer_publisher_refresh` and `refresh_all_publisher_links()` for large restructures; `edition_enrichments` log.
- Structure: `src/lib/publishers/taxonomy.ts` (Penguin Random House, HarperCollins, Macmillan, Profile Books, Oxford University Press, Bloomsbury; their publishers, imprints, aliases, ISBN prefixes; National Geographic Books as not a publisher). HarperCollins has one HarperCollins Publishers for the UK and US, consistent with decision 1 (the proposal had split it).
- Evidence: Open Library publisher and series text names an imprint; it is taken only when the ISBN prefix belongs to that imprint's publisher, else its group (US divisions share prefixes). Market from the place of publication or a one-market prefix. Written only into empty fields, logged, undoable.
- Engine `src/lib/publishers/taxonomy-apply.ts`, script `scripts/publishers/taxonomy.ts` (dry run in a rolled-back transaction by default, `--apply`, `--undo RUN_ID`, Open Library cache).
- App: group type in the editor (parent picker follows the type), publisher pages show "Imprint of … , part of …" and their publishers or imprints, list filters and badges, picker labels show the path, automatic suggestions count ISBN evidence at the publisher level.
- `docs/02_DATA_MODEL.md` updated.

## Completion Notes
- Tests: taxonomy unit tests (structure rules, unique spellings and prefixes, Open Library evidence from the owner's books, market); database tests for the three levels, logged moves, roll-ups, most specific link, same-name houses and a dry run, apply and undo of the engine. Full suite: 789 passed.
- Dry run on a fresh copy of live data (rolled back): 24 new houses, 16 changed, 2 unchanged. 253 editions in these families; with a house 74 → 252; each has one link: 142 to an imprint, 110 to a publisher, none to a group. 71 imprints and 160 countries from Open Library (244 of 251 ISBNs answered); 0 refused by the ISBN check; 3 disagreements left for the owner (Memoirs of Hadrian, The Magic Mountain, Vineland). "Coma" (Semiotext(e), labelled National Geographic Books) stays in the inbox.
- Review of the first dry run found and fixed: two sibling imprints on one book, publisher names written into the imprint field, group-level links where the ISBN's publisher was known, and same-name imprints chosen by list order on group-wide prefixes (now by market).
- Screens checked on the copy: group, publisher and imprint pages, the Group filter, the editor's type and parent fields, the search box path. Alignment audit: 0 deviations.

## Live Activation — 2026-10-03
- Owner approved ("Go"). Merged the branch's four newer commits into the taxonomy branch (one import conflict on the publisher page), 796 tests and lint passed, then fast-forwarded `fix/backlog-0116-0121`; the uncommitted author-picker work (task 0151) was untouched.
- Full `pg_dump` backup, then migration 0036 applied (36 recorded).
- Live dry run matched the reviewed one (same structure, names, prefixes and 195 link changes; two newer books also got their country). Applied as run `2b8ad683-717f-4399-9d7f-24de5018262e`: 3 groups, 225 publishers, 27 imprints; 431 of 445 editions with a publisher name have a house; no edition has two links; 71 imprints and 162 countries set; 16 hierarchy changes logged. The Publisher names inbox has 13 editions (12 names) left.
- Verification on :3100 found every full page load failing with "window is not defined": the Copy menu (task 0177) read `window.location` while the command palette rendered on the server. Fixed in `src/components/shortcuts/shortcuts-provider.tsx` (empty link on the server, the real one in the browser). All pages load; Lolita links to Vintage International only; no console errors.
