# Task 0132: Shared image adjustments

**Status**: Completed and activated
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Feature
**Linear**: SLN-316

## Overview

One compact editor now adjusts stored pictures across covers, author portraits, backgrounds, galleries, edition covers, collections, venues, image attachments and Reader covers. Exposure, saturation, monochrome, sepia and softness join brightness/contrast; existing poster/background crop and drag controls remain.

## Implementation Details

- Display settings are stored in the new `image_adjustments` table, keyed by full-image S3 identity with thumbnail and Reader-route aliases. Existing files and extracted ambient palettes remain untouched. The empty table changes no image defaults.
- Server actions resolve only registered image assets. Existing media brightness/contrast initialize the editor and are synchronized atomically with the shared settings. Failed paired writes roll back. Documents and author color originals are not editable picture targets.
- One filter function drives the live preview and exact asset URL rules in the root provider. Rules cover plain images, thumbnails, Next optimized images and lightbox portals. Preview images opt out to prevent duplicate filters. Other images receive no rules.
- Author ownership is resolved server-side and enforces grayscale 100%, neutral saturation and zero sepia. Color controls are omitted for author images; Reset preserves monochrome. Existing monochrome reprocessing remains available separately.
- A compact control selector shows one accessible slider at a time, Compare toggles the last saved appearance, Reset restores neutral presentation, and Save retains drafts when persistence fails. Position sliders supplement existing dragging. A shared backed icon opens the editor on other assets.
- Nested gallery dialogs handle Escape without closing the gallery. Image protection still blocks context menus/dragging while allowing author portrait clicks through its transparent overlay. Dialog close controls have accessible names.
- New S3 keys start neutral. Deleted assets may leave harmless metadata keyed to URLs that no longer render. Adjustments are presentation metadata, not baked into exports/downloads.
- No dependencies or environment files changed. Migration 0027 only creates an empty table; it was approved and applied before activating this branch.

## Validation

- 390 tests passed, 27 skipped because their separate database opt-ins were unset. Included 14 image utility checks, 10 image PostgreSQL action checks, populated 0026→0027 migration preservation and idempotence, and publisher integration tests including the SLN-313 follow-up.
- `pnpm typecheck`, ESLint and `git diff --check` pass.
- Production compilation passed via `next build --webpack --experimental-build-mode compile`. Existing optional Parquet/WebSocket native-module warnings remain; this was compilation, not production activation.
- Browser preview used synthetic images and an isolated local PostgreSQL database. Verified cover preview/Compare/save, persisted thumbnail and lightbox filters, author policy/Reset, gallery saturation and nested Escape, collection save, optimized Reader-cover styling, and place/edition entry points. Dialog controls fit without internal scrolling at the tested 1280×720 viewport. Physical mobile devices were not tested.
- Temporary preview database/image route adapters were restored byte-for-byte, preview stopped, and browser tab closed. During pre-activation testing, live Neon data and S3 assets were not modified.

## Activation

Activated on 2026-09-26 after explicit user approval. Applied the official Drizzle PostgreSQL migration transactionally against the current live database; verified the exact 0027 migration hash in the ledger. No database restore or catalogue writes were performed.

All 65 existing public tables retained identical row counts and content fingerprints across the migration. Verified 389 works, 396 editions, 197 instances and 599 media records; the new settings table had zero rows. This preserves the user's recent localhost edits.

Fast-forwarded the active checkout to `d2af64e`. Live browser checks opened the Fictions cover editor and Borges portrait editor, confirmed loaded images, neutral defaults, disabled Save when unchanged, and locked author monochrome, then closed without saving. `pnpm typecheck` passed in the active checkout. Pagination and one-click copy remain active.
