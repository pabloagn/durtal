# Task 0102: Add Missing Database Indexes

**Status**: Completed
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0097
**Blocks**: None

## Overview
Only 4 indexes exist across 40+ tables (on activity_events and comments). Foreign key columns, frequently filtered columns, and sort columns lack indexes, causing full table scans on common queries.

## Implementation Details
Critical indexes to add (Drizzle schema + migration):
- `works(catalogue_status)` — filtered on every library page load
- `works(series_id)` — FK lookup from series detail
- `works(created_at DESC)` — timeline and recent queries
- `works(rating)` — sorting
- `editions(work_id)` — FK lookup (most common join)
- `editions(language)` — filter by language
- `editions(publication_year)` — timeline queries
- `instances(edition_id)` — FK lookup
- `instances(location_id)` — "all books at location" query
- `instances(status)` — filter by available/lent_out
- `orders(work_id)` — FK lookup
- `orders(status)` — order pipeline filtering
- `orders(created_at)` — timeline
- `authors(birth_year)` — timeline filtering
- `media(work_id, type, is_active)` — composite for "find active poster"
- `media(author_id, is_active)` — author media lookup
- `series(slug)` — URL lookup

After adding indexes, run `pnpm db:generate` and `pnpm db:migrate`.
Update `docs/02_DATA_MODEL.md` to document indexes.
