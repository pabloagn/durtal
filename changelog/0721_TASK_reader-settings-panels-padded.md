# Task 0721: Reader settings panels keep their text off the border

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass two (findings/design-polish-2-2026-10-15.md, item 1).
Settings, Reader was the one settings page that looked unfinished:

- Reading defaults: "These settings apply to books without their own desktop
  override." and the sample page sat on the panel's border, with no padding.
- The Desktop / Tablet / Phone switch touched the "Reading defaults" title.
- Books with overrides: the count and "Refresh overrides" sat on the panel's
  edge, each in its own strip.
- Lookup and Lookup history each ended in an empty bordered row.

## Implementation Details

- `src/app/(catalogue)/settings/reader/reader-defaults.tsx`:
  - The switch has the groups' 32px gap under it.
  - Reading defaults is one padded row: the note, then the sample page (with
    the 4px corner).
  - Books with overrides: the count and Refresh share the first row, as the
    lookup history's count and Clear do; under 640 Refresh goes under the
    count, pulled out by its padding so its icon starts on the text's edge.
    Loading and errors take a row only while they show; each book is a row.
    The count reads "1 book with a desktop override".
- `lookup-settings.tsx`: the save status sits under the source buttons, in
  their row, only while it says something. Its live region stays (screen
  reader only) so "Saved" is still announced.
- `lookup-history.tsx`: the last row shows only for loading, an error or
  Show 50 more.
- Tests: `src/__tests__/reader/settings-overrides-ui.test.ts` (every panel
  row padded, the count, the switch's gap) and
  `src/__tests__/ui/settings-reader-panels.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database, in headless
  Chromium, Firefox and WebKit at 1440, 390 and 320 (touch at 390 and 320):
  - every panel row's first text starts 20px in from the panel's edge and at
    least 8px under its top; no panel has an empty row; no last row draws a
    second border;
  - the switch sits 32px above the first title.
- Alignment, overflow, layout, touch and design audits are clean in all nine
  runs. A first build put Refresh 10px off the text edge at 390 and 320 where
  it wrapped under the count; fixed above.
- Review (findings/review-pr-362.md): with more than 50 overrides the pager
  row's Previous sat 12px inside the titles' edge; it now pulls out by its
  padding (`-ml-3`) and starts on it.
- Page weight passes every route; /settings/reader is 64 KB of HTML.
- Typecheck clean, lint no new warnings. No migration, no new package.
