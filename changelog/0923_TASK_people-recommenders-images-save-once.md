# Task 0923: People, recommenders and images save once

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0922
**Blocks**: None

## Overview

SLN-1276, part 2, from findings/failure-resilience-survey-2026-10-19.md
(items 1 and 7). With the reply lost after the row was written, saving Add
person again made a second identical person; Add recommender said '"…"
already exists' with no way to that record; and the same image uploaded twice
to one record made two images.

## Implementation Details

- `src/lib/actions/utils/create-once.ts`: `createOnce(id, stored, create)`.
  A row the id already saved comes back instead of a second one, also when a
  resend racing the first loses on the primary key; `created` says whether
  this call wrote it, so a repeat records no second activity.
- `createAuthor(input, { id })` and `createRecommender(input, id)` use it.
  Add person and Add recommender make a new id each time they open
  (`createId`, from part 1). A recommender resend that loses on the name,
  not the id, still finds its own row.
- A name another recommender holds now comes back with `existingId`; the
  toast's Open goes to that recommender (create and edit).
- `ingestMedia` gives an image an id from its owner, type, settings and bytes.
  The same picture again on the same record returns the image already there
  without rendering or storing anything; a poster or background becomes the
  active one again, as a new upload would. Two at once collide on the id: the
  loser removes its own files and returns the winner's row. The S3 keys stay
  random per upload, so a deleted image's files are never adopted again.
- No schema change.

## Completion Notes

- Database tests: a repeated id and a simultaneous resend add one person and
  one recommender, with one `author.created`; the same picture twice, and two
  at once, give one image whose files are the only ones left; the same
  picture on another record or type is its own image; a poster sent again
  becomes active. The existing "new poster becomes active" test now uses two
  different pictures.
- Headless Chromium, Firefox and WebKit, with the save's answer dropped after
  the server wrote it: Add person and Add recommender store one row after the
  lost answer and after pressing again, which says it was added. The same
  picture uploaded twice in the media dialog adds one image and shows one.
  An existing recommender's name shows "already exists" with Open, which goes
  to it (1440, 390 and 320; alignment, design and overflow audits clean with
  the toast showing). Two openings of Add person add two people.

Review (19 Oct): a resend racing the first press could find that press's row by its name and report "already exists" for its own save (32 of 60 looped pairs). The create now checks whether the clashing recommender is this id's own row before calling it a clash. A looped race test (20 rounds of three at once) failed on every run before the fix and passes after. docs/07 says one record can't hold the same picture twice.
