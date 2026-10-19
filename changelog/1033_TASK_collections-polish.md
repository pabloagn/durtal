# Task 1033: Collections polish: a sort and live search, whole descriptions, filled member cards

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 1032 (SLN-1058: the lists' counts in SQL)
**Blocks**: None

## Overview

SLN-1059, from findings/collections-survey-2026-10-18.md (items 8, 10, 11 and 13) and findings/regression-sweep-2026-10-18.md, with SLN-845 (the collections search, moved here from the Loading and error states thread, as both change the same toolbar).

The collections list had no sort, a search that reloaded the page on Search or Enter, and a no-match state that offered New collection instead of Clear search. Its cards clamped descriptions. On a collection page, film, perfume and painting thumbnails showed dark bands, only books had Copy, and the note line was set in the monospace face. An empty collection counted "Empty" where an empty series counts "0 books", and a collection with no artwork and no icon showed its letter twice.

## Implementation Details

- **Toolbar** (`collections/collections-filters-bar.tsx`, new): the shared `EntityFilters`, as on Series: search as you type (no document load, the focus stays in the field), sorts Name, Recent and Size in the address, each reversible, Favourites only, and the grid or mosaic with its size slider.
- **Sorts** (`getCollections`): Name keeps the curated order, then name (the order the list had); Recent is when the collection was made, newest first; Size is its members (editions and whole works), largest first. Ties go by name, then id. An unknown sort reads as Name.
- **No match** (`collections/page.tsx`): a search or filter that matches nothing shows `NoResults` ("No collections found", Clear search or Clear filters, keeping the sort and view). A list that empties between the page's check and its read, with no search or filter, still says "No collections yet".
- **Cards** (`collection-card.tsx`): the description is off the card and read on the collection page; a clamp could only cut it. An empty collection counts `EMPTY_COUNT_LINE`, "0 books", as an empty series does, on the card, in the mosaic and in the picker.
- **Count line on one line**: not done, by the coordinator's call. A card at 1440 is 208px (178px inside) and a four-kind line ("6 books · 1 film · 1 perfume · 1 painting") is 295px in its mono face (215px in Inter), so no font change holds it. Summing kinds as "9 items" would keep one line but brings back the form SLN-781 removed. The line keeps wrapping only between kinds; one or two kinds fit on one line.
- **Member cards** (`member-card.tsx`, `collections/[id]/page.tsx`): one 2:3 frame for every kind, and every image fills it: covers and posters to the edges, a perfume's bottle or a painting whole on its own tone. Films, perfumes and paintings get Copy too (`CopyBookButton`'s new `what`: "film title and director", "perfume name and house", "painting title and painter"). The note line is in the body face (`noteMono` removed).
- **Letter once** (`collection-icon-picker.tsx`): `letterShown` makes the icon spot show the plain mark when the poster beside it is the name's letter.
- **One Add on an empty collection**: already so on main (SLN-918); checked.
- `docs/04_ROUTES_AND_VIEWS.md`: the toolbar, the card and the member cards.
- From the #580 review's optional notes: the picker's list takes `overflow-x-hidden` (a classic scrollbar made it scroll 6px sideways in WebKit on Linux), and a stray blank line in `rows()` is gone.

## Completion Notes

- Checked in Chromium, Firefox and WebKit at 1440, 390 and 320:
  - Size orders Decadents (9), the long name (2), Sweep shelf (0), and a reload keeps it; Recent orders newest first.
  - Typing "deca" filters without a reload with the focus in the field; "zzz" shows No collections found with Clear search, which keeps the sort and empties the field.
  - The empty collection has one Add, and its icon spot shows the plain mark beside the "S" poster.
  - Every member card's image fills its 80x120 frame (0px gap), each card has its kind's Copy, and no note is in mono.
- Database test (`collections`): each sort both ways, and an unknown sort. UI tests: no-match Clear search keeps the sort; the member note is not mono; the description stays off the card.
- Alignment, design, overflow, layout and touch audits clean on /collections, a no-match search, a full and an empty collection page, the dashboard and a book page (54 loads). Page weight: /collections 75 of 300 KB.
