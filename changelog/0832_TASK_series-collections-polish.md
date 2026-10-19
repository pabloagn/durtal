# Task 0832: Series and collections polish

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-918, the "Smaller items" of the series and collections survey
(findings/series-collections-survey-2026-10-16.md), with the two optional
notes from the review of #443.

## Implementation Details

- **Empty states.** An empty collection and an empty series each show one
  empty state with a sentence and the page's only Add: the header's Add shows
  once something is in it. The series' dashed "No books yet." box becomes that
  state (`AddSeriesBooksButton`, which opens the header's dialog by event, as
  the collection's does). When the first books are added the focus moves to
  the header's Add that takes the empty state's place; removing the last one
  hands it to the empty state's Add (FocusKeeper).
- **Counts keep their nouns.** A series card's and list row's counts wrap
  between parts, never inside one (`CountParts`); the phone list row no longer
  truncates them.
- **Phone series rows.** Under 640px the volume number sits over the cover, so
  the title has about 200px at 320 instead of 138.
- **Next to read** (`nextVolume`, `src/lib/reading/series.ts`) skips a volume
  being read or paused and names the next unread one after it, or none. The
  book page's "Next in series" follows the same rule.
- **Review of #443 notes.** The collection header's Add is the default size,
  as tall as Edit and Artwork; a taxonomy family's System badge and colour dot
  move to the next line together.

## Completion Notes

- Unit tests for `nextVolume` and the empty states; the book page reading
  database suite covers a volume under way.
- Checked in Chromium, Firefox and WebKit: one Add on an empty series and
  collection; the focus after adding the first book and removing the last;
  "Next to read: 3" while volume 2 is being read; "Review Book 009" on one
  line at 320; no count split from its noun; the Film genres badge and dot on
  one line.
- Audits clean on /series, two series pages, two collection pages and a
  taxonomy family at 1440, 390 and 320 in three browsers; page weight passes.
