# Task 0997: The docs name files that exist, the real ingestion CLI and the real release order

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1227, from findings/dead-code-survey-2026-10-19.md (section 5), findings/docs-drift.md (sections 1 and 5) and findings/release-path.md (items 4, 9 and 13). The docs named files that never existed or had moved, docs/09 described an ingestion pipeline that was never built, and docs/11 described a release through the development server.

## Implementation Details

- **Paths.** The root layout is now named as the catalogue layout (`src/app/(catalogue)/layout.tsx`, with `publishers/layout.tsx` and the reader's own layout) in docs/01 and docs/04. docs/03's font loading names `src/styles/root-fonts.ts` and the roots that use it. The perfume, film and painting list pages and the settings layout are under `(catalogue)` in docs/04. docs/02 names `keysInUse` and `deleteUnusedObjects` in `src/lib/s3/cleanup.ts` instead of a `references.ts` that never existed.
- **docs/09.** The flat `scripts/ingest/` tree; the six real steps (copies folded into the books step, series as step 6, its column drop removed because the column stays); a "Not built" list for the occult sheet, extra editions, enrichment and a report; the real CLI and its options; the Parquet source cut to one line; the default path with `~`. It also says which steps are safe to re-run: the books step is not (it adds a found work's edition and copies again).
- **Taskfile.yml.** `ingest:report` removed: its `--step report` doesn't exist. docs/12's command table loses its row.
- **docs/12.** The project tree redrawn one level under `src/app/(catalogue)`, `src/lib` and `scripts`, without counts.
- **docs/11.** The live app is the standalone release on 127.0.0.1:3110, and the development server on :3100 is not. The Release order follows `mac_release.py` (prepare, build, package, verify), then `live_migrate.py`'s backup, rehearsal and migration (SLN-1318), then `launchd-plan`, `transition-plan` and `mac_release.py switch` (SLN-1319), which loads the previous release again when the new one isn't serving in time. New "Rolling back a build" and "When the service stops" paragraphs. The phone-access paragraph no longer presents `next dev` as the live server.
- **CLAUDE.md**, project map only: 16 numbered documents (`00` to `15`); `lib/` lists `actions/`, `interchange/`, `reading/`, `types/` and `hooks/` instead of a missing `import/`; the missing top-level `types/` line removed; the `scripts/` line names the Python ingestion and TUI and the TypeScript e-book, QA and deploy tools.

## Completion Notes

- A path check (every `src/`, `scripts/` and `docs/` path in `docs/*.md` and CLAUDE.md against `git ls-files`, with `docs/NN` section references allowed) finds 13 missing paths on main and none here.
- No Python script and nothing under `scripts/deploy/` changed. When this landed (rebased onto main on 19 Oct), the release steps were corrected to the backup, rehearse, migrate and switch commands that had already landed (#552); the first draft said they had not.
- The docs/09 commands were checked against `scripts/ingest/main.py`'s click options but not run: this container has neither the Python dependencies nor the workbook. `task` isn't installed here either; the Taskfile change is the removal of one block.
