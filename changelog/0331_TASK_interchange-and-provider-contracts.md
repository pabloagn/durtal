# Task 0331: Versioned interchange file and provider contracts

**Status**: Completed
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-355, SLN-357, SLN-358, SLN-360, SLN-362, SLN-363
**Blocks**: SLN-376, SLN-377, SLN-378, SLN-379

## Overview

SLN-375. One JSON file carries records of every collection whole, and imports
back with a preview, an explicit conflict policy, one transaction per record
and a report per record. Metadata providers get one contract scoped to a
collection and its record levels. The book CSV, TSV and Parquet export, and
the reading CSV import with its bronze copy, do not change. No schema change.

## Implementation Details

- `src/lib/interchange/tables.ts`: the tables of version 1 in write order.
  Record tables belong to one work, through an owner column up to `works`;
  entities (people, organizations, venues, places, storage locations,
  collections, series, vocabularies) travel once in `shared`; parts (an
  organization's roles, a person's domains and other names) travel with
  their entity.
- `src/lib/interchange/columns.ts`: each table's columns, keys and foreign
  keys, read from Drizzle. Rows travel as Postgres writes them with
  `to_jsonb`; timestamps are written in UTC with their microseconds.
- `src/lib/interchange/export.ts`: the chosen works by collection and title,
  each with its owned rows, the dates and sources they cite, and the shared
  rows they point at, with those rows' own references and parts.
- `src/lib/interchange/format.ts`: the envelope (`durtal.interchange`,
  version 1). Another format or version, or a shared row it cannot read,
  refuses the whole file by name. A record is checked on its own: an unknown
  collection, a closed collection, an unknown section, a table its collection
  cannot carry, an unfit value and a row that belongs to another record each
  fail that record.
- `src/lib/interchange/import.ts`: vocabularies are matched by natural key
  (country by ISO code, language by name, credit role by id, taxonomy family
  by slug, taxonomy item by family and slug, the book vocabularies by slug);
  a missing country, language, credit role or family fails only the records
  that need it, and missing items are added. Records, shared rows and parts
  are matched by key. A new work writes all its rows; a work here is
  unchanged, or follows the policy: `keep` writes nothing to it, `add` adds
  the rows it lacks, `fail` reports it. A row here is never changed. Records
  that link to each other are written in dependency order, and a cycle in one
  transaction. Each record is one `atomic` transaction; a dry run ends each
  with a failing assertion, so it rolls back, and puts the records a record
  needs in the same transaction. A new person gets exactly the file's
  domains (the `legacy_author_domain` trigger adds "book"); a row the
  database adds itself under the same key is kept.
- `POST /api/interchange/export` (no token) and `POST /api/interchange/import`
  (token; `policy` required, `dryRun` defaults to true; 50 MB at most).
- `src/lib/providers/`: `contract.ts` (levels per collection, hit and detail
  schemas, the adapter interface, `adapterProblems`), `run.ts` (time limit,
  gap between calls, 429 as rate limited, results checked and capped,
  proposals limited to declared levels and fields, `reviewProposal` that
  fills only empty fields, `recordProviderDetail` that registers the id and
  keeps a pending observation, `providerLocks`), `registry.ts` (empty: the
  enrichment tasks add providers).
- Docs: 05 (Interchange routes and file), 08 (Provider Contract), 14.

## Completion Notes

- `src/__tests__/integration/interchange.test.ts` (8 tests, local
  PostgreSQL): a mixed fixture (a book with two editions and a copy, a
  perfume with house, perfumer, note, formulation, bottle and cited source, a
  film adapting the book, a painting with two location records, one
  collection holding the restored edition and two whole works) exports,
  imports into an empty database (dry run first, which writes nothing) and
  exports again identically, with every table's row count equal, the
  edition choice kept and the location history and current loan kept. The
  same file again writes nothing under every policy. A file with a missing
  venue, an unfit value and a duplicate ISBN fails those three records alone
  with readable reasons, writes none of their rows, and the good file then
  completes the rest. Curated edits (notes, rating, a locked source) survive
  `keep`, `add` (which adds a new bottle) and `fail`. Unknown versions,
  formats, shared tables, collections and smuggled rows fail by name.
  Another database's family ids are matched by slug; a missing family fails
  only the perfume. A provider detail is kept pending, fills only empty
  fields, and a locked observation locks the record.
- `src/__tests__/interchange/format.test.ts` pins every carried column in a
  snapshot; `src/__tests__/providers/contract.test.ts` covers declarations,
  result limits, time limits, gaps, rate limits, proposals and that catalogue
  writes, imports and exports never import a provider.
- Review fixes (PR #111):
  - The identifiers and sources of people, organizations and venues travel in
    `shared` (`entityOwners` on `catalogue_identifiers` and `source_records`,
    `entityOwner()` checks each row has exactly one owner); a person,
    organization or venue the import adds brings them, one already here keeps
    what it has. Publisher specialties (a vocabulary matched by slug), house
    specialties and ISBN prefixes travel as parts of an organization.
  - Each publisher, alias or ISBN prefix written fired the statement trigger
    that relinks every unconfirmed edition, once per record: 1,000 books and
    200 publishers took 22 s, 3,000 and 600 took 354 s. Each transaction now
    sets `durtal.defer_publisher_refresh`, and the import calls
    `refresh_all_publisher_links()` once at the end when it wrote any of those
    rows (34 s for 3,000 books, the same links).
  - Tests: identifiers and sources of a person, an organization and a venue,
    a specialty with another id here and an ISBN prefix round-trip, and a
    person already here is not given back a removed source; an edition here
    that names a publisher the import adds is linked to it once the import
    ends.
- `python3 scripts/qa/test-local.py`: 2298 tests in 205 files passed, none
  skipped, against 69 disposable databases, plus both Python checks.
  `pnpm typecheck` and lint of the changed files are clean.
- Limitations: images, comments, activity, readings, orders and acquisition
  targets are not carried. People, organizations and venues match by id, so
  a person created separately in two databases fails on its unique slug
  rather than being merged. A large import is one transaction per record.
  There is no screen yet: the API does both directions.
