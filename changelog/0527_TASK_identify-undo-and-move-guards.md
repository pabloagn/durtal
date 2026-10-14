# Task 0527: Identification Undo and placeholder move refuse stale writes

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-576. The audit found that the identify queue's Undo, "Keep without ISBN" and "Move to this edition" decided on a read and then wrote without checking that read again. A save committed in between could be overwritten or half-applied. This task reproduced each race against PostgreSQL and closed it.

## Implementation Details

Reproduced first, in `src/__tests__/integration/publishers.test.ts` ("while another writer changes the edition"). Each test lets another writer commit at the exact point between the read and the write, by pausing `loadMatchEdition` (after the read) or `atomic` (after every check). On main, all five failed:

- Undo after a newer title: the Undo went through and restored the old title, clearing the newer edit.
- Undo of a cover after another save stored a new cover: the Undo cleared the newer cover keys and the source.
- Keep without ISBN after the placeholder was identified: it set the identified edition's source to `manual`.
- Move after the placeholder was identified: the copy and the collection moved to the other edition, and the placeholder, no longer a placeholder, was not deleted. That is a partial migration.
- Move after the placeholder gained a tag, or after the edition went back to being a placeholder: the move went through.

The fix:

- `src/lib/match/save.ts`: `matchWriteSnapshot(edition)` returns the exact state `loadMatchEdition` read. `saveMatch` uses it as before.
- `src/lib/actions/identify.ts`:
  - `undoIdentification` and `keepWithoutIsbn` write through `writeLoadedEdition`. It runs `editionWriteGuardQueries` (lock, then compare the edition and its links to the snapshot) and `editionUpdateQuery` (exactly one row) in one transaction. A stale write is refused with the action's own message.
  - The cover's files are released only after the Undo's write succeeds.
  - `moveToExistingEdition` locks `editions` and the reference tables inside its transaction, then asserts every preflight condition again before moving anything. The delete asserts it removed exactly one row.
  - The reference tables are one list, used by the preflight count and the in-transaction assertion.
- `docs/06_SERVER_ACTIONS.md`: the three actions describe their guards.

## Completion Notes

- `publishers.test.ts`: 48 of 48 pass, including the five new cases and the existing identify, keep, undo and move tests.
- No migration and no new package.
- In production a thrown action's message is hidden, so the queue still shows its fallback toasts ("Could not undo", "Could not move the copies"). That is as before.
