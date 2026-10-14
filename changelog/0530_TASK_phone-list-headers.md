# Task 0530: Phone list headers

**Status**: In Progress
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-639, first part: the browse pages. On a phone the Books page spent its whole first screen on controls, so the first card started below the fold (about 900px at 390 × 844):
- the title and its two actions took two rows;
- the collection switch wrapped onto a second row;
- eight sort chips filled four rows;
- Select had a row of its own;
- the count, the page controls and Per page took three more rows.

The same header is shared by every list page. The first card now starts at 594px at 390 × 844. Nothing was removed: every sort, view, size, filter, selection and paging control is still there.

## Implementation Details

- **The sort** (`EntityFilters`, `src/components/shared/entity-filters.tsx`, 13 list pages). Below `sm` the chips give way to a native menu ("Sort by") that shows the current field, plus a 44px arrow button that shows the direction and reverses it ("Ascending, reverse the order"). Both run the same `pickSort` as the chips, so URLs, the saved library sort and the default directions behave as before. From `sm` up nothing changes.
- **The collection switch** (`DomainSwitch`). Below `sm` it is one row of equal tabs without icons. When the labels do not fit, the row scrolls inside itself (`overflow-x-auto`), never the page.
- **The count row** (`Pagination`, compact, above the list). Below `sm`:
  - the count reads "1–6 of 6", and "Showing" and the noun stay for screen readers;
  - Previous and Next show their arrows only, named by their `aria-label`;
  - Per page is left to the pagination under the list;
  - the row starts at the left.
- **Select.** A new `action` prop puts a control at the end of the count's row. The Books and People pages move Select there on every width, so it no longer has a row of its own.
- **The Books header.** "Identify editions" shows its icon alone below `sm` (`aria-label` names it), so "Books", that icon and "Add book" share one row.
- `docs/03_DESIGN_LANGUAGE.md`, Filters: the phone list header.

## Completion Notes

- **Test:** `library-sort.test.ts` gains a test for the phone controls. The menu shows the current field; the arrow reverses it and saves the choice; the menu picks a field at its default direction.
- **Audits:** a production build on a disposable preview. The alignment, overflow and design audits ran on 14 list pages:
  - pages: Books, Perfumes, Films, Paintings, People, Publishers, Series, Recommenders, Places, Organizations, eBooks, Highlights, Journal and Notes;
  - widths: 320, 360, 390, 430, 768 and 1440 (touch below 768 in Chromium and WebKit);
  - browsers: headless Chromium, Firefox and WebKit;
  - result: 252 of 252 pass, with 0 alignment deviations.
- **Page weight:** `page-weight.js` passes on every route.
- **Found in review:** with more than one page (806 books, "1 / 17"), Select still took a row of its own at 390. Above the list on a phone the row's gaps are 8px and the arrows' 4px, so the count, its arrows and Select share one row at 390; the first book card sits at 595px rather than 651px. At 320 Select still wraps.
- **Still open in SLN-639:**
  - the detail page headers (book, edition, perfume, film, painting, person, collection, series, publisher, organization and place);
  - the filter panel's apply and clear flow on a phone;
  - a single row for the views and the card size, which do not fit together at 390.
