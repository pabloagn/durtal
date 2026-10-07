# Task 0386: E-book ingestion core: inspect, store, verify and register any file

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0379, 0385
**Blocks**: None

## Overview

SLN-494, the e-book epic's sub-issue 5. One library, `src/lib/ebooks/ingest/`,
takes any file and does the following:

1. works out what it is and checks it;
2. reads its metadata, cover and text;
3. stores it in the e-book bucket under its checksum;
4. verifies the stored bytes;
5. only then writes its rows.

`pnpm ebooks:ingest` runs it on the machine that holds the files. It plans
first, read-only and with a report, then applies exactly that plan. It
resumes after any interruption, never registers a file twice, and ends with
a reconciliation of disk, Neon and S3. With no folder named it plans the
inbox, `~/Downloads/eBooks`. Every new e-book is `pending`; matching comes
in SLN-495.

Two pages, `/ebooks/runs` and `/ebooks/runs/[runId]`, show every run and its
files. Migration `0081_ebook_ingest` adds `ebook_ingest_runs` and
`ebook_ingest_items`.

Nothing live ran: no upload, no registration and no bulk load. Those wait for
Joris's own yes (SLN-498).

## Implementation Details

The library, `src/lib/ebooks/ingest/`, works in the order a file goes
through it.

Finding and reading files:

- `group.ts`: `walkRoots` lists every file under the roots. It skips hidden
  files, `cover.jpg`, `.opf` files and symlinks out of the roots, and honours
  `--exclude` globs. It reads each folder's `metadata.opf` as its sidecar.
  `groupFiles` makes the e-books: a sidecar folder is one, and the same base
  name in one folder is one. The same bytes twice are stored once, preferring
  a path in a sidecar folder.
- `source.ts`: a byte source over a file or bytes, read by range.
- `zip.ts`: zips are read by range through `@zip.js/zip.js`, never whole.
  Each zip records the end-of-central-directory offsets for the manifest.
- `sniff.ts`: the format from the bytes, never the name. It knows EPUB,
  KEPUB, PDF, MOBI, AZW, AZW3, KFX, Topaz, FB2, FB2Z, CBZ, CBR, DjVu, TXT,
  RTF, DOCX, LIT and CHM. A DOCX zip, an image-only zip and a plain zip are
  told apart.
- `hash.ts`: a streamed SHA-256, remembered in the cache folder by path,
  size, modification time and inode.

Inspecting a file (`inspect/`), one module per family:

- **EPUB 2 and 3** (`epub.ts` with `opf.ts`): `refines` roles and file-as,
  identifier schemes, `urn:isbn:`, series from `calibre:series` and from
  `belongs-to-collection`, layout, direction and page list. A sidecar OPF
  wins field by field and gives the `import_ref`. Its rating and custom
  columns are counted, not read in.
- **MOBI, AZW and AZW3** (`mobi.ts`): PalmDB, the MOBI header and the EXTH
  records named in the issue, and the PalmDOC text. HUFF/CDIC text is not
  decoded; that is said in plain words.
- **PDF** (`pdf.ts`): pdf.js's legacy build, read by range through its range
  transport. It reads the info dictionary, XMP preferred, the page count,
  linearization, each page's text (at most 60 seconds a file) and the first
  page drawn on `@napi-rs/canvas` as the cover.
- **CBZ** (`cbz.ts`): `ComicInfo.xml` and the pages in natural order, the
  first page as the cover.
- **FB2 and FB2Z** (`fb2.ts`): `title-info`, `publish-info` and the coverpage.
  Notes bodies are left out of the text.
- **DRM** (`drm.ts`): Adobe `rights.xml`, an LCP licence, FairPlay
  `sinf.xml` and unknown encryption are detected. Font obfuscation is not DRM.
  A MOBI whose header names encryption is `kindle`. A PDF that needs a user
  password is `pdf-password`, and Adobe's `EBX_HANDLER` is `adobe-adept`. An
  owner password only restricts, so the PDF is read. A DRM file is never
  opened beyond its metadata.
