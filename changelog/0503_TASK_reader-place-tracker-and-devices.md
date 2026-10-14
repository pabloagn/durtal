# Task 0503: Reader fixes, batch 4 (your place, the reading tracker, two devices)

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0501
**Blocks**: None

## Overview

The fourth batch from the 13 October e-book review (`/mnt/project-files/ebooks/review-2026-10-13.md`): a book reopened six pages early in Chromium (SLN-676), the opening jump counted as reading (SLN-677), and the reader on two devices (SLN-686). SLN-665 is held for its migration.

## Implementation Details

- **SLN-676, reopening on the saved page.** A place was saved as the visible range. When a page starts on an image, the range starts on an element boundary and has no boxes in Chromium, so reopening fell back to the start of the chapter.
  - `placeCfi` (`engines/foliate/locator.ts`) saves the range's start point instead. The paginator anchors a point on the element it names.
  - A place saved before this change is opened at its start point too (`engine.ts`, open at a saved place).
- **SLN-677, the reading tracker.**
  - The engine's first landing in a file carries `opening` on its location event. The controller starts the sitting there instead of counting the jump from where it was.
  - Reading on from a forward jump that has not qualified (two active minutes) ends the sitting and starts a new one at the jump (`reader-position.ts`, `jumped` split). A jump that has qualified still counts, as SLN-454 decided.
  - On the server, a sitting that starts away from where the previous session ended is not merged into it (`canMergeReaderSitting`). A reader session that starts ahead of the previous session keeps its own start (`planPositions`). Manual and timer logs still start where the one before ended.
  - The back link waits, for at most 2 s, for the open sitting to reach the server before it leaves (`bridge.leave`, `useBeforeReaderLeave`). The book page is current on arrival.
  - The toolbar's percent follows the reader's place, also after a jump that is not counted yet.
- **SLN-686, two devices and settings.**
  - The other-device offer says how far the place is from yours, in pages when both have numbered pages, and names the device with its browser: "Page 7 · 7 pages behind you · Linux · Firefox · 2h ago".
  - When another device's place is further than both the newest place and yours, a Furthest button goes there.
  - The opening line is shorter ("Your place from Linux · Chrome"), and it does not appear when a link opened the book at a mark.
  - Reader settings open in a sheet: on the right from 768 px, at the bottom on a phone. The sheet does not dim the page, so the text changes while you watch.
  - The device class comes from the screen and the pointer, not the window. A laptop is a desktop. Settings saved while a laptop was classed as a tablet carry over, field by field, until desktop settings replace them (`effectivePresentation`).
  - Under 400 px, Settings moves into More so the title keeps a few words.

## Completion Notes

- Tests: the place normaliser on an image page, the opening and short-jump sittings, the merge rule and the planner for jumped reader sessions, the device class, the carried-over settings, the offer text and the furthest offer.
- Not covered yet:
  - SLN-665 (Places grouping and History) waits for its migration decision.
  - A real tablet's settings also carry over to a desktop that has none of its own.
- No migration and no new packages.
