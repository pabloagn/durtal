# Task 0522: Keyboard ownership contract and coverage inventory

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0490, 0491
**Blocks**: SLN-632, SLN-571, SLN-633, SLN-634

## Overview

SLN-630, the first step of SLN-629: one written contract for who owns a key
(topmost layer, the reader, IME, held keys, page letters), what Enter, Esc
and ⌘Enter do in each kind of field and dialog, and the inventory the next
tickets work from.

## Implementation Details

- `docs/15_KEYBOARD.md` (new, listed in `docs/00_README.md`):
  1. the contract, as implemented by tasks 0490 and 0491;
  2. the global key map against the owner's mappings (N for New; A then B,
     P, A, F, C; E then C and M), with each conflict and the ticket that
     resolves it;
  3. the visible actions of 11 detail-page families and the keys that reach
     them;
  4. one row per `Dialog` in the source (97), with its kind, its main action
     on Enter and its unsaved-work guard, plus the page drafts;
  5. a disposable-preview verification plan for SLN-632, 571, 633 and 634.
- No code change.

## Completion Notes

- Gaps recorded for the next tickets: viewers, pickers and managers have no
  Done for Enter; danger confirmations ignore Enter on purpose (needs the
  owner's word before Enter may delete); A opens a menu instead of being a
  prefix; A P, A F, A C and bare F conflict with the requested mappings;
  the E menu exists on the book page only; the leader menu survives a client
  navigation.
- Browser evidence listed in the document comes from the #217 and #223
  reviews and SLN-638's journeys; the rest is read from source.
