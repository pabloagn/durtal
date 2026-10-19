# Task 0920: Book edits in two tabs

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0760 range (SLN-1033, server refusals)
**Blocks**: None

## Overview

SLN-1243. Editing a book in two tabs silently lost the first save: the second
tab's Edit work dialog still held the values from before, and its save wrote
them back over the first. Films already refused a stale save; books now do too.

## Implementation Details

- `src/lib/catalogue/book-fingerprint.ts`: `bookEditFingerprint(id)`, md5 of
  every field the dialog shows (title, languages, year, type, anthology,
  status, priority, rating, description, notes, series and number, Goodreads
  and StoryGraph links), the ordered authors with their roles, and the
  recommenders. `STALE_BOOK` is the refusal.
- `updateWork(id, input, fingerprint?)`: with a fingerprint it checks before
  the write, then locks the work and asserts the fingerprint inside the same
  atomic, so two saves at once can't both pass.
- The book page reads the fingerprint in its existing `Promise.all`; the
  dialog keeps the one that matches its values from the moment it opens, so a
  refresh while it is open can't vouch for older values. A refusal keeps the
  dialog open with what was typed and shows the reason.
- The quick edit a card opens reads the work fresh, so it was only lost when
  two were open at once; it now reads the fingerprint
  (`getBookEditFingerprint`) just before the work and sends it too.
- Callers that change a few fields from a fresh read (bulk edits, e-book
  differences) send no fingerprint and behave as before.

## Completion Notes

- Integration test in `book-saves.test.ts`: a stale fingerprint is refused and
  changes nothing; a current one saves.
- Checked in headless Chromium, Firefox and WebKit at 1440, 390 and 320: a
  single-tab save says "Work updated" and a second save in the same tab works;
  a second tab opened before the first saved, or opening its dialog after, is
  refused with the message and keeps its values. Alignment, design and
  overflow audits clean on the book page and the refused dialog.
