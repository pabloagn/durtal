# Task 0544: Text commands across the app

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0542 (SLN-693 part 1), 0543 (SLN-695)
**Blocks**: None

## Overview

SLN-693 part 2. Part 1 gave the edition card the `text-command` style. The layout audit (SLN-695) and the design audit (SLN-641 slice 2, P3) found more commands that look like the text around them:

- links that only show on hover (film, painting and perfume credits, the book's author);
- labels with no box, underline or icon (the rating's Clear, "Show all", the reading hub's Start and Not now, Up Next's Start reading);
- the eBook state counts and sort buttons;
- the sort chips on every list page, where only the chosen one had a box.

## Implementation Details

- **`text-command`** on links set in a line of text:
  - film credits, starring and "and more", "In the collection" (films, paintings, perfumes);
  - painters, movements, the painting's owner and place, perfume houses and perfumers;
  - the book's author, a person's and a work's external links;
  - the publisher and organization pages' links, the publishers review link, and the website links in the people and publishers tables;
  - the stats page's "See them", the suggestions page's Hidden link and the hub rhythm's Change;
  - the eBook state counts. The one in view has `aria-current` and reads as plain text.
- **Ghost buttons get an icon**: Start and Start reading (BookOpen), Not now (Clock), Add to Up Next (ListPlus), Show all or Show fewer (a chevron).
- **The rating's Clear** keeps its 44px box and puts the text-command look on the word.
- **Create forms**: "Unknown" (painter, perfumer, film person) is an `AddButton` with the plus icon, like "Add person" beside it.
- **Sort chips** (`entity-filters.tsx`, and the eBook page's own) are outlined like `SegmentedControl`, with the chosen sort filled and marked `aria-pressed`. The Filter button (`filter-dropdown.tsx`) is outlined too. A wrapped row now starts on one edge: at 768px the Filter button's icon sat 10px in from the chips above it.
- **A copy's Edit and Delete** (`instance-detail.tsx`) reach into the gap by their padding. Edit's ink starts on the card's text edge when stacked, and Delete's ends on the right edge beside the place.
- **A copy's eBook line**: "eBook details" and "Read" are text commands, and "Unlink…" (`unlink-ebook-button.tsx`) has the unlink icon.
- **The layout audit** (from the SLN-695 review):
  - A known plain, drift or squeezed finding is keyed with its text, numbers as `#` (`phone-audit.mjs`). Before, one entry such as `plain /library/* button.action-control.whitespace-nowrap` covered every command with those classes on the page, so it would have hidden a new one.
  - A known late first card is reported gone only when the page had a card to measure. `/ebooks` (SLN-639) joins the known list: with e-books seeded, its first card is at 526px of 812.
  - A link counts as part of a sentence only when the words around it, without other links and buttons, are a sentence (`layout-audit.js`). Before, the copy's "eBook details" and "Read" passed as sentence links because "EPUB, PDF" and the commands beside them made the line long, with a comma.
- **docs/03** (Buttons) says where text commands go, and that a ghost button carries an icon. Phone widths says how known findings are keyed.

## Completion Notes

- The phone audit's layout check no longer finds any of the SLN-693 entries, and they are removed from `scripts/qa/layout-audit-known.json`. Only the SLN-639 late first cards remain (Books, Authors, Publishers and eBooks).
- With the e-book fixtures seeded (`--seed-reader`), `phone-audit --strict` passes: 0 new and 8 known findings.
- On the two books with an e-book copy, the layout audit finds no plain command in Chromium, Firefox or WebKit, at 390 on touch and at 1440. With the copy line's old classes put back in the page, it flags "eBook details", "Read" and "Unlink…".
- The page-wide plain-command scan (390 touch and 1440) leaves:
  - card and row titles that are links;
  - the /library/new step list;
  - "Open eBook" and the book page's recommender links, whose touch layout is tuned separately.