- A file that cannot be read is quarantined with its reason: an empty spine,
  a missing spine item, a zip without its central directory, a PDF that will
  not parse.

Metadata, text, covers and manifest:

- `metadata.ts`: one e-book's fields from its sources, in precedence order.
  - "Borges, Jorge Luis" becomes "Jorge Luis Borges", with that as the sort.
  - ISBN-10 becomes ISBN-13; an invalid ISBN goes to `isbn_invalid`.
  - The year 101 becomes null, the language is normalised and the
    description is cleaned into plain paragraphs (at most 20,000 characters).
- `src/lib/ebooks/text/extract.ts`: body and front/back word counts with
  `Intl.Segmenter`, character counts and a page estimate (a print page list
  when there is one). The function is agreed with the enrichment epic, with
  `TEXT_TOOL_VERSION`. `language.ts` tells English, Spanish and French apart
  by stop words, and keeps the declared language when it cannot. A scanned
  PDF gives null counts with the reason.
- `cover.ts` makes three WebP widths. `manifest.ts` records what the reader
  needs: zip offsets, EPUB version, layout, direction and page list, PDF
  pages.
- `prepare.ts`: one file's inspection, counts, covers and manifest, made
  into the cache folder and reused while the file and tool versions match.

Plan, apply and the rest:

