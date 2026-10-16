# Task 0708: Every control has an accessible name (SLN-841)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0707
**Blocks**: None

## Overview
The Fifth reviewer's accessible-names survey (`findings/a11y-names-survey-2026-10-15.md`, main 7f4e21e9, Chromium's accessibility tree over 64 routes, the reader left out) found five controls that a screen reader announced with no name, or named only by their placeholder. Each lives in one shared component.

## Implementation Details
- `src/components/books/book-card.tsx`: a book with no cover, or a cover that failed to load, gives its cover link the title as hidden text (`sr-only`). That link is the card's only tab stop, and it was announced as just "link", or with no name at all for a title with no letter ("!!!"). #408's review fix had named it with `aria-label={title}`, but a label replaces the link's content, which hid the cover's marks ("Rare", "eBook available") from a screen reader. That label is gone, so every cover link is named by its image's alt or its hidden title, followed by its marks. Test: `src/__tests__/ui/cover-link-name.test.ts`, both cases.
- `src/components/venues/venue-card.tsx`: a place card's picture link is named by the place (`aria-label={name}`). Its plate is decoration, and the title link is out of the tab order.
- `src/components/layout/command-palette.tsx`: the palette's field gets `aria-label="Search the catalogue, or type a command"`. A combobox takes no name from its placeholder.
- `src/components/shared/entity-filters.tsx`: each list search is named from its placeholder without the "..." ("Search people"). It is used on /library, /people, /publishers, /series, /places, /films, /paintings, /perfumes, /recommenders, /reading/journal, /reading/notes, /ebooks/highlights and a publisher's books. Add book's search and the taxonomy filter get the same names.
- `src/components/ui/select.tsx`: the open list is named as its field is (`ariaLabel ?? label`).
- Test: `src/__tests__/ui/accessible-names.test.ts`.

## Completion Notes
Chromium's accessibility tree, on a production build, shows no unnamed or placeholder-only link, button, field, combobox, listbox or option in any of these:
- /library, /places, /people, /publishers, /series, /library/new, /taxonomy/subjects and /reading/journal;
- the palette with "ma" typed;
- a Settings Select while it is open.

The alignment audit is clean in Chromium, Firefox and WebKit at 1440, 1024, 390 and 320 on /library, /places, /library/new, /taxonomy/subjects, /people and /settings/display. Page weight passes: /library is 286 of 300 KB.
