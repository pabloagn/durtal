# Task 0266: Painting Locations Show Their Source and Check Date

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0223 (painting pages, SLN-368), 0224 (open paintings)
**Blocks**: None

## Overview

SLN-368 follow-up. The ticket check of 2026-10-04 found one acceptance criterion only partly built: a painting page must show the source and the verified date of the original's current location, then its location history. The pages showed where the object is, but never the source a location record cites, and only how long ago it was checked ("Checked 3 days ago"). It also found that `/paintings?page=30000` showed the error page, and that `docs/02_DATA_MODEL.md` still said painting writes are rejected.

## Implementation Details

- **Source of each location.** `src/app/paintings/[slug]/page.tsx` maps each whereabouts record's `sourceRecordId` to the painting's source (`sourceChoices`) and passes it as `source` to the current location ("Now") and each history entry. The header, the object line and the history show "Source: …". A source that a location cites counts as cited in Sources ("Cited here").
- **Check date.** `checkedText` (`src/lib/catalogue/painting-labels.ts`) now writes the date: "Checked Oct 4, 2026" for a record checked against a source, "Recorded Oct 4, 2026, not checked" for one never checked. A location unchecked for a year still adds ", check again".
- **Out-of-range page.** The painting results moved to `src/app/paintings/painting-results.tsx`, like `src/app/perfumes/perfume-results.tsx`: count first, send a page past the end to the last page, and read only an offset inside the list. Page 30,000 of 48 was an offset past the list's 1,000,000 cap.
- **Docs.** `docs/02_DATA_MODEL.md` says all four kinds are enabled, with `0055_open_paintings` for paintings.
- **Tests.** `painting-results.test.ts` (redirect before any read; no read when nothing matches; the page read) and `painting-home.test.ts` (both check-date texts).

## Completion Notes

**Verification:**

- `pnpm typecheck` passes; `pnpm lint` has 0 errors (82 warnings, none in the files changed here). `python3 scripts/qa/test-local.py`: **1,614 tests across 131 files pass**, 0 failed, 0 skipped, plus the Python checks.
- Browser, on `scripts/qa/preview-local.py --from-dump` with the newest live backup (`live-before-0053-0056-20261004-113735.dump`, migrations 0053–0056 applied): added "The Starry Night", a source ("MoMA collection page"), its original (73.7 × 92.1 cm, Museum of Modern Art) and a move to MoMA citing the source. The header read "MoMA · Permanent collection / Checked Oct 4, 2026 · Source: MoMA collection page"; the object line and the history entry showed the same; Sources marked the source "Cited here". `/paintings?page=30000` opened `/paintings`.
- `alignment-audit.js` and `design-audit.js` on `/paintings`, `/paintings?page=30000` and the painting at 1440, 768 and 390 px: 0 deviations over 0.5 px, 0 low-contrast texts, 0 unnamed or nested controls, no horizontal scroll, no console errors.
- `node scripts/qa/page-weight.js` on that preview: 9 of 10 routes within budget. `/library` was 313 of 300 KB; this change does not touch the book list.
