# Task 0425: Grouped image adjustment panel

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: SLN-556, SLN-333 capability foundation
**Blocks**: None

## Overview

Replace the image editor's wrapping adjustment row with a prominent preview and a compact inspector. Tone, Colour and Framing form deliberate disclosure groups. The selected adjustment keeps its label, value, per-setting reset and slider together.

## Implementation Details

- The shared editor uses a container-aware two-column layout and stacks below 580px of available width. Its content scrolls inside a bounded viewport; Compare, Reset all and Save remain outside that scroller.
- Standalone adjustment dialogs use the wider existing dialog size and opt out of host-body scrolling. Other dialog callers retain the default scroll behavior; embedded editors still precede media details and uploads.
- Controls use the existing Inter/JetBrains Mono typography, 4px corners, Quiet Glass host material and readable tokens. Native disclosure buttons expose their expanded state, range inputs retain their keyboard behavior and touch controls have 44px targets.
- Loading/failure return only their appropriate status or retry UI. Per-setting reset restores one neutral value, while Reset all restores all settings and framing under the existing monochrome rule.
- Server processing, crop policy and rotation are coordinated separately under SLN-333. Originals, saved comparison baseline and adjustment propagation retain their existing contracts pending integration of that foundation.

## Completion Notes

The concrete desktop/mobile proposal received independent design approval before production edits. This initial source checkpoint is awaiting the coordinated capability foundation, full verification and exact-head independent reviews. Initial lightweight verification: TypeScript no-emit check passed; five editor regressions and ten existing dialog regressions passed (15/15). Full source lint passed with zero errors (75 warnings). These do not substitute for the pending full local, production and browser gates. No live database or storage operations were performed.