- `plan.ts`: the read-only plan. Every file gets an outcome. Every group is
  checked against the catalogue with the apply's own rules
  (`planRegistration`), and folders with one sidecar uuid count as one
  e-book. The summary covers formats, DRM, quarantined, ignored, personal
  sidecar data, bytes and objects to upload (objects already in the bucket
  are adopted), an estimate from the last apply's speed, and the monthly
  cost (0.022 USD a GB-month and Intelligent-Tiering's monitoring charge).
- `store.ts`: HEAD, then a conditional PUT with its SHA-256 or a resumable
  multipart upload with a SHA-256 for each part, then HEAD again. A 5xx, a
  throttle or a network error is retried after 1, 4 and 16 seconds
  (`docs/07_STORAGE.md`, Ingestion).
- `register.ts`: one group's rows with every id given up front, written in
  one atomic with its items:
  - a new e-book (`pending`), a new format, or a changed file that replaces
    the old one;
  - the preferred file: readable, no DRM, by format preference. It moves to
    a replacing file of its format.
  - `undoIngest` removes what a run created where nothing has changed since,
    newest group first.
- `run.ts`: `applyPlan` and `resumeRun`.
  - Checks before writing: a plan made by this version, within 7 days,
    against this database (a fingerprint of host, port and name) and bucket;
    a pg_dump from the last hour; `--live` for a database that is not local.
  - Every path becomes an item. Six e-books are worked on at once, and the
    groups of one e-book (one sidecar uuid, or one catalogued e-book) go
    one after another.
  - A file changed since the plan is skipped and listed.
  - Ctrl-C or a crash leaves the run `interrupted`. A resume reads the plan
    the run kept in the cache folder.
  - The run ends with a reconciliation: `finished` when exact, else `failed`.
- `reconcile.ts`: disk, Neon and S3 by checksum and size. Exceptions carry
  `blocking`: not stored, failed, changed, a missing or differing object, a
  missing cover or manifest, an object no row names. Ignored, DRM,
  quarantined and duplicate files are listed but do not block. A source file
  gone after its object was verified is "no longer in the inbox".
- `report.ts` writes the plan's Markdown and CSV and the reconciliation's
  Markdown. `command.ts` holds the inbox, the roots, the target and the undo
  command.

Commands (`scripts/ebooks/`):

- `ingest.ts`: plan (the default), `--apply`, `--resume` and `--undo`. The
  plan uses a session that refuses writes and a probe proving it.
- `reconcile.ts`: read-only; it exits 1 when not exact.
- `environment.ts`: `--preview PORT` reads the state file
  `scripts/qa/preview-local.py` now writes (`durtal-preview-<port>.json` in
  the temp folder, mode 0600, removed on exit). The command then uses that
  preview's database through the same Neon bridge and its S3 folder as the
  bucket, and never reads an env file.
- The bridge moved out of `preview-local.py` into
  `scripts/qa/neon-local-bridge.mjs`, which the preview and the commands both
  load.
- `pnpm ebooks:verify` records a run of kind `verify` with `--apply`.
- The undo file is JSON lines: a header, then one line per group, written
  before its atomic (`reserveUndoLog`, `appendUndoLog` and `readUndoLog` in
  `src/lib/books/undo-file.ts`).

Pages:

- `/ebooks/runs`: every run, newest first, with its kind, machine and
  folders, start time, length, counts and a state badge. "Show 50 more".
- `/ebooks/runs/[runId]`: the reconciliation line, the counts, the inbox and
  in-flight counts, then the sections with files, each with "Show 50 more"
  (`docs/04_ROUTES_AND_VIEWS.md`). A running run refreshes every 10 seconds
  while visible.
- Settings › Integrations: a row "Ingestion runs" under eBooks, with the
  count and a link.
- `scripts/qa/page-weight.json`: both pages at 300 KB and 800 ms, the run
  page skipped with "no ingestion run" while there is none.

Schema: `src/lib/db/schema/ebook-ingest.ts`, migration `0081_ebook_ingest`
(two new tables only), `docs/02_DATA_MODEL.md`.

Docs:

- `docs/02_DATA_MODEL.md`: both tables, the outcomes, and what
  `ebook_files.metadata` holds.
- `docs/04_ROUTES_AND_VIEWS.md`: the two pages.
- `docs/07_STORAGE.md`: how a file is stored and in what order objects and
  rows are written.
- `docs/09_INGESTION_PIPELINE.md`: a new section, eBook ingestion.
- `docs/12_DEVELOPMENT.md`: the three commands with `--preview`, and the
  four new packages.

New packages, approved by Joris ("Yes packages", 7 October):

- `pdfjs-dist` 6.4.299, pinned exactly;
- `@zip.js/zip.js` ^2.23.0;
- `htmlparser2` ^10.1.0, as a direct dependency;
- `@napi-rs/canvas` ^1.0.10.

## Completion Notes

Tests. Fixtures are built in code (`src/__tests__/fixtures/ebook-builders.ts`),
so no binary file is committed:

- hand-written zips, stored or deflated;
- EPUB 2 and 3, sidecar OPFs and `encryption.xml`;
- MOBI and AZW3 with PalmDOC and EXTH;
- PDFs with info, XMP and RC4 encryption;
- FB2, CBZ, DOCX, KFX and Topaz headers, and a corrupt zip.

`ebook-corpus.ts` writes one file of every case plus generated EPUBs.
`scripts/qa/make-ebook-corpus.ts` writes the same corpus to a folder.

- Unit tests (`src/__tests__/ebooks/ingest/`, 67): `sniff` (6), `hash` (2),
  `inspect-epub` (8), `inspect-drm` (6), `inspect-other` (9), `metadata`
  (6), `extract` (7), `cover-manifest` (4), `group` (6), `store` (12) and
  `corpus-timing` (1). The store tests include a 300 MiB file that goes
  multipart, stops after its 7th part, resumes with the 12 parts left and
  matches its recomputed composite checksum. The timing test records the
  plan's time over 60 files and sets no budget.
- `src/__tests__/ebooks/run-text.test.ts` (3): the reconciliation line and a
  run's state count only blocking exceptions; sizes, durations and counts.
- Database suite `src/__tests__/integration/ebook-ingest.test.ts`
  (`DURTAL_EBOOK_INGEST_TEST_DATABASE_URL`, `sln494_ebook_ingest`, 11), with
  the bucket in memory:
  - The plan writes no row, and the probe refuses a session that takes a
    write.
  - An apply refuses before writing without a backup, with an old one or
    with a file that is not a dump, without `--live`, and against another
    database.
  - An apply makes every e-book `pending` and every file stored and verified.
    The run is finished and exact, and no file on disk changed.
  - DRM is stored and never preferred, the damaged zip is quarantined with
    its reason, the picture is ignored, and the copy is a duplicate naming
    the stored file.
  - The run pages read the run.
  - A second plan has nothing to do, and its apply writes nothing.
  - A deleted source file is "no longer in the inbox" and the reconciliation
    stays exact.
  - A crash between upload and registration leaves the run interrupted; the
    resume adopts the object and registers it once.
  - A failing insert leaves no row of its group.
  - A second folder with the same uuid adds a format; a changed EPUB
    replaces the old file and moves the preferred file.
  - The inbox is planned when no folder is named, and a missing inbox gives
    the plain error.
  - Undo removes untouched rows and keeps a file with a reading position.
- `work-kind-migration.test.ts`: both tables in the added-tables list.
  `doc-coverage.test.ts` finds both in docs/02. `page-weight.test.ts`
  expects the run page's `ifNone`.

Fixed along the way:

- MOBI's extra-flags offset is relative to record 0.
- pdf.js detaches the buffers it is handed, so it now gets copies.
- XMP dates keep only their date part.
- Undo's counts of positions, annotations and files are now qualified by
  table: drizzle wrote the column unqualified inside the subquery, so it
  counted nothing.
- A quarantined item now records its reason.
- A run's counts are read again after each write, so a finished run no
  longer shows the items it started with as still waiting.
- The reconciliation line and a run's state counted every exception,
  ignored and DRM files included; they now count only the blocking ones.
- `scripts/qa/interaction-audit.mjs` crashed after its last route when
  Chrome was still writing its profile, and so printed no result. It now
  waits for Chrome to exit and notes a profile it could not remove.

On a preview (`preview-local.py --seed-large 50 --s3-dir`), the corpus with
200 generated EPUBs, 220 files in all, went through the commands with
`--preview`:

- The plan read 220 files in 7.7 s (about 35 ms a file): 214 new e-books, 1
  format to add, 1 duplicate, 2 quarantined, 4 ignored; 759 KB in 451
  objects to upload. Two of the 214 e-books hold only a quarantined file.
- One EPUB was changed after the plan, on purpose. The apply took 5.6 s and
  uploaded 482 KB. It skipped that file as changed since the plan, so the
  run ended `failed` with one blocking exception, as it should; every other
  item was done.
- The reconciliation then reported the same single exception.

Gates, one at a time in the cloud on main 139c339a plus this change:

- `pnpm install --frozen-lockfile`, `pnpm typecheck` (and the scripts),
  `pnpm deadcode`: clean. `pnpm lint`: 0 errors (77 warnings, as on main).
- `python3.12 scripts/qa/test-local.py`: 284 files, 3,096 tests passed, 0
  skipped, and the Python tests.
- `pnpm build`, then a preview with 50 seeded books per kind and the corpus
  applied: page weight passes on every route (`/ebooks/runs` 42 / 300 KB,
  the run page 123 / 300 KB, `/library` 90 / 300 KB), the phone audit, the
  interaction audit and the three journeys pass.
- The alignment, design, overflow and touch audits on `/ebooks/runs`, the
  run page and `/settings/integrations` in headless Chrome 153, Firefox 155
  and Playwright WebKit 26.6 at 1440, 768 and 390: 27 of 27 clean.

Deviations from the issue:

- The runs list shows "Show 50 more" rather than numbered pages, as the run
  page's sections do (the shared pagination's sizes are 24 to 192).
