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

After the accepted SLN-454 receipt and owner preservation review, 184 catalogue
files moved into `(catalogue)`, preserving all 60 page URLs. The four added
fallback files remain at their global/reader locations. The owner UI test adds
one catalogue import to the original inventory: 27 references were adapted.
The reader root contains only the shared document foundation. Its dynamic page
loads the book, plugins and `ReaderRuntimeV1` in parallel. Persisted timer
settings and the running timer form a ready/unavailable envelope; failures
never become a default interval or a successful empty timer. The page seeds
only the home preference through the narrow provider, preserving `none`, and
passes the existing appearance cookie directly to its preference hook for SSR.

The reading-dialog facade imports its renderer only on invocation, shares an
in-flight import, snapshots caller fingerprints/notes/home/focus and fences
display loads and continuations by generation. Loading and failure use a native
modal with Close/Retry. A shared surface stack guards both catalogue shortcuts
and reader input, including book frames, and returns focus through one owner.
The palette and timer-alert renderers load when needed; the invoked palette
host remains mounted so catalogue creation dialogs can outlive the palette.

The seeded timer skips a redundant mount read. Focus/visibility reads coalesce,
and mutation generations prevent old reads from overwriting a saved timer.
Failed reads stay explicit, reject `refresh()` and disable unsafe changes;
confirmed disappearance alone produces the stopped-elsewhere message. A running
timer retains its real one-second display interval for later performance proof.

SLN-507 owns the worker, caches, OfflineStore and replay. SLN-509 supplies the
baked build identity. SLN-502 supplies PDF range/cancellation/canvas bounds.
This ticket introduces no schema, migration or dependency.

## Completion Notes

Source implementation is in progress. The six exact owner snapshots were
committed separately as `e2528b91` at `94140915` and normally merged as
`3ed87f30` before the route move. Their primary bytes/status remain unchanged;
the moved filters retain their bytes, and the owner UI test receives only the
reviewed mechanical import change. Author/committer is Pablo Aguirre.

All 125 tests in 13 focused owner/proxy/CSP, dialog/timer/input/status and new
provider-concurrency files passed with one worker and zero skips, using the
existing matching dependency tree. This is not full-suite or database evidence.
No install, build, typecheck, full suite, Docker, benchmark or native browser
check has run. The available installed Next type
declares `globalNotFound`, but actual default-build and HTTP-status validation
remain required. No current performance pass or completed deployment is
claimed. Tracker subscription readiness awaits root/SLN-493 review of an
explicit barrier proposal; the current plugin registry has no SLN-454 tracker.
SLN-502/507/509 integration and every acceptance gate remain outstanding.
The historical phone failures remain 2,527 ms for a cold 5 MB EPUB,
3,764 ms for a cold 300 MB PDF and 1,493 ms for ordinary reopen.
