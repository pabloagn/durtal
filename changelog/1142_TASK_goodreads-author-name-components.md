# Task 1142: Goodreads author name components

**Status**: Complete (name formatting only)
**Created**: 2026-10-20
**Type**: Fix
**Tracks**: SLN-1082, following the native export core checkpoint

## Implementation

Goodreads export now receives each author's stored first and last names.
The Author l-f cell uses a nonblank explicit sort name first, then those
components, then the unchanged display name. Optional names lose outer
whitespace only; surname particles, internal spacing, punctuation and
mononyms are preserved. Display-author cells, credit order, other export
cells and Goodreads identifier handling are unchanged.

## Validation status

The full TypeScript check passed. All 20 tests in the Goodreads unit suite
and all 11 tests in the reading-export database suite passed, with no
failures or skips. These cover name precedence and whitespace, particles
and mononyms, unchanged export cells, metadata immutability, and stored
components passing through the real database export. Independent cleanup
passed after both stages; source, dependencies and protected inputs were
unchanged during validation.

This completes the name-formatting slice only. Core export evidence belongs
to the preceding checkpoint. Full test/build gates and the remaining
Goodreads identity/provenance work remain pending. SLN-1082 stays In Progress.


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
