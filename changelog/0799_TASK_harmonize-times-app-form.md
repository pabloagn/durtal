# Task 0799: Harmonize writes its times in the app's form and time zone

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1109. /harmonize wrote "Scanned 09:14 PM" with `toLocaleTimeString` and
the Activity dates with `toLocaleDateString`, in the runtime's own zone and
locale. The server (UTC) and a browser in another zone or locale wrote
different text, so hydration failed (React error 418) in Chromium, Firefox
and WebKit, and the times read in 12-hour US form.

## Implementation Details

- `src/lib/utils/date.ts`: `formatDay` ("18 Oct 2026") and
  `formatDateTime` ("18 Oct 2026, 21:14") for a moment in a given time
  zone. They take numeric parts from `Intl` and use the app's own month
  names, so every runtime writes the same text.
- `src/app/(catalogue)/harmonize/page.tsx` passes `appTimeZone()` to the
  workspace; `workspace.tsx` writes the scan time with `formatDateTime`,
  the Activity day with `formatDay` (with `dateTime` on its `<time>`), and
  its counts with the "en" grouping.
- `src/__tests__/ui/harmonize-times.test.ts`: renders the workspace with
  the runtime in UTC, Mexico City, Paris and Tokyo and expects the same
  markup with "Scanned 18 Oct 2026, 21:14"; checks the formats.

## Completion Notes

Production preview, Chromium, Firefox and WebKit, with the browser in
America/Mexico_City (es-MX), Europe/Paris (fr-FR) and UTC (en-US): no
hydration or page errors; "Scanned 19 Oct 2026, 05:08" and an Activity
day of "19 Oct 2026" in all nine. Alignment, contrast and unnamed 0 at
1440, 390 and 320; no sideways scroll; page weight within budget.
