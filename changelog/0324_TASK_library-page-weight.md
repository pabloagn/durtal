# Task 0324: /library under its page weight budget

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-381 remainder. `/library` weighed 308-313 KB against its 300 KB budget
(`scripts/qa/page-weight.json`). It now weighs about 284 KB, with every
feature kept.

## Implementation Details

Measured on one disposable preview of the live dump of 2026-10-04 (690 books,
48 cards a page), main against this branch:

- The HTML held 149 inline SVGs, 59 KB. The copy button and the actions menu
  on every card (48 each) repeated their full Lucide markup, about 380 bytes
  each: 36 KB. `IconSprite` (`src/components/ui/sprite-icon.tsx`, once in the
  root layout) holds those two Lucide icons once; `SpriteIcon` draws one with
  `<use>`, about 90 bytes. Same paths, same 1.5px stroke (`sprite-icon`).
- Every card image carried a long arbitrary transition class from
  `FadeImage`; it is now the `fade-image` utility in `globals.css`, with the
  same timing and the same reduced-motion rule.

| | Before | After |
|---|---|---|
| `/library` HTML | 311.5 KB | 283.8 KB |

## Completion Notes

- The sprite is drawn off-screen (not `display: none`, which some browsers
  draw nothing through). Chrome, Safari and Firefox 157 at 1440, 768 and
  390 px: 48 cards, both icons drawn (their `<use>` boxes measured), no
  overflow; alignment and design audits clean.
- The other main routes keep their budgets (`page-weight.js`).
