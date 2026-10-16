# Task 0847: Finish taxonomy browsing and linked term pages

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-957, SLN-958, SLN-959
**Blocks**: None

## Overview

Complete SLN-960, SLN-936 and SLN-961: bounded family browsing, lean SQL-paged book cards, and connected hierarchy and edition navigation.

## Implementation Details

- Server-filtered and paginated large vocabularies; small hierarchies stay complete, large branches load on expansion.
- Load editor choices only when an editor opens; preserve sibling-only merge choices and all-scope deletion protection.
- Fetch only a page of linked books, select lean author/card columns and read availability alongside card data.
- Show ancestor breadcrumbs, immediate children, direct and descendant counts, edition-linked parent books and navigable custom terms.
- Redirect merged term addresses within their family; shaped skeletons and taxonomy page-weight budgets.

## Completion Notes

Implementation and disposable-data validation in progress. No deployment, schema migration or live catalogue write.
