# Task 0593: A book's eBook line: Unlink on the line, the size once, commands whole

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0586
**Blocks**: None

## Overview

Three issues the #278 review found on the book page's Digital facts, all
older than that PR: "Unlink…" was a 28px ghost button set 2px above the
eBook line's text; the size showed twice ("EPUB · 60.9 KB" and again as
"File Size 60.9 KB"); and "eBook details" could break between its words on
a phone.

## Implementation Details

- `instance-detail.tsx`: the eBook fact is a wrapping row (`flex flex-wrap
  items-baseline gap-x-3`): the formats and size, then eBook details, Read or
  Continue, and Unlink…, each `whitespace-nowrap`. A command that wraps
  starts on the column's edge rather than 12px in. The reason an eBook
  cannot be read, and an Unlink error, take a line of their own.
- "File Size" shows only when the eBook line has no size of its own.
- `unlink-ebook-button.tsx`: `inline` renders Unlink… as a text command, as
  the links beside it are; the review queue keeps its button.

## Completion Notes

- Measured on a book with a linked eBook and a copy file size, in Chromium,
  Firefox and WebKit at 1440, 768, 390 and 320: at 1440 and 768 the size and
  the three commands share one line, each label's top on the text's (0px);
  on a phone each command is whole and starts at the column's edge. "File
  Size" no longer shows. No page scrolls sideways (the first version, with
  12px margins, overflowed 51 to 60px at 320 in Firefox and WebKit).
- Alignment, design, overflow and touch audits clean on the book page in
  three browsers at six widths (18 of 18).
- `copy-ebook-links.test.ts` pins the row, the whole commands, the inline
  Unlink and the single size.
- No migration, no new package.
- Review fix: at 320 on touch, a tap on "eBook details" opened Unlink…,
  whose 44px press area reached over the row above. On touch, wrapped rows
  now sit 28px apart (`pointer-coarse:gap-y-7`, as the e-book files table's
  commands do), so the press areas never overlap.
