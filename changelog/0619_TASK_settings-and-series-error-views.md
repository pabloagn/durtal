# Task 0619: Settings and Series error views lead back; Try again leads

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0612, 0615
**Blocks**: None

## Overview

From the second loading audit of 15 October
(`findings/audit-loading-2-2026-10-15.md`, finding 6; SLN-754), and the #336
review's optional point.

- A settings page that failed (Data, Integrations, eBook settings) replaced the
  whole settings page, title and settings list included, with an error that
  led to the dashboard.
- A series and Series suggestions also led to the dashboard, not back to
  Series.
- Since #336, Try again and the way back looked the same.

## Implementation Details

- **`src/app/(catalogue)/settings/error.tsx`** sits inside the settings
  layout. A failed settings page keeps the "Settings" title and the settings
  list, and its error leads back to General.
  - Its heading is an h2 under the page's h1.
  - `SectionError` and `EmptyState` take `heading="h2"` for this.
- **`src/app/(catalogue)/series/error.tsx`** uses `ListSectionError`:
  - on the list it leads to the dashboard;
  - on a series it says "This series could not be loaded.";
  - on a series or Series suggestions it leads back to Series.
- **`SectionError`**: Try again is the primary button, and the way back stays
  secondary, on every error view built on it, including the domains'
  `DomainError`.

## Completion Notes

- Production preview with every query failing, Chromium at 1440, Firefox and
  WebKit at 390:
  - Settings Data, Integrations and eBook settings keep the settings list and
    title, with Try again and "Back to settings".
  - A series and Series suggestions offer "Back to series".
- The alignment, touch, design and layout audits report nothing on the failed
  settings page, series and book, in Chromium, Firefox and WebKit at 1440, 390
  and 320.
- `src/__tests__/ui/loading-audit-states.test.ts`:
  - the Series and Settings error views' way back and description;
  - Try again is primary;
  - the settings error's h2.
