# Task 0252: Changelog Duplicate Numbers (SLN-433)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Two changelog numbers were each used by two task logs: 0155 and 0175. Each
task now has its own number.

## Implementation Details
For each pair, the log committed first keeps the number. The other log takes a
`b` suffix, as `0024b` already does. The suffix keeps each log in its place in
the list and needs no new numbers.

- 0155 stays with `0155_TASK_work-domain-foundation.md` (`2cb1adf`, SLN-346).
  `0155b_TASK_real-image-crop.md` (`b522838`, SLN-407) was 0155.
- 0175 stays with `0175_TASK_name-order-button-and-keyboard-shortcuts.md`
  (`84373ef`, SLN-409). `0175b_TASK_work-slugs-follow-renames.md` (`b103e94`,
  SLN-285) was 0175.

References changed to the `b` logs:
- `docs/02_DATA_MODEL.md`, Crop section (two places) and
  `docs/05_API_REFERENCE.md`, `POST /api/media/apply-crops`: 0155b.
- `changelog/0197_TASK_book-experience-shared-substrate.md`,
  `src/lib/works/slug.ts` and `src/app/api/works/refresh-slugs/route.ts`: 0175b.

References that stay, because they point to the log that keeps the number:
- `changelog/0176_TASK_add-and-go-menus-list-keys.md` ("Depends On: 0175",
  keyboard shortcuts).
- `docs/14_CURATED_LIBRARY_PLAN.md` ("0155–0169"),
  `changelog/0182_TASK_curated-library-live-schema.md` ("0155–0180") and
  `changelog/0188_TASK_domain-navigation-dashboard.md` ("0155–0182"): the work
  domain series.

## Completion Notes
- `ls changelog | cut -d_ -f1 | sort | uniq -d` prints nothing.
- No code or script reads changelog file names, so the renames break nothing.
