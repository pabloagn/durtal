# Task 0045: Author Page Upgrade -- Edit, Excerpt, Beautiful Works Display

**Status**: Completed
**Created**: 2026-03-29
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0044
**Blocks**: None

## Overview

The author detail page is bare-bones -- just a name, country, and a plain list of works with no covers. This task upgrades it to match the quality of the work detail page: edit dialog, rich metadata display, beautiful works grid with posters, catalogue status, and priority.

## Changes

### 1. Update `getAuthorBySlug` query
- Include work `media` (for active poster), `catalogueStatus`, `acquisitionPriority`, `rating` on each work
- Include work `slug` for navigation

### 2. Author Edit Dialog
- Client component with full edit form for all author fields
- Fetches countries list for nationality selector
- Fields: name, sortName, firstName, lastName, realName, gender, birth/death dates, nationality, bio (textarea), website, openLibraryKey, goodreadsId

### 3. Author page redesign
- Edit button in header (opens edit dialog)
- Delete button in header
- Richer metadata display (gender, birth/death with month/day if available, nationality as badge)
- Bio section (excerpt style, same as work description)
- Works section: grid of book cards with posters, catalogue status badges, priority dots (not a plain list)
- Edition contributions: keep as list but with thumbnails
- External links section (already exists)

### 4. Works display
- Use a grid of BookCard components (same as library) for authored works
- Each card shows: poster (from work media), title, year, catalogue status, priority, rating

## Files

| File | Change |
|---|---|
| `src/lib/actions/authors.ts` | Enrich `getAuthorBySlug` query |
| `src/app/authors/[slug]/page.tsx` | Complete redesign |
| `src/app/authors/[slug]/author-edit-dialog.tsx` | New: edit dialog |
| `src/app/authors/[slug]/author-delete-button.tsx` | New: delete button |

## Completion Notes

[Left empty]
