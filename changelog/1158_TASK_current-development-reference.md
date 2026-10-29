# Task 1158: Reconcile development and configuration references (SLN-1272)

**Status**: Completed
**Created**: 2026-10-29
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Correct stale command descriptions, dependency lists, configuration notes, routes and section references without changing ingestion, deployment or application behavior.

## Implementation Details

Task dev is documented at 3100 and task lint includes knip. Missing pnpm command rows come from package.json. The dependency-name guard allows only the exact pre-existing snapshot command row in the development table; app screens and dependency requirements remain prohibited. Dependency lists link to the actual manifests; obsolete boto3/nuqs/csv-parse entries are gone. The guides name the personal AWS-account check, server calendar zone, preview-only S3 directory and isolated inspector hostname. Missing upload/offline/settings routes and the TUI reading panel are listed. Storage and migration references point to their existing sections. The old speech checkpoint is preserved in its historical changelog, without claiming new acceptance.

CLAUDE.md changes are limited to four reference/convention corrections: the live migration workflow comment, task dev's port, task lint's knip step, and checking changelog numbers against main/open PRs while allowing gaps. No permission or autonomy rule changes.

## Completion Notes

All 34 local Markdown links and the changed section references resolve. The Taskfile command list was inspected. Changelog 1157/1158 were absent from origin/main, local refs and all eight open PRs before allocation. No package was installed or changed. All 14 Python suites passed. The full suite passed 9,165 cases; one existing guard rejected the requested snapshot-command row. Its exception now permits only that exact row in the command table, and tests still reject runtime use or broader mentions. All 3 focused policy cases, typecheck, affected-file lint and documentation checks passed. CI remains the final merge gate.
