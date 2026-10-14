# Task 0548: The SLN-641 contract's rules in docs/03 and CLAUDE.md

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0546 (piece 7), 0547 (SLN-693 part 3)
**Blocks**: None

## Overview

SLN-641 design contract, piece 8. The contract (`design-audit/sln-641-design-contract.md`) marked five rules as new. This piece writes them where pages are designed from: docs/03 and CLAUDE.md. There are no page changes.

## Implementation Details

- **Scale** (docs/03, Typography): two things are drawn off the scale on purpose:
  - the reader settings' type preview, which shows the reader's own size (20px by default);
  - text inside a picture's SVG, such as the stand-in flacon's 11px initials.
- **Quiet buttons on the text edge** (docs/03, Spacing Scale; CLAUDE.md, alignment): a ghost button that starts a row under text pulls out by its own padding. The layout audit's drifting-edge check measures it.
- **Two cards a row on a phone** (docs/03, Book cards; CLAUDE.md, cards): the Compact size keeps two cards a row on a touch screen under 768px (`catalogue-density-compact`, `PhonePairGrid`). This is the one exception to the 208px minimum.
- **Emblems** (docs/03, Iconography; CLAUDE.md, icons): a chosen emblem, such as a collection's icon, is the record's picture. It may be larger than 16px and sits in a 44px button.
- **States** (docs/03, Empty States): the empty block as `EmptyState` draws it. Errors use the same block through `SectionError`. Loading and busy controls follow the contract's defaults, and each line names the slice 3 piece that makes it hold where it does not yet.

## Completion Notes

Each rule was checked against the code before it was written:

- the 20px preview default is in `src/lib/reader/presentation/defaults.ts`;
- the 11px is in the `flacon` utility;
- the phone two-a-row rule is in `globals.css` under `pointer: coarse` and `max-width: 767px`;
- the emblem's 44px button is in `collection-icon-picker.tsx`;
- `EmptyState` and `SectionError` are in `src/components`.

Where a rule does not hold yet (loading, busy buttons, the root error page), the text says which slice 3 piece makes it hold.
