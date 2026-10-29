# Task 1136: Fixed native export schemas

**Status**: In Progress
**Created**: 2026-10-20
**Type**: Enhancement
**Tracks**: SLN-1082, follow-up to SLN-894

## Implementation

Eight ordered schema definitions replace per-file native type inference. JSON
and Parquet use raw projections with typed lists and CatalogueDate structs;
CSV/TSV retain their legacy headers, cells, ordering and formula/BOM rules.
Native timestamps come from exact SQL microsecond text. The pinned Parquet
writer uses the independently proved V1, one-page-per-group configuration,
numeric statistics/indexes and explicit UTF8-statistics omission, with only
instance-local footer annotations. No dependency or database schema changes.

Book and people projection code is separated from the route. Native targets
have an explicit field allowlist; uncredited people and distinct-book counts
are retained. The session counted-pages JOIN and running-timer exclusion stay
unchanged. Whole-entity empty native exports retain their complete schema.

## Validation status

Source checkpoint only. The synthetic adapter prototype passed separately;
that evidence does not validate these eight production projections. Focused
schema/precision/projection tests and disposable-DB checks are prepared but
have not run. Independent source review, typecheck, native Arrow acceptance,
legacy byte goldens and database validation remain required.

Goodreads name/provenance changes remain a separate SLN-1082 slice. TSV and
session/note import roundtrips remain SLN-1090. Neither SLN-1082 nor SLN-894 is
marked complete by this checkpoint. No build, deployment or publication.


## Verification update — 29 October 2026

Recovered in PR #637 on current main. Typecheck, lint and the production build
passed with the pinned Node 22 runtime. All 9,146 JavaScript/database tests in
879 files passed against disposable PostgreSQL; full Python/CI validation is
tracked separately by the PR checks and must pass before landing.

Production-mode acceptance used only a disposable catalogue: all 32 empty
native exports and all 32 populated exports returned files; the 16 empty
CSV/TSV imports returned no-op results. An independent PyArrow reader verified
stable schemas and exact JSON/Parquet values for all eight entities. Forty
additional synthetic Arrow cases covered empty, null, full, mixed and reordered
records, including nested structures, BCE dates and exact microsecond instants.
Thirty readings, thirty sessions and thirty notes restored through the browser
with all exported values preserved; Undo removed exactly the restored records.
Thirty-six Chromium, Firefox and WebKit scenarios at 390 and 1440 pixels passed;
measured alignment, contrast, control names and overflow checks had no failures.
Forty-two configured routes passed page-weight budgets; six routes without
corresponding synthetic e-book/taxonomy fixtures were explicitly skipped.

SLN-1183 is only partially addressed: empty Goodreads/JSON/Parquet import
acceptance still needs work. No claim of complete all-format import support,
merge, deployment or owner-phone acceptance is made by this verification update.
