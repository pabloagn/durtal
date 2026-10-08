# Task 0413: Bounded collection description previews

**Status**: Completed
**Created**: 2026-10-08
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0412
**Blocks**: None

## Overview

Fix SLN-565: full collection descriptions stretched cards and every neighbouring card into very tall columns after SLN-558.

## Implementation Details

CollectionCard explicitly uses the existing two-line preview utility for descriptive prose. Collection names and identifying metadata remain fully wrapping. The collection detail page retains the complete description; saved content is unchanged. The shared card fixes collection grids, dashboard cards and book-detail shelves together.

## Completion Notes

Typecheck and lint pass (no lint errors; 75 existing warnings). Rendered regression checks cover long, short and absent descriptions on the dashboard, collections grid and book-detail shelves, including unchanged full detail-page prose. Full-suite, browser and release validation results are recorded in the pull request before merge. The project guidelines now explicitly require reviewing affected call sites and content/layout edge cases before merging shared UI changes.
