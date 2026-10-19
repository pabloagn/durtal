# Task 0958: One way to write a person's life dates, and Born and Died on their page

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A person's page wrote "1848 - 1907" with a spaced hyphen, and "1950 - " for someone living. The cards and list rows wrote "1848–1907", without the "c." the page gave an approximate year. A person with only a death year showed no dates anywhere. The table and the person picker printed raw years with "?" for an unknown birth, and the timeline said "1950 — present". Birth and death days and places were edited in the person form but never shown, and the page did not load the places. Sources: findings/people-survey-2026-10-18.md (finding 1), findings/places-publishers-survey-2026-10-16.md (item 1) and findings/wording.md (section 1). Fixes SLN-1006.

## Implementation Details

- `src/lib/utils/format.ts`:
  - `lifeDates(person)`: "1848–1907", "b. 1950" for the living, "d. 1890" when only the death is known, "c." before an approximate year, BC years through `displayYear`; null with neither year.
  - `lifeEvent({ year, month, day, approximate, place })`: the person page's Born and Died lines, as precise as the record: "5 February 1848, Paris", "May 1907", "c. 1450", "Paris". An approximate year drops its month and day.
  - A life that crosses the era marks its second year: "c. 70 BC–AD 19", not "c. 70 BC–19".
  - `lifeYear(year, approximate)`: one year, as the People table's Born and Died columns now show it ("c. 1450", "428 BC"), where they printed the raw number ("-428") and dropped the "c.".
- Every copy of the rule now calls `lifeDates`: the person page header, `author-card.tsx`, `author-list-item.tsx`, the People table's Years column (`authors-shell.tsx`), `recent-people-grid.tsx` on the dashboard, the map's popups (`authors-map.tsx`), the timeline's tooltip and bar label, and the person picker's hint (`record-fields.tsx`).
- The approximate flags reach each of them: the People list (`people/page.tsx`, `AuthorItem`), the dashboard's recent people (`library-stats.ts`), the map (`author-map.ts`, and `map-groups.ts` reads them back from the GeoJSON properties), the timeline (`author-timeline.ts`) and the picker (`getPeople`).
- `src/app/(catalogue)/people/[slug]/page.tsx`: the Details group starts with a Born and a Died line from `lifeEvent`. `getAuthorBySlug` loads the birth and death places (id and name).
- Places have no pages of their own (the place pages are venues), so the place is text, as the ticket says until such pages exist.
- Tests: `utils/life-dates.test.ts` (both years, living, death year only, approximate, BC, a life across the era, `lifeYear`, never "?", full dates with places, a scan that no copy of the rule, and no raw year in a cell, is left outside `lifeDates`, the page's Born and Died lines and the places it loads); `utils/map-groups.test.ts` reads the approximate flags from a map feature.

## Completion Notes

Checked on a production build with a private preview database: with Huysmans born 5 February 1848 and died 12 May 1907, both in Paris, his page's header reads "1848–1907" and its Details read "Born 5 February 1848, Paris" and "Died 12 May 1907, Paris". A living person with an approximate birth year reads "b. c. 1950" on their page, the People grid, list and table and the dashboard; a person with only a death year reads "d. 1955" everywhere. The timeline bar is labelled "Joris-Karl Huysmans, 1848–1907". The alignment audit found no deviation on /people, two person pages and the dashboard in three engines at 1440, 390 and 320px; page weight passes every route.