- The run page has three more sections than the issue lists:
  - "Reconciliation exceptions", what keeps the run from being exact;
  - "Changed files", for files replaced;
  - "Not done yet", for items an interrupted run left.
- An e-book's title on the run page is plain text until the e-book page
  exists (SLN-497).
- Fixtures are built in code by the ingestion's own builders, not by the
  reader stream's fixture script.
- `neon-local-bridge.mjs` names the preview database (`durtal_preview`) as
  `preview-local.py` did.
- A verification records its run only with `--apply`, since the plan is
  read-only.
- The plan counts a second folder with an e-book's sidecar uuid as a format
  to add. If that folder holds a format the first folder also has, the apply
  makes it a changed file instead.

Second review (clear after fixes), fixed on the same branch:

- **A NUL in a file's metadata stopped the apply** (blocker). A PDF title
  written as UTF-16 without a byte order mark reads "R\0e\0p\0...", and
  PostgreSQL refuses a NUL in text and jsonb. Recording the failure failed
  too, because the ORM's error carried the failed query with the same
  character, so the run ended interrupted and every resume died the same
  way. Now `storableText` and `storable` (`metadata.ts`) remove NUL and turn
  unpaired surrogates into U+FFFD in everything a file says (the plan cleans
  each prepared file and sidecar, and an apply or resume cleans the plan as
  it reads it), and a failed item records the error's own words, at most
  500 characters (`failureMessage`). Tested with six such PDFs among good
  files: the run finishes and their titles read "Report 1" to "Report 6".
