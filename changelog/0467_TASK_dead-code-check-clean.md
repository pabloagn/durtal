# Task 0467: The dead-code check passes again

**Status**: Completed
**Created**: 2026-10-13
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

`pnpm deadcode` (knip) had failed on main since the reader merge. It named 7
unused files and 15 imports of `server-only` as an unlisted dependency, so
every PR reported it as failing on main too. It passes again. Nothing the app
runs changes.

## Implementation Details

- Removed four files that nothing imports:
  - `src/components/reader/digital-edition-badge.tsx`: the cover mark is
    `EbookMark` now.
  - `src/components/reader/settings-dialog.tsx` and
    `src/hooks/use-reader-settings.ts`: the reader's settings are
    `PresentationSettingsDialog` now. Two reader tests still mocked the old
    dialog; those mocks are gone.
  - `src/lib/ebooks/upload/schema-guards.ts`: a proposal for migration 0088
    whose SQL is now in `0088_ebook_upload.sql` itself. The two guards there
    match it. `docs/02_DATA_MODEL.md` now names the migration and its guards
    in place of the file.
- `knip.json`:
  - Two entry points that are loaded from outside `src/`:
    - `src/lib/ebooks/upload/worker-entry.ts`, loaded by
      `infra/ebooks/inspector/worker.mjs`. It brings
      `src/lib/ebooks/ingest/pdf-budget.ts` with it.
    - `src/__tests__/reader/offline/store-browser.ts`, bundled by
      `scripts/qa/reader-offline-store.mjs`.
  - `server-only` is ignored as a dependency. Next.js provides it at build
    time and the tests mock it, so it is not a package to install.

## Completion Notes

- `pnpm deadcode`: exit 0.
- `pnpm typecheck` is clean, and the two reader suites whose mocks changed
  pass (32 tests).
