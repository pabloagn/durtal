# Task 0447: Reader layout and phone performance

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: SLN-493, SLN-502, SLN-507, SLN-509
**Blocks**: SLN-509 final acceptance

## Overview

SLN-553 removes catalogue layout dependencies from the reader's first paint
and integrates the offline worker's asset reuse. The existing performance
budgets remain unchanged, including an ordinary second open without an
explicit download within 400 ms.

## Implementation Details

The first isolated source checkpoint extracts the existing Cirka, Inter and
JetBrains Mono declarations into `src/styles/root-fonts.ts`. The existing
catalogue root uses the same declarations; a data-independent `MinimalRoot`
uses them for reader/offline documents and global fallbacks.

The explicit `global-not-found` document is enabled through Next's
`globalNotFound` option. It and `global-error` can render without catalogue
settings, database or image-adjustment queries. Reader segment fallback
boundaries retain user-invoked retry and safe library links. All fallbacks use
the existing theme and shared fonts, with no automatic retry or disclosure
of privileged server error details.

The reviewed route inventory at `626f4870` contains 184 catalogue move
candidates and 58 retained files. Only 26 of 103 app module references need
rewriting. The catalogue route move and provider split are still pending:
the owner-edited library filters require a separately reviewed preservation
commit, and SLN-454 must accept the actual-settings bootstrap and pending
dialog/focus/generation contracts before provider changes.

SLN-507 owns the worker, caches, OfflineStore and replay. SLN-509 supplies the
baked build identity. SLN-502 supplies PDF range/cancellation/canvas bounds.
This ticket introduces no schema, migration or dependency.

## Completion Notes

Preparation only. The six owner files were captured and hashed into a
read-only preservation proposal; the patch passes `git apply --check` against
the managed checkout at `94140915`. The primary checkout and manual server
remain untouched, and none of those owner changes has been incorporated.

No installs, build, typecheck, full suite, Docker, benchmark or native browser
check has run for this source checkpoint. The available installed Next type
declares `globalNotFound`, but actual default-build and HTTP-status validation
remain required. No current performance pass or completed deployment is
claimed. The historical phone failures remain 2,527 ms for a cold 5 MB EPUB,
3,764 ms for a cold 300 MB PDF and 1,493 ms for ordinary reopen.
