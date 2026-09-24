# Task 0092: Bulk Import Web UI

**Status**: Deferred
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
Build the web-based bulk import interface at `/library/import`. The page exists as a placeholder but lacks the full functionality described in the spec: drag-and-drop upload zone, S3 medallion pipeline visualization (bronze -> silver -> gold), parsed record preview before commit, conflict resolution (skip/overwrite/merge), and per-record progress indicators. Supported sources: Goodreads CSV, Calibre library export, custom CSV.

## Implementation Details
- Route: `/library/import`
- Spec: `docs/04_ROUTES_AND_VIEWS.md` (Bulk Import section)
- Existing Python ETL pipeline handles ingestion via `scripts/ingest/`; this task covers the web UI equivalent

## Completion Notes
Deferred. Python ingestion scripts cover the current import workflow.
