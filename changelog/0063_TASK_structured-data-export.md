# Task 0063: Structured Data Export

**Status**: Completed
**Created**: 2026-03-30
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview

Add the ability to export catalogue data in structured formats (CSV, TSV, Parquet). Export is available from multiple entry points:

1. **Multi-select books** — select multiple works in the Library tab, then "Export As" from the bottom bulk-action toolbar.
2. **Multi-select authors** — select multiple authors in the Authors tab, then "Export As" from the bottom bulk-action toolbar.
3. **Single book** — export a single work's metadata from the work detail action menu.
4. **Single author** — export a single author's metadata from the author detail action menu.

### Prerequisite: Author Multi-Select

The Library tab already has full multi-select support (hook, checkboxes, bulk-action toolbar). **The Authors tab does NOT have multi-select yet.** This task includes implementing author multi-select as a prerequisite, mirroring the pattern from the Library tab:

- `use-author-selection.ts` hook (mirrors `use-library-selection.ts`)
- Selection props on `AuthorCard` and `AuthorListItem`
- Select/Cancel toggle button in `AuthorsShell`
- `AuthorBulkActionToolbar` component (bottom bar with export + delete)

### Supported Export Formats

| Format  | Extension  | MIME Type                        | Notes                            |
|---------|------------|----------------------------------|----------------------------------|
| CSV     | `.csv`     | `text/csv`                       | Comma-separated, RFC 4180        |
| TSV     | `.tsv`     | `text/tab-separated-values`      | Tab-separated                    |
| Parquet | `.parquet` | `application/vnd.apache.parquet` | Columnar binary via @dsnp/parquetjs |

### Exported Fields

**Works export** includes: title, author(s), original language, original year, catalogue status, acquisition priority, rating, ISBN-13, publisher, publication year, binding, page count, instance count.

**Authors export** includes: name, sort name, nationality, gender, birth year, death year, bio, website, works count.

## Implementation Details

### New Files

- `src/lib/hooks/use-author-selection.ts` — selection hook for authors
- `src/components/authors/author-bulk-action-toolbar.tsx` — bulk action bar for authors
- `src/lib/utils/export.ts` — CSV/TSV/Parquet generation utilities
- `src/app/api/export/works/route.ts` — works export API route
- `src/app/api/export/authors/route.ts` — authors export API route
- `src/components/shared/export-menu.tsx` — reusable export dropdown component

### Modified Files

- `src/components/authors/author-card.tsx` — add selection checkbox props
- `src/components/authors/author-list-item.tsx` — add selection checkbox props
- `src/app/authors/authors-shell.tsx` — add selection state + toolbar
- `src/components/books/bulk-action-toolbar.tsx` — add export menu
- `src/app/library/[slug]/work-actions-menu.tsx` — add export option
- `src/app/authors/[slug]/author-detail-header.tsx` — add export option

### Dependencies

- `@dsnp/parquetjs` — Parquet file generation (Node.js, server-side only)

## Completion Notes

_To be filled on completion._