- **A multipart upload was accepted whatever its bytes.** The check after
  the upload fell back to `x-amz-meta-sha256`, which the same upload wrote
  from the plan. The upload now hashes the file as it reads the parts and
  aborts when the bytes are not the planned SHA-256, and its own object must
  carry the composite checksum of the parts sent. The metadata fallback stays
  only for an object another writer stored. The test fake keeps the metadata
  given at `CreateMultipartUpload`, as S3 does.
- **Undo left an empty e-book** when a second folder with the same sidecar
  uuid changed its preferred file. Undo entries now keep the e-book's
  `updated_at` before the group, and undo puts it back with the preferred
  file when nothing else changed the e-book, so the group that created it
  removes it.
- Optional notes taken: a plan before the AWS setup says the storage is not
  set up yet and treats the bucket as empty, rather than failing with
  NoSuchBucket; a resume makes the apply's version, database and bucket
  checks; `docs/09` says objects an undo leaves block reconciliations after
  24 hours until they are adopted or removed. Not taken: derived objects
  keyed by their own bytes, and indexes on `ebook_ingest_items.ebook_id` and
  `file_id` (both would change the schema; small at today's sizes).

Each new test fails on the reviewed head and passes now. Main 4214bb77 was
merged in; it changes no schema, and `drizzle-kit generate` reports no drift.

Gates after the fixes, one at a time in the cloud on main 4214bb77 plus
this change: `pnpm install --frozen-lockfile`, `pnpm typecheck`,
`pnpm deadcode` clean; `pnpm lint` 0 errors (75 warnings, as on main);
`python3.12 scripts/qa/test-local.py` 287 files, 3,128 of 3,128 passed;
`pnpm build`; page weight on every route (`/ebooks/runs` 40 / 300 KB,
`/library` 90 / 300 KB); the phone, interaction and journey audits; and
the alignment, design, overflow and touch audits on `/ebooks/runs` and
`/settings/integrations` in headless Chrome 153, Firefox 155 and WebKit
26.6 at 1440, 768 and 390: 18 of 18 clean. No page changed in these fixes.

Not done here, and waiting on Joris's own yes: any live apply (`--live`),
the inbox's bulk load (SLN-498), AWS uploads and the timing budget on the
Mac. Safari was not used: the browser checks ran in headless Chrome, Firefox
and Playwright WebKit. In the cloud there is no docker build, `.env.local`,
backup or live database; the merging thread re-checks the docker build and
runs migration 0081.
