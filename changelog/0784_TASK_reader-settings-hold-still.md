# Task 0784: Settings > Reader holds still while it loads

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-875, split out of SLN-861 (loading survey of 15 Oct, finding 3). With
every read held 800 ms, `/settings/reader` at 1440 shifted by 0.074. The
Lookup group arrived as one "Loading lookup settings" line and grew by about
900px when this browser's sources filled it in. The dictionaries and lookup
history groups each added a "Loading" row and took it away again, and so did
Books with overrides, which read again the overrides the page came with.
Everything below moved each time.

## Implementation Details

- `page.tsx` reads the lookup settings with the page, beside the reading
  defaults and overrides, and hands them to `LookupSettingsGroup` as
  `initial`. The group renders them on the server (with stable keys, so
  the source rows' ids match on hydration) and copies them to this browser.
  After the first paint it still asks the server once, as before, because a
  page brought back by Back keeps the copy it first came with; the rows change
  only if the server's copy differs, so the next edit never saves an old list
  back. If the read with the page fails, the group works as before: this
  browser's copy first, then the server's after the first paint.
- `dictionaries.tsx`: the first read of this device's dictionaries is
  announced only to screen readers, and Add dictionary waits for it. Later
  operations (add, remove) keep their visible status and Cancel.
- `lookup-history.tsx`: until the first read, the count's line says
  "Loading lookup history" instead of a row of its own. Loading more still
  shows its row.
- `reader-defaults.tsx`: the first page of overrides the page came with is
  checked once without a loading row, and replaces the list only if it
  changed (again for Back); a failed check keeps the list and says nothing.
  The panel remounts for each device size, so a return to Desktop reads its
  list again the usual way.

## Completion Notes

- Server actions held 800 ms, Chromium layout shift:
  - 1440: 0.0744 on main, 0.0001 now (one text node).
  - 390: 0.0007 on main and now.
- Section tops, sampled every frame for 6 s at 1440: on main Lookup moved 57px
  and the groups below it about 960px, in Chromium, Firefox and WebKit. Now
  nothing moves in Chromium and Firefox. In WebKit only Lookup history moves
  (36px), because headless WebKit cannot open the device's private file
  storage and the dictionaries group then shows that error.
- 0 alignment, design-audit and overflow findings at 1440 and 390 in all three
  engines, and no console errors.
- Tests: `settings-ui.test.ts` (the sources the page came with render on the
  server and keep their rows when the server has the same; an older copy from
  Back gives way to the server's; editing one still saves it);
  `review-and-lookup-counts.test.ts` (the history's first read changes no
  rows); `settings-overrides-ui.test.ts` (one quiet check on the first view,
  an older list from Back replaced, the same list kept, a failed check silent,
  and a late reply still ignored after leaving);
  `settings-reader-panels.test.ts` (the history's loading row).
- Not done: at 390 the reading preview's sample text changes height when its
  font arrives (a cold cache moves the groups below by 38 to 60px, out of
  view, so the shift stays 0.0007). The font's face is defined only after
  hydration; keeping it still needs the face on the server or a
  metric-matched fallback.
- No migration and no new packages.
