# Task 0067: Improve Gender and Country Visibility

**Status**: Completed
**Created**: 2026-03-31
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
Gender and country of birth on the author detail page were nearly invisible due to low-contrast text (`text-fg-muted`, `text-xs`). Made both more visible.

## Implementation Details
- Modified `src/app/authors/[slug]/author-detail-header.tsx`
- Country: upgraded from `text-fg-secondary` to `text-fg-primary font-medium` and made it a clickable link (part of Task 0064)
- Gender: upgraded from `text-xs text-fg-muted` to `text-sm text-fg-secondary capitalize`
- Life dates: upgraded from `text-fg-muted` to `text-fg-secondary`
- Container class changed from `text-fg-secondary` to plain `text-sm` to avoid inherited muting

## Completion Notes
Gender, country, and life dates are now clearly visible against the dark background, including when a cinematic backdrop image is present.
