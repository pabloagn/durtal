# Task 0130: One-click copy book title and author

**Status**: Completed
**Created**: 2026-09-26
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

SLN-317 adds a direct compact copy icon on book detail headers and standard grid/list/detailed views, including reused cards on author and taxonomy pages.

## Implementation Details

- Shared clipboard formatter preserves full display names, accents and catalogue order. One author produces `Book Title, Author Name`; multiple authors are joined with ` & `. Missing authors produce the title alone.
- Full author arrays are passed separately from the existing primary-author display text. Related-card and author-detail queries no longer discard co-authors needed for copying.
- Copy controls sit outside links; clicks stop propagation so copying does not navigate or toggle selection. Grid/list controls are hidden in bulk selection mode.
- Success icon/toast and clipboard-error feedback. The component cleans up its feedback timer. Existing work overflow copy also uses the shared formatter and error handling.
- No schema, data, environment or dependency changes.

## Completion Notes

- Eight new formatting/clipboard tests cover exact output, accents, co-authors, missing authors, denied and unavailable clipboard access.
- Full default suite: 348 passed; 43 opt-in database tests skipped. Typecheck, lint and diff checks passed.
- Browser verified the direct Fictions copy action and successful feedback. Catalogue data remained unchanged.
