# Task 0470: Mixed collection changes, all or nothing

**Status**: Completed
**Created**: 2026-10-13
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0468
**Blocks**: None

## Overview

SLN-573. Adding a selection that mixed books with editions and whole works
(a film, a painting, a book with no edition) to a collection ran two
separately committed writes, editions first. When the second failed, the
editions stayed added with their activity while the dialog showed the old
state and a generic failure. Each change is now one transaction: everything
joins or leaves, or nothing does.

## Implementation Details

- `addToCollection` and `removeFromCollection`
  (`src/lib/actions/collections.ts`) take `{ editionIds, workIds }` and run
  one atomic batch under the collection's lock: the edition write and the
  whole-work write, each with its activity events. A whole work's kind is
  checked before the batch, as before. Both return `{ changed }`.
- The four single-kind actions are now these calls with one list, so the API
  route and the collection page's remove control keep their behaviour.
- `AddToCollectionDialog` sends one call per toggle. On a failure it says
  nothing was changed and reads the selection again, since a book may have
  gone meanwhile.
- The collection's "Add books" dialog sends its editions and works in one
  call instead of two in parallel.
- `docs/06_SERVER_ACTIONS.md`: the two actions.

## Completion Notes

- `collections.test.ts`, new case: a book deleted after the dialog loaded
  makes the add refuse with nothing written; a failing whole-work write rolls
  the editions and their activity back; the same holds for a removal, with a
  trigger refusing the whole-work delete; a clean add and remove change both
  together and count 2.
- Browser, headless Chromium on a production build: the library's
  Collections dialog for Against Nature (an edition) and En route (no
  edition). With the whole-work write made to fail, the toast says nothing
  was changed, the collection stays unchecked and the database holds no
  member and no activity. Without the failure, both join and both leave.
