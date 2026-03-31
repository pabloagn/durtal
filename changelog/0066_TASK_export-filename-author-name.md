# Task 0066: Export Filename Uses Author Name

**Status**: Completed
**Created**: 2026-03-31
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
When exporting a single author (CSV, TSV, Parquet), the filename should be `durtal-firstname-lastname-date.extension` instead of the generic `durtal-authors-date.extension`.

## Implementation Details
- Modified `src/app/api/export/route.ts`
- For single-author exports: filename uses `durtal-{firstName}-{lastName}-{date}.{ext}` (lowercased, non-alphanumeric chars stripped)
- Falls back to slugified full name if first/last name not available
- Also applies to single-work exports (uses slugified title)
- Multi-item exports retain the existing generic format

## Completion Notes
Single-entity exports now produce descriptive filenames. Example: exporting Octavia Butler as CSV produces `durtal-octavia-butler-2026-03-31.csv`.
