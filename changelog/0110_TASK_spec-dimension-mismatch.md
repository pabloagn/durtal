# Task 0110: Resolve Image Dimension Spec vs Code Mismatch

**Status**: Completed
**Created**: 2026-04-06
**Priority**: LOW
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
Image processing dimensions in code are 2-3x larger than documented in `docs/07_STORAGE.md`. Either the spec or the code must be updated to match.

## Mismatches
| Image Type | Spec (07_STORAGE.md) | Code (s3/covers.ts, s3/media.ts) |
|---|---|---|
| Cover | 400x600 | 1200x1800 |
| Thumbnail | 200x300 | 600x900 |
| Poster | 800x1200 | 1600x2400 |
| Background | 1920x1080 | 2560x1440 |
| Gallery | 1600x1600 | 2400x2400 |

## Implementation Details
Decision required: update spec to match code (larger = better quality) or reduce code dimensions to match spec (smaller = faster, cheaper).

Recommendation: Update `docs/07_STORAGE.md` to match code, since larger dimensions are already in production with existing media.
