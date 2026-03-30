# Task 0052: Authors Archive Page Filters Overhaul

**Status**: Not Started
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Feature
**Depends On**: None
**Blocks**: 0058

## Overview
The authors archive page filtering is severely limited -- only country of origin is available, and there is no search bar. The filters need a complete overhaul to support the full range of author metadata fields and provide a rich filtering experience.

## Schema Changes

### Authors table (`src/lib/db/schema/authors.ts`)
Add a stored `zodiacSign` column:
- Type: `text` (one of: aries, taurus, gemini, cancer, leo, virgo, libra, scorpio, sagittarius, capricorn, aquarius, pisces, or null)
- Computed from `birthMonth` and `birthDay` columns (which already exist)
- Uses tropical (Western) zodiac date ranges (industry standard):
  - Aries: Mar 21 - Apr 19
  - Taurus: Apr 20 - May 20
  - Gemini: May 21 - Jun 20
  - Cancer: Jun 21 - Jul 22
  - Leo: Jul 23 - Aug 22
  - Virgo: Aug 23 - Sep 22
  - Libra: Sep 23 - Oct 22
  - Scorpio: Oct 23 - Nov 21
  - Sagittarius: Nov 22 - Dec 21
  - Capricorn: Dec 22 - Jan 19
  - Aquarius: Jan 20 - Feb 18
  - Pisces: Feb 19 - Mar 20
- Nullable: authors without `birthMonth` or `birthDay` get null
- In the UI, null zodiac renders as "Not Available" or is excluded from filter results

### Migration
- Generate Drizzle migration adding `zodiacSign` column to `authors`
- Backfill all existing authors: compute zodiac from `birthMonth` + `birthDay` where both are non-null
- Update `docs/02_DATA_MODEL.md` to reflect the new column
- Update `createAuthor` and `updateAuthor` server actions to auto-compute zodiac sign when birth month/day are provided or changed

No other tables need schema changes -- all other filter dimensions already exist on the authors table.

## Filter Implementation

### Current state (in `authors-shell.tsx` and `page.tsx`)
- Search: `q` param exists and works for name search via `EntityFilters`
- Sort: name, recent, birth, works
- Filters: only `nationality` via `FilterDropdown` + `getDistinctNationalities()`

### New filters to add
- **Country of origin**: Keep existing, fix any issues
- **Birth year range**: Range slider (min-max) using the `birthYear` column
- **Death year range**: Range slider (min-max) using the `deathYear` column
- **Gender**: Multi-select dropdown (male/female from existing enum)
- **Alive/Deceased**: Toggle or dropdown (deceased = `deathYear IS NOT NULL`)
- **Zodiac sign**: Multi-select dropdown using the new `zodiacSign` column. Null values shown as "Not Available"
- **Literary movement**: Multi-select, derived from works linked to the author (join through `workAuthors` -> `works` -> relevant taxonomy)
- **Language**: Multi-select, derived from works' original language

### UI Considerations
- Range slider component needed for year-based filters (birth year, death year)
- Multi-select dropdowns for categorical filters
- Clear all / reset filters button
- Filter count indicator
- Responsive layout for the filter panel
- All filter state persisted in URL search params
- Match the existing dark-mode gothic-minimal design language
