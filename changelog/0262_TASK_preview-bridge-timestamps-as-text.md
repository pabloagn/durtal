# Task 0262: The preview bridge keeps timestamps as text

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Found while checking PR #8 (SLN-297, keyset paging of the activity
timeline). In `scripts/qa/preview-local.py`, the bridge between the app's
Neon HTTP driver and the local PostgreSQL turned date and timestamp values
into JS Dates. A JS Date keeps milliseconds only, so a keyset cursor such as
`2026-09-25 12:19:29.217531+00` reached PostgreSQL as
`2026-09-25 12:19:29.217+00`, and every row in between was skipped. Real
Neon sends these values as text and keeps the microseconds. Only the local
preview was wrong; the live app does not use the bridge.

## Implementation Details

- The bridge sets postgres.js serializers and parsers for `date` (1082),
  `timestamp` (1114) and `timestamptz` (1184): parameters go to PostgreSQL
  as the text they arrive as (a JS Date as ISO), and results come back as
  PostgreSQL's own text, as Neon returns them.
- Nothing outside `scripts/qa/preview-local.py` changed.

## Completion Notes

Local copy from `live-before-app-settings-20261003-220818.dump`, never the
live database. PR #8's head with the timeline at 2 events per page, "Show
more" clicked until it goes:

- Old bridge: "The Lost Estate" shows 11 of its 14 events. The 3 events
  that share the timestamp `2026-09-25 12:19:29.217531` with the last event
  of page 1 are skipped. The query log shows the cursor parameter as
  `2026-09-25 12:19:29.217+00`.
- New bridge: 14 of 14 on "The Lost Estate" and 13 of 13 on "The Skin", in
  database order.
- With the new bridge, `/`, `/library`, a book page, `/authors`, an author
  page, `/publishers`, `/places`, `/provenance`, `/locations`,
  `/collections`, `/taxonomy` and `/settings` return 200. They show no
  "Invalid Date" or "NaN", and the server log has no errors.
