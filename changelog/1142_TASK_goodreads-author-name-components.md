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
