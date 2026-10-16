# Task 0823: Four phone layout notes

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-879, the "Smaller things" of the phone-layout survey
(`findings/phone-layout-survey-2026-10-15.md`): four spots where a phone cut
or broke something.

## Implementation Details

- **Collection tabs** (`domain-switch.tsx`): at 320 the Books / Perfumes /
  Films / Paintings strip was 313-325px in 288 and scrolled, so "Paintings"
  showed as "Paintin". On a phone the tabs are one flex row, equal where the
  row has room and each at least its label's width. A row narrower than
  21rem with four tabs lays them out two by two. Anything narrower still
  scrolls inside itself.
- **A collection's header buttons** (`collection-controls.tsx`): Add, Edit,
  Artwork and Delete need 300px on touch, so at 320 Delete wrapped alone. In
  a row under 19rem the three labelled buttons drop their icons; Delete,
  icon-only, keeps its.
- **A taxonomy family's title** (`taxonomy-family-shell.tsx`): the name
  broke over two lines to leave room for its "System" badge. The name is
  now inline, and the badge and colour dot follow its last word on the cap
  height, a space apart. With no room after it they take the next line on
  the text's edge, as the space drops at a line start. The name only wraps
  when it does not fit on its own.
- **Suggestions** (`suggestion-list.tsx`, `hidden-list.tsx`): titles and
  authors were cut to one line. They now wrap in full, per the card rule.

## Completion Notes

- Measured at 390 and 320 in Chromium, Firefox and WebKit:
  - tabs: one row at 390 (358px, nothing cut), two rows of two 140px tabs
    at 320;
  - collection: all four buttons on one row at 320, touch and mouse;
  - "Perfume families": one line with the badge 9px after it at 390 (a
    line under it in WebKit), and the badge on the next line at 320;
  - a 64-letter suggested title takes 3 lines at 390 and 4 at 320.
- Alignment, design, overflow, layout and touch audits clean on Films,
  Library, two collections, three taxonomy families and Suggestions at
  1440, 390 and 320 in all three browsers. Page weight passes.
- Tests: `src/__tests__/ui/phone-layout-notes.test.ts`.
