# Task 0414: Readable dropdown menus

**Status**: In Progress
**Created**: 2026-10-08
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-562: make action, reading, export, card, bulk and contextual menus readable within the viewport, without shrinking or clipping command labels.

## Implementation Details

- Audited the shared DropdownMenu callers, EntityActionMenu consumers and the separate keyboard leader menu before editing. Retained the bulk rating menu's deliberate two-column layout and long dynamic timer/queue labels.
- Shared dropdowns use content width, bounded by 32rem and the visual viewport with an 8px gutter. A native manual popover floats above clipping ancestors while retaining trigger ancestry for dialog focus restoration.
- Placement respects start/center/end and top/bottom preferences, flips toward available space, updates on scrolling/resizing, and constrains an inner scrolling list on short screens. The glass surface itself does not scroll.
- Shared grid tracks reserve icons and shortcuts only when present, keep labels aligned in mixed rows, and allow full labels to wrap when space is constrained. Shortcut hints use a separate no-wrap column with 20px breathing room. Icons align to the first text line's cap height.
- Both reading and entity menu hints use the shared shortcut API. Book/person card destructive commands form a final separated group. Leader menus stay bounded and scroll their list, including the active item.
- No trigger/control sizing changes (SLN-564 owns that scope), new packages, schema changes, or live DB/S3 writes.

## Completion Notes

Focused checks: 44 existing/placement tests and 3 new keyboard/focus tests pass. Typecheck passes; lint has zero errors and 75 existing warnings. Desktop book actions and reading menus keep ordinary labels on one line; measured book-page alignment has no issues over 0.5px.

Full local tests, production/Docker builds, production page-weight and remaining responsive browser checks are in progress on disposable fixtures at preview port 3421. This draft is awaiting independent review and an explicit integration slot; it must not be merged yet.
