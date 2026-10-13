# Task 0480: Calibre library snapshot

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-494 (e-book ingestion)
**Blocks**: SLN-657 (Import existing), SLN-658 (differences and personal data), SLN-498 (the load)

## Overview

SLN-656, the first of four steps that load Joris's Calibre library into
Durtal. The library is read once, read-only, into a snapshot that every later
step uses. That way the years of cleanup in Calibre carry over, and Durtal
never depends on Calibre. The ingest planner can now plan a library from its
snapshot.

## Implementation Details

- `src/lib/ebooks/calibre/library.ts` holds:
  - the snapshot's types;
  - `readSnapshot`;
  - `checkCalibreSource`, which refuses once the library's `metadata.db` no
    longer hashes as the snapshot's;
  - the conversion of a Calibre book into file metadata, and the lineage kept
    in `ebook_files.metadata.calibre`.
- `src/lib/ebooks/calibre/read-db.ts` reads a copy of `metadata.db` through
  `node:sqlite`, opened read-only. It reads Calibre's own tables, including:
  - the normalized and plain custom-column tables;
  - series columns with their index;
  - composite columns, which have no stored values.
  Ratings become 0.5 to 5 stars, and Calibre's year-101 date becomes null.
- `src/lib/ebooks/calibre/drift.ts` compares each book's `metadata.opf` with
  the snapshot, field by field.
- `src/lib/ebooks/calibre/snapshot.ts` and `pnpm ebooks:calibre-snapshot`:
  - The copy is verified by hashing the source before and after; a library
    being written to is refused.
  - Missing and extra files are named.
  - The volume UUID and mount point are kept as lineage.
  - The snapshot JSON goes to the cache; the report goes to `reports/ebooks/`.
- `pnpm ebooks:ingest --calibre <snapshot> [<library folder>]`
  (`src/lib/ebooks/ingest/plan.ts`):
  - The files come from the snapshot, not a walk, and one Calibre book is one
    group (`groupKey`).
  - Metadata comes from the snapshot first, then the OPF, then the file.
  - `import_ref` is the Calibre uuid.
  - Calibre's `cover.jpg` covers are made once into the cache. Plan files
    carry their `cachePath`, which the apply uploads from.
  - The plan records its snapshot binding (`plan.calibre`). The planner, the
    apply and the resume refuse a stale one, and the reconciliation counts
    only the planned files.
- `docs/09_INGESTION_PIPELINE.md` has a new "Calibre library" section.

## Completion Notes

- There is no migration and no new package. The `node:sqlite` module ships
  with Node 22 (CI) and Node 26 (the Mac).
- Tests: `src/__tests__/ebooks/calibre/snapshot.test.ts` uses a fixture
  library built in code (`src/__tests__/fixtures/calibre-library.ts`): a
  `metadata.db` with Calibre's schema, four books, nine custom columns of
  every kind, OPFs, a cover, a missing format and a stray file. The tests
  check:
  - every snapshot field;
  - the drift report;
  - the missing and extra files;
  - that a database changed during the copy is refused;
  - that the library's bytes and modification times are unchanged;
  - that the same library at two mount points gives the same identities;
  - the plan's grouping, precedence, lineage and cover;
  - that a stale snapshot is refused by the plan, the apply and the resume.
- `src/__tests__/integration/ebook-ingest.test.ts` applies a Calibre plan on
  PostgreSQL: one e-book per book, keyed by its uuid, with the cover from
  `cover.jpg`.
- Nothing has run on the real library yet. It waits for the drive's path and
  Joris's yes.
