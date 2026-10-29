# Task 1153: Exclude the personal catalogue from crawler indexes (SLN-1457)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Tell crawlers to leave the personal catalogue and its files out of indexes.

## Implementation Details

Both document roots set noindex/nofollow metadata. Every response gains X-Robots-Tag without changing the existing security headers. The robots route disallows every path for every user agent. Header and route tests cover the policy. This does not replace authentication or change network exposure.

## Completion Notes

Twenty-two production-mode checks passed: catalogue, reading, reader, offline and unmatched-page metadata in Chromium/Firefox/WebKit; robots.txt, health, media and ranged e-book responses. Header and route tests passed in the full suite. Typecheck, lint, build and page-weight checks passed. Deployment remains tracked in Linear. No infrastructure, authentication, purchase or live-data change is included.
