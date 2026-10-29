# Task 1143: Preserve Goodreads book identities

**Status**: In Progress
**Created**: 2026-10-20
**Type**: Fix
**Tracks**: SLN-1082

## Implementation

Accepted current Goodreads imports claim Book Id text before writing readings.
Import and book/edition registry claims share advisory locks, post-lock checks
and brief table locks. IDs and new-ownership journals commit together; retries
remain independent of reading outcomes. ISBN-proven editions retain ownership;
manual/title matches belong to the book. Queue writes preserve the ID journal.
Undo verifies the effective book of edition-owned identities, keeps reused,
shared, cited, moved and snapshot-less identities and reports
retention. Both import pages expose Undo for claim-only interruptions, including
reused IDs without removable records. Registry returns preserve the exact raw
owner association; cross-kind reuse remains an import behavior. No existing
metadata is rewritten.

CSV exports prefer corroborated provenance for the exact latest reading or
queue item, then a single valid ID in the existing fallback order. Cross-book
conflicts or ambiguous tiers leave Book Id blank and produce a warning from the
actual export response, even if the courtesy notice failed. Other cells and the
native export implementation are unchanged.

The guarantee covers participating import and registry claims. Unrelated legacy
metadata writers remain outside that protocol and can create later conflicts;
exports detect these. No global model rewrite, migration or historical backfill.

## Validation status

Source only. Added unit and disposable-DB regressions cover selection, retries,
claim/journal rollback, eligibility, ISBN proof, repeated IDs, conflicts,
concurrent participating writers, ownership-safe Undo, provenance and warnings.
No typecheck, unit, DB or browser stage has run for this checkpoint. Browser
acceptance still needs the existing dialog layout, visible partial-import state,
retained-ID feedback and the failed-preflight warning path checked. Full test
and build gates and whole SLN-1082 acceptance remain pending.

The separately approved native serialized-output test update is included for
review, with no native production-code change. The preceding core and name
commits keep their separate evidence.


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
