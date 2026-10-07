# Task 0371: Tests for the write routes SLN-311 left out

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Infrastructure
**Depends On**: 0296
**Blocks**: None

## Overview

SLN-515, the rest of SLN-311. Task 0296 left some routes without tests
because open PRs were changing them at the time. Those PRs have landed. Each
route now has a test of its happy path and of a refused input, run by
`pnpm test:local`. No app code changes.

## Implementation Details

- A database suite, `src/__tests__/integration/write-routes.test.ts`
  (`DURTAL_WRITE_ROUTES_TEST_DATABASE_URL`, `/sln515_write_routes`). S3 is an
  in-memory bucket behind a mocked `@/lib/s3/client`: puts, gets, lists and
  deletes land in a map, and any other command fails the test. No request
  leaves the machine and no key is set.
  - `/api/comments`: a comment is saved sanitized with its timeline event, and
    listed; no text, an unknown kind of record and a missing record are
    refused.
  - `/api/comments/[commentId]`: an edit is sanitized; a delete removes the
    comment, its event and its files; a bad id and a second delete are
    refused.
  - `/api/comments/[commentId]/attachments` and `.../[attachmentId]`: a PDF is
    stored under the comment's folder with a clean file name, then removed
    with its file; an `.exe` is refused.
  - `/api/export`, for each of its nine entities (works, authors, perfumes,
    films, paintings, readings, reading sessions, reading notes, the Goodreads
    file): a CSV holds the record and no table changes; a format the entity
    does not offer is refused. Also refused: an unknown entity, ids that are
    not UUIDs, and no selection.
  - `/api/authors` and `/api/authors/[id]`: the list and its count, one
    author, a bad id and a missing one.
  - `/api/media/apply-crops`: framing saved as CSS becomes a cropped file, the
    uncropped one is kept, and a second run finds nothing; a bad id is
    refused.
  - `/api/media/backfill-palettes`: a poster stored without a palette gets one;
    a poster whose file is gone is reported and left as it is.
- A unit suite, `src/__tests__/api/search-places.test.ts`, for
  `/api/venues/search-places`: `fetch` is stubbed with Google's answer, the
  key is made up, and any other address fails the test. The trimmed query and
  type are sent and the places with an id come back; an empty query and a body
  that is not JSON are refused before any request; no key gives 503, a
  refused key 503 and other errors 502.

## Completion Notes

- `write-routes.test.ts`: 16 tests pass. `search-places.test.ts`: 3 tests
  pass.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 259 files, 2,886 tests, all passed.
