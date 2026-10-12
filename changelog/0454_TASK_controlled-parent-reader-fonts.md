# Task 0454: Controlled parent cache fonts for offline readers

**Status**: In Progress
**Created**: 2026-10-12
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0451
**Blocks**: SLN-489 runtime acceptance

## Overview

Fix SLN-493: a physically offline Firefox reader srcdoc cannot load reader fonts from ordinary URLs despite their verified presence in the controlled parent’s offline cache.

## Implementation Details

The Foliate engine reads only declared versioned font assets from the parent Cache API, verifies exact byte length and SHA-256, and supplies owned blob URLs to the existing stylesheet paths. Missing, invalid, unavailable or slow cache reads retain normal browser font loading, with no new network prerequisite. Optional cache reads are bounded. Missing faces are retried on later section preparation and presentation changes. The existing unused unversioned font generator is not migrated.

The engine keeps the latest requested presentation while font preparation and view opening overlap, and synchronously applies the prepared presentation before declaring ready. An epoch check handles changes between preparation completion and application. Disposal cancels pending installation and revokes owned URLs after the reader closes. Publisher resources remain under their existing ownership.

## Completion Notes

Source and focused tests prepared for cache integrity, partial/missing cache, late download, cancellation, cleanup, both supported stylesheet paths and changing fonts while view.open is pending. All 1,411 focused reader tests and TypeScript checks pass. Independent source review approved the exact patch. The earlier failed readiness assertion is retained as a negative control. Full-suite and fresh built-browser offline acceptance remain pending; no runtime acceptance is claimed here.
