# Task 0390: The database suites no longer reach the real S3 bucket

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0371 (SLN-515, write route tests)
**Blocks**: None

## Overview

SLN-535, found by the review of PR #153. Four database tests merge or delete
a person or an organization, which ends with the S3 clean-up in
`src/lib/s3/cleanup.ts`. With no mock of `@/lib/s3/client`, the clean-up
opened a connection to `durtal.s3.us-east-1.amazonaws.com`, signed with
Vitest's placeholder "test" keys; AWS refused it, the clean-up logged
"[s3-cleanup] Cleanup needs retry", and the tests passed either way:

- `organizations.test.ts`, "supports multiple venues and protects linked
  identities from deletion"
- `people-credits.test.ts`, "merges identities atomically, preserving
  distinct credit IDs, order, aliases, media and redirects"
- `people-credits.test.ts`, "routes legacy author merges through the same
  credit-preserving transaction"
- `perfume-model.test.ts`, "retains formulation-specific perfumers, unknown
  attribution and stable credits through person merges"

Now the clean-up in those files runs against an in-memory bucket, and the
full database suite makes no connection off the machine. Test code only.

## Implementation Details

- `src/__tests__/helpers/memory-bucket.ts`: `memoryS3Client(objects?)`, the
  in-memory bucket `write-routes.test.ts` already had (Put, Get,
  ListObjectsV2, DeleteObjects, DeleteObject; any other command throws), as
  one helper a suite mocks `@/lib/s3/client` with:
  `vi.mock("@/lib/s3/client", async () => (await import("@/__tests__/helpers/memory-bucket")).memoryS3Client())`.
- `organizations.test.ts`, `people-credits.test.ts` and
  `perfume-model.test.ts` mock the client with it.
- `write-routes.test.ts` uses the helper with its own hoisted map, so its
  assertions on the bucket are unchanged and the bucket's code is in one
  place.

## Completion Notes

- Checked with a connection log: a Node preload (`NODE_OPTIONS=--require`)
  that wraps `net.Socket.prototype.connect` and `dns.lookup`, writes every
  connection with its test's name, and refuses anything off the machine.
  - Before, the four files above with `write-routes.test.ts`: 4 connections
    off the machine, all to `durtal.s3.us-east-1.amazonaws.com`, one from
    each of the four tests.
  - After, the same files: none.
  - After, the full suite (`scripts/qa/test-local.py`, every database
    suite; 262 files, 2,953 of 2,953 tests passed): none; all 320
    connections went to PostgreSQL on 127.0.0.1.
- Typecheck clean; lint 0 errors and 77 warnings as on main; deadcode clean.
