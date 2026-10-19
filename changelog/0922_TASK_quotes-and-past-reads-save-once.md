# Task 0922: Quotes and past reads save once

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1276, part 1: quotes, notes and Log a past read. When the answer to a save
was lost (a Wi-Fi drop mid-save), pressing again stored a second quote, and
Chromium and Firefox resend such a POST by themselves. People, recommenders,
images and the other creates the ticket lists follow in their own parts.

## Implementation Details

- `src/lib/utils/create-id.ts`: `createId`, a UUID v4 made in the browser,
  also off a secure context (Durtal is often reached over plain http).
- The note dialog and Log a past read make one when they open (each opening
  mounts the dialog afresh) and send it with every press.
- `createReadingNote` and `addPastReading` take an optional `id`. A stored row
  with that id is returned as the save's result: "Quote added", "Logged a past
  read". The insert uses the id, so two presses at the same time collide on
  the primary key; the loser finds the winner's row and returns it. No second
  activity count. An id saved on another book is refused.
- `writeReadings` rows take an optional `id`; imports send none.
- No schema change: both tables already had uuid primary keys.

## Completion Notes

- Database tests: a repeated id and a simultaneous resend store one quote and
  one past read, with one day count and one status history row; the other
  book is refused.
- Headless Chromium, Firefox and WebKit, with the save's answer dropped after
  the server wrote it: one row after the lost answer and one after pressing
  again, with "Quote added", "Note added" or "Logged a past read". Two
  separate Add a quote dialogs still store two quotes.
- The lost answer still says "Not saved: Durtal could not be reached"; with
  the id, a later part can check whether it landed first.
