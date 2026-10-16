# Task 0783: A closing page sends its deleted marks itself

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0780
**Blocks**: None

## Overview

SLN-869, found while finishing SLN-682. Deleting a mark starts a 10-second
Undo window. If the tab closed inside it, the delete did not reach the
server: the replay that runs when a page hides first checks the device with
the server and does several IndexedDB steps, and a closing page does not live
to finish them. The delete went only the next time the reader opened on that
device, so other devices kept showing the mark until then, and for good if
the reader never opened there again. Now the closing page sends it at once.

## Implementation Details

- `src/lib/reader/offline/transport.ts`:
  - The transport keeps the queue as it last read it: after each replay's
    read, after a new operation commits, and after a book transaction
    commits. A book transaction can take an operation back (Undo), so the
    copy is forgotten while one is under way.
  - On `pagehide` for a page that is not kept for the back button, it sends
    the head of that copy at once, in one keepalive body, with no device
    check and no IndexedDB step before the request starts. It respects what
    the normal replay respects: nothing past a blocked head, nothing during
    a backoff, and nothing another page holds a live claim on. The rows stay
    unclaimed; the page still seals its deletes.
  - The server applies each operation once by its id and still checks the
    device header against the cookie, so a later replay of the same rows is
    acknowledged without applying anything twice.
- `outbox-policy.ts`: a delete the server reports as already gone
  ("deleted", "retired") counts as done. Before, it was kept as an ignored
  change and the reader listed it under "Some changes need attention",
  which is what the next visit would have shown after a closing page's send.
  An edit of a mark that is gone is still reported.

## Completion Notes

- Chromium, Firefox and WebKit, closing the tab 1.5 s after Delete:
  - on main the mark stayed live on the server in all three;
  - now it is deleted on the server in all three. Reopening the reader on
    that device sends the delete again once the Undo window has passed; it
    is acknowledged, the queue empties, and nothing needs attention.
- Undo then closing the tab keeps the mark, in all three. Closing after the
  window still deletes it, as before.
- Tests: `transport-closing.test.ts` (the delete is sent in the pagehide
  handler itself, before any device check or IndexedDB step; nothing after
  an Undo, while an Undo is being written, for a page kept for the back
  button, past another page's claim or a blocked head);
  `outbox-policy.test.ts` (a delete of a mark already gone is done, an edit
  of one is still ignored). `reader-view.test.ts` sends its claimed
  lifecycle replay from a page kept for the back button.
- No migration and no new packages.
