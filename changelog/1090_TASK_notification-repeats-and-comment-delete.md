# Task 1090: Repeated failures count, closing the notifications marks only what was seen, and a comment asks before it goes

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Three problems from the notifications and activity survey (SLN-1460):

1. A failure shown again under the same toast id, with the same words, was lost from the notification history: the second and third failure changed nothing, even after the panel was opened and closed.
2. Closing the notification panel marked every entry read, including the ones never scrolled into view.
3. A comment deleted in one press with no confirm, a failed delete left only a console line, and every comment's buttons were named just "Edit" and "Delete".

## Implementation Details
- `src/components/layout/notification-recorder.tsx`: Sonner makes a new object each time a toast is shown or changed and keeps the others as they are, so the recorder records each toast object once (a `WeakSet`). A toast shown again under its id is a new object and is recorded again; an unrelated toast arriving no longer re-records the ones on screen.
- `src/lib/notifications/history.ts`: `record` treats the same id with the same words as a repeat: the count goes up, the time is now, it is unread and moves to the top.
- `src/components/layout/notification-centre.tsx`: while the panel is open, an `IntersectionObserver` on the list notes each row that is at least half in view, entries that arrive meanwhile included; closing marks only those read. Mark all read still marks everything. Without `IntersectionObserver`, every shown row counts, as before.
- `src/components/activity/comment-item.tsx`: Delete opens the shared `ConfirmDeleteDialog` ("Delete comment", the comment's text, and its attachments when it has any), per the rule that deleting a record asks first and has no Undo (SLN-1152). A failed delete shows "Could not delete the comment" and leaves the dialog open. After a delete the focus moves to the next comment's Delete, else to the comment box. The buttons are named "Edit comment" and "Delete comment" (the visible words stay, with a hidden " comment").
- `activity-timeline.tsx` marks the timeline and its comment box for that focus move.
- Review fixes (Second reviewer):
  - `src/lib/notifications/toast.ts`: the house toast folds a repeat into the error or warning still on screen, so no new toast reached the recorder. It now shows that error or warning again under the same id: still one toast, and the history counts it. The favourite's failure (through the house toast, with no id) now counts 3 after three failures.
  - `comment-item.tsx`: the focus moved on a timer that the browsers ran while the dialog was still open, with the page inert, so it fell to the body. The delete now closes the dialog synchronously (`flushSync`), then moves the focus.
  - `comment-item.tsx` uses the house toast, so "Could not delete the comment" stays until dismissed.
- The comment icon sat 8 to 19px above the "Comment" label (on main too). Its dot now sits 11px down, the card's border and top padding, and the header is top-aligned, so the taller touch buttons on a phone no longer push the label down.

## Completion Notes
- `history.test.ts`: the same toast shown again counts, unread, at the top.
- `notification-centre.test.ts`: three identical failures under one id read as one entry "3 times", unread, after the panel was opened in between, while another toast arrives; with 50 entries and 8 in view, closing marks those 8 read and leaves 42 unread.
- `notification-centre.test.ts` also counts a repeat that goes through the house toast (three failures, one toast, count 3).
- In Chromium, Firefox and WebKit on a private preview: the favourite failing three times, with the panel opened and closed between, counts 3 and stays unread; after a confirmed delete the focus lands on the next comment's Delete, or on the comment box after the last one; the delete failure toast is still there 8 seconds later.
- `comment-delete.test.ts` (new): the names, the confirm and Cancel, the focus after each delete, and the failure toast.
- Taking out the recorder's once-per-object rule, the history's repeat rule, the in-view check, or the focus move each fails a test.
- On a private preview with two seeded comments, `scripts/qa/alignment-audit.js` finds 0 deviations on the book page, with the notification panel open and with the delete dialog open, in Chromium, Firefox and WebKit at 1440, 390 and 320px; the icon and label centres match to 0.1px. `scripts/qa/design-audit.js` finds no low-contrast text; `page-weight.js` passes (book page 138 of 400 KB).
- The comment confirm uses today's `ConfirmDeleteDialog`; SLN-1282 later folds the two confirm components into one.
