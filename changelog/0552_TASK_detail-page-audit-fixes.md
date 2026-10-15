# Task 0552: Detail page fixes from the 15 Oct audit

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0551 (SLN-693 part 4)
**Blocks**: None

## Overview

An audit of main on 15 Oct (every detail kind, `/library` and the reading pages, in Chromium, Firefox and WebKit at 1440, 390 and 320) found the alignment audit clean, along with a few things that still looked cheap or sat a pixel or two off. This task fixes those in the perfume facts, a publisher's wanted books, the person page, and the taxonomy rows. Place titles, series rows and phone title sizes went to another thread.

## Implementation Details

- **Perfume formulations** (`perfumes/[slug]/page.tsx`).
  - Before: on touch, each Concentration chip grew to a 44px outlined box (`min-h-11`). At 390 the three chips stacked into a 144px column, and the label sat 7px above their text.
  - Now each chip keeps its 26px box and takes a 44px press area with `touch-hit`. On touch, rows of chips sit 18px apart (`pointer-coarse:gap-y-4.5`), so the press areas do not overlap.
  - The label and the chips share a baseline (`self-baseline` on the `dt` and `dd`). It was 2px off at 1440, from a 28px label line beside a 26px chip.
- **Formulation names** (`formulations-section.tsx`): each name is the `h3` of its row, as the reading lists' titles are in 0551. The plain-command scan had counted those links as text.
- **Note pyramid** (`note-pyramid.tsx`): the list aligns on baselines (`items-baseline`). Top, Heart and Base (12px captions) sat 2px above their 14px notes.
- **Taxonomy rows** (`taxonomy-assignments.tsx`): the family label and Add take a 26px line (`leading-6.5`), a chip's height. Before, both sat on a 24px line, 1px off the chips' text: "Painting genres", "Perfume families" and the films' genres.
- **Publisher's wanted books** (`publishers/[slug]/page.tsx`).
  - "Wanted from this publisher" was a bordered list of plain title links: 24px tall on touch, and counted as text by the scan.
  - It is now a shelf of book cards (`WorkCarousel`, as "More in this series"), with each card's target under it ("Gallimard · Wanted"; a book wanted from the house and an imprint shows both).
  - The shelf holds the first 24 books. Its heading counts them all and opens the Books list filtered to wanted and on order.
  - `WorkCarousel` passes an optional `count` to its heading.
- **Placeholder letters**: an edition with no cover in a person's contributions showed its initial in `fg-muted/30` without `data-decorative`. The design audit failed /people/[slug] on it at every width. It and three like it now carry `aria-hidden="true" data-decorative`, as the book and collection cards' letters do:
  - the venue list;
  - Match again's results;
  - the people list.
- **e-book suggestion line** (`ebook-suggestion-line.tsx`): it takes a `className`, which defaults to its `mt-3`. On a person's page it opens the column, so it takes `mb-8` there. It had touched the Books (or About) heading, with a 0px gap.

**Not changed:** the audit's 1px slip in the phone pagination summary. Measured on each text node, "1–26 of 26" and "1 / 1" share a line top. The probe had read the summary's screen-reader-only "Showing" instead.

## Completion Notes

Checked on a production build with the seeded preview:

- the long names from the audit;
- seven books wanted from Gallimard.

Results:

- **Browser runner:** alignment, design, overflow and touch pass on 10 pages in Chromium, Firefox and WebKit at 1440, 768, 390 and 320:
  - two publishers, two perfumes, a film, a painting, two people, /people and /places.
- **Row probe and layout audit:** no baseline or gap slip is left on the perfume, film, painting, publisher or person pages, and the formulations are no longer plain commands.
- **Measured at 390:** the chips are 26px tall, their label is on their baseline, and the suggestion line has 32px under it.
