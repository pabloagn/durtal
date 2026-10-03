# Task 0220: "Today" uses the local calendar date, not UTC

**Status**: Completed
**Created**: 2026-10-03
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Default dates used `new Date().toISOString()`, which is the UTC date. In Amsterdam, between local midnight and 01:00/02:00, "today" was yesterday (SLN-296).

## Implementation Details

- `src/lib/utils/date.ts`: `todayLocal()` gives the browser's local date on the client and the `APP_TIMEZONE` date (default `Europe/Amsterdam`) on the server. `calendarDate()` formats a date in a time zone with `Intl.DateTimeFormat`. `addDays()` adds days to a `YYYY-MM-DD` date.
- Call sites: default order date (`order-create-dialog.tsx`), optimistic shipped/delivered date (`provenance-shell.tsx`), "arriving this week" window and auto shipped/delivered date (`lib/actions/orders.ts`), lent date (`instance-status-button.tsx`), export file name (`api/export/route.ts`).
- `APP_TIMEZONE` is documented in `docs/13_CONFIGURATION.md` and `.env.example`.

## Completion Notes

- `src/__tests__/utils/date.test.ts` checks that 00:30 Amsterdam time (summer and winter) gives the local date, not the UTC date.
- `src/app/publishers/[slug]/page.tsx` still formats a stored `createdAt` in UTC. It does not default a date, so it is out of scope.
