# Task 0074: Filter Dropdown Search for Nationality and Other Groups

**Status**: Completed
**Created**: 2026-03-31
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
Added a search input within filter dropdown groups that have 8 or more options. This allows searching for a specific nationality (or any filter value) instead of scrolling through a long list.

## Implementation Details
- Modified `src/components/shared/filter-dropdown.tsx`
  - Added `SEARCH_THRESHOLD` constant (8 options minimum to show search)
  - Added `groupSearchTerms` state to track per-group search text
  - When a group has >= 8 options, a search input with a Search icon appears at the top
  - Search is case-insensitive and filters options by label match
  - Applies to all checkbox-type filter groups (nationality, gender, zodiac, etc.)
  - Range slider groups are unaffected

## Completion Notes
The nationality filter (which typically has many countries) now shows a search box at the top. Typing "ger" will filter to show only "Germany", "Algeria", etc. This also applies to any other filter group with 8+ options.
