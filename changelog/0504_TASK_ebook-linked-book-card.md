# Task 0504: The eBook's book as a cover card

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

The first part of batch 5 from the 13 October eBook review (`/mnt/project-files/ebooks/review-2026-10-13.md`). On an eBook's page, "The book it belongs to" was one sentence and a bare "Unlink…" link (SLN-666). It is now a card with the book's cover. The page no longer scrolls sideways at 320 px.

## Implementation Details

- `getLinkedBook` (`src/lib/ebooks/linked-book.ts`) reads the linked copy's book in one query:
  - the authors and co-authors;
  - the eBook edition's cover, else the book's poster with its crop and tone;
  - the edition's publisher, year and translators;
  - the copy's location;
  - the status, rating, rare and poison marks, and the open reading.
- `linkedEditionLine` joins what the edition has: "Everyman's Library · 1995 · translated by A and B".
- `EbookLinkPanel` draws the card:
  - The cover carries the rare and poison marks, as on book cards. Beside it come the title (`CardHeading`, linking to the book page), the authors, the edition line, "eBook copy in …", the info row (status or reading, rating) and "Open book".
  - Unlink moves into the card's menu ("Book actions", `LinkedBookMenu`) and keeps its confirmation dialog. `useUnlinkEbook` shares the loading and the dialog with the book page's Unlink button.
  - An eBook that is not linked gets the same card shape, with a placeholder cover. It says what state it is in (not linked yet, kept as an eBook, set aside) and shows the existing decisions across the card's full width.
  - The card is a container-sized grid. From 340 px of card width, the cover sits beside everything. Below that, it sits beside the title only, and the rest takes the full width. Titles and names wrap in full.
- The text column beside the eBook's own cover wraps below the cover when there is no room for a format button. That button was what made the page scroll sideways at 320 px.

## Completion Notes

- Tests: `linkedEditionLine`.
- Checked in the preview at 1440, 768, 390 and 320 px, with a long title, two authors, two translators, a long publisher and a cover, and with no details at all. The alignment, design and overflow audits are clean.
- Not covered yet:
  - "Change the book…" needs a relink service: today you unlink, then choose the book.
  - The preview's seeded links have no matching receipt, so Unlink there stops at "The decision could not be verified". Real links carry one.
- No migration and no new packages.
