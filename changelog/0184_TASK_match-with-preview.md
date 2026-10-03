# Task 0184: Match with a preview

**Status**: Completed
**Created**: 2026-10-03
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0170, 0171, 0172, 0179
**Blocks**: None

## Overview
Step 3 of the publishing house and editions proposal. "Match again" replaced every edition field with the source's values and showed nothing first: it put a distributor name on The Door and could blank fields the source did not send. Match now shows the old and new value of each field, and saves only the values the owner ticks. It also shows the house the edition will link to, and it stores clean language and binding codes.

## Implementation Details
- `src/lib/match/source.ts`: reads one record from ISBNdb, Google Books or Open Library and cleans it (`cleanRecord`). Values that cannot be right become null: an ISBN with a bad check digit, a year outside 1400 to next year, more than 10000 pages, an unknown language, a format that is not a printed binding, a non-https cover. ISBN-10 and ISBN-13 are derived from each other. Descriptions are stored as plain text with paragraphs. Hidden control characters are removed (ISBNdb sent "\u0098The\u009c loser": library sort markers).
- `src/lib/match/plan.ts` (pure): `planMatch` compares the record with the edition. Guardrails: an empty source value never clears a field; same ISBN: only empty fields are ticked; new ISBN: every change is ticked, and the old ISBN's imprint and country are offered for clearing; a publisher name with a `publisherNameProblem` (distributor, platform, placeholder) is never ticked; an ISBN another edition holds is blocked and nothing is ticked; a title that does not look like the book's gives a warning.
- `src/lib/actions/match.ts`: `previewMatch` (writes nothing), `previewMatchHouses` (the house for the ticked values), `applyMatch` (reads the source again; a value that differs from the preview or is blocked stops the save; locked editions are refused; `relink` lets hand-set links follow the new data; `work.rematched` activity keeps the fields with their old and new values). `rematchEdition` is removed.
- `src/components/books/match-preview.tsx`: the preview step in `MatchAgainDialog`. One row per field (old → new, tick), a House row that updates when publisher, imprint or ISBN ticks change, "Save N changes". On phones the field name sits above its values.
- Migration `0050_match_preview`: bindings take their code (one live row, "Paperback"), a CHECK keeps `editions.binding` in `BINDING_TYPES`; the 0036 link rules move unchanged into `edition_publisher_matches(publisher, imprint, isbn)`, which `refresh_edition_publishers` stores and Match reads.
- Bindings: `src/lib/utils/binding.ts` (`normalizeBinding`, `bindingLabel`). ISBNdb search results carry the binding code, so the add-book wizard fills it in; the wizard lists every binding type. The edition schema maps source text to the code and rejects unknown text.
- `sameBookTitle` ignores articles and joining words, so "The Outsider" no longer passes as "The Stranger".
- Docs: `docs/02_DATA_MODEL.md`, `docs/06_SERVER_ACTIONS.md`.

## Completion Notes
- Tests: 24 unit tests (`src/__tests__/utils/match-plan.test.ts`), 4 PostgreSQL tests in `publishers.test.ts` (preview writes nothing, a changed source stops the save, ISBN held by another edition, binding codes and the CHECK). Full suite on a disposable database: 1190 passed.
- Rehearsal on a pg_dump of live (49 migrations): migration 0050 changed 1 row in 107 tables (The White Hotel binding "Paperback" → "paperback"). `edition_publisher_matches` gives the stored links for all 659 editions without hand-set links; a full refresh changes no link.
- Browser check on that copy: same-ISBN refresh of The Stranger (only empty fields ticked), a placeholder edition (The Loser) matched to a Vintage Books ISBN (all ticked, house previewed and linked), house updates when ticks change. Checkboxes and arrows within 0.33px of the text's cap-height center; the alignment audit finds nothing in the dialog.
- Found while testing: a live pg_dump does not restore as is. `catalogue_dates` (migration 0037_work_kinds) has a generated column whose function calls `catalogue_month_days` without a schema, and pg_restore runs with an empty search_path. Reported to the curated-library session.
