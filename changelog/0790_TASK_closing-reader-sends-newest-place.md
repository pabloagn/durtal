# Task 0790: A closing reader sends the newest place behind a delete

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-919, from the Third reviewer's review of #446 (note 1). Delete a mark,
which opens its 10-second Undo window, turn three pages and close the tab
1.5 s later: the device had no `ebook_positions` row, in all three browsers.
While the Undo window is open the foreground replay stops at the delete, so
the place of every page turned after it queues behind it, and the closing
page sent only the head of the queue (the delete, SLN-869). The place stayed
on this device until the reader opened there again.

## Implementation Details

- `src/lib/reader/offline/transport.ts`: after the head plan,
  `sendWhileClosing` also sends the newest waiting reading place the head
  plan leaves behind, as a second keepalive request (`closingPosition`).
  - Newest by `clientUpdatedAt`, then the further place, as the server and
    the local positions store order them; a place that is not newer than a
    head place is not sent again.
  - Only a waiting place of the head's device, outside its backoff; a place
    another page holds stays with it.
  - Only when the two bodies together fit `OUTBOX_KEEPALIVE_BYTES` (60 KB, under
    the browser's 64 KB keepalive budget); otherwise the place waits for the
    next visit, as before.
  - The server applies each operation once by its id and keeps the newest
    place by time, so the replay of a later visit is acknowledged without
    applying anything twice.

## Completion Notes

- `reader/offline/transport-closing.test.ts`: the delete and then the newest
  place go as two keepalives; the newest is chosen by time, not queue order;
  a place alone still goes alone; once the delete is undone only the place
  goes; nothing more goes when the two bodies would not fit the budget; a
  place of another device, or one another page holds, is left out. The first
  two fail without the change.
- Production build on the preview database (`--seed-reader`, fixture e-book
  E06), a fresh browser each time:
  - Delete a rose mark, turn three pages (13% to 53%), close 1.5 s later: the
    device's `ebook_positions` row is at 53% and the mark is deleted, in
    Chromium, Firefox and WebKit. Before, the device had no row (as the review
    of #446 found).
  - Turn pages and close with no delete: the place is saved.
  - Delete, Undo, turn pages and close: the mark stays live and the place is
    saved.
- No interface change; page weight within budget on every route.
- No migration and no new packages.
