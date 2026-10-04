# Task 0245: Export File Names Keep Accents; Bio Exported as Plain Text (SLN-298)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: 0214 (SLN-277, bios stored sanitized)
**Blocks**: None

## Overview
`POST /api/export` built file names with its own `[^a-z0-9]` filter, so
"Péter Nádas" became `durtal-pter-nds-<date>.csv`. It also wrote the author
bio as stored HTML (`<p>…</p>`) into CSV, TSV and Parquet cells.

## Implementation Details
- `src/app/api/export/route.ts`: the three copies of the slug logic become
  one `slug` built with the shared `slugify()`, which transliterates accents.
  An empty slug (a name with no Latin letters) falls back to the entity name,
  as before. The "export all" name (`durtal-books-all-<date>`) is unchanged.
- The `bio` column goes through `stripHtmlToText()`. SLN-277 stores bios as
  sanitized HTML for display; the export needs plain text, so it strips the
  tags from that sanitized HTML.
- Work `notes` are plain text, so no other export field needed stripping.

## Completion Notes
Exporting Péter Nádas now gives `durtal-peter-nadas-<date>.csv`, and the bio
cell holds plain text. A hyphenated first name keeps its hyphen
(`jean-paul-sartre`), where the old filter dropped it (`jeanpaul-sartre`).
