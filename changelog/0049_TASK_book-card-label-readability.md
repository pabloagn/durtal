# Task 0049: Book Card Label Readability (Glassmorphism)

**Status**: Not Started
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
The small labels on book cards (e.g., "Wanted", award badges, catalogue status) overlap with book cover content and are often unreadable. The labels need blurred backgrounds to maintain the glassmorphism design language while ensuring readability.

All labels must be treated uniformly -- same blur intensity, same padding, same opacity treatment. No label should be an exception.

## Implementation Details
- Audit every label/badge variant rendered on book cards (catalogue status, awards, ratings, etc.)
- Apply a consistent glassmorphism treatment: `backdrop-blur` + semi-transparent background
- Ensure sufficient contrast between label text and blurred background
- Keep the existing design language (dark-mode, muted colors, 2px border radius)
- Labels must be uniform: same blur, same padding, same border treatment across all types
- Test with a variety of cover images (light covers, dark covers, busy patterns)
