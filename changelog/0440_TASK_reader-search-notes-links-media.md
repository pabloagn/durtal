# Task 0440: SLN-503 — Reader search, notes, links and media

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-499, SLN-500, SLN-501, SLN-502
**Blocks**: SLN-504, SLN-509

## Overview

Full ticket scope: cancellable indexed search across text formats and text PDFs,
semantic footnotes, safe links, and zoomable image/table viewing. Source is gated
on accepted upstream contracts. This checkpoint contains only the pure policies
explicitly authorized by the coordinator; it does not expose reader controls.

## Implementation Details

- Search folding keeps original UTF-16 boundaries through Unicode decomposition,
  locale casing, expansions, whitespace and formatting characters. A lazy match
  iterator bounds results to 5,000; a separate text-node offset index maps ranges
  across markup. Whole-word checks use word-like Intl.Segmenter boundaries.
- Link policy permits only HTTP, HTTPS and mailto externally. Book-relative
  references remain internal and must pass the same policy after resolution.
- Note sanitization clones allowed literary/table content, removes active content
  and backlinks, revalidates hrefs and requires caller-owned image blob leases.
- Table gesture policy uses physical scroll distance and the swipe direction,
  including normalized RTL offsets and fractional/elastic edges.
- No schema, dependency, API, worker runtime, engine/UI, or vendor modification.
  Acquisition cancellation will own only search reads, preserving renderer reads.

Pinned-source prerequisite verified read-only through GitHub MCP:

- Repository: readest/foliate-js.
- Commit: `08db61054bd5bc21f244c6ad128f103b6427b03c`.
- footnotes.js Git blob: `00870d9d9f4a6e1bdd9a8d44f4e313f9f0aa461c`.
- footnotes.js SHA-256: `733fd1fab6e1fc752aa7159836997f3ce692816edd820f5b590fc10e8d2d0d40`.
- MIT License, copyright 2022 John Factotum; license Git blob:
  `5930571b73151702a913179ef5f96313ad7d25d3`.
- License SHA-256: `b621ffc351fe263bc9b09dd0bc1c9332fda9c462a3904c1e4f0b4d3236b9c28c`.
- Recomputed both Git blob IDs from retrieved UTF-8 bytes; both match GitHub.
  No copied source is committed yet; retain the MIT notice when vendoring.

## Completion Notes

Pure-policy checkpoint: 59/59 tests passed, zero skipped or todo, across four
focused suites (22 search/offset, 21 link, 12 sanitizer and 4 table-policy tests).
Final focused run: 571 ms total; test bodies 31 ms. `pnpm typecheck` passed and
scoped ESLint passed with zero warnings. Existing installed dependencies were
reused without installing; the temporary dependency link was removed afterward.
These DOM tests verify sanitization rules; they are not native touch evidence.
The initial sanitizer fixture was corrected after happy-dom consumed following
markup while parsing its SVG script; the adversarial SVG is now constructed
explicitly, with an additional deep-nesting regression.

Incomplete. Worker cancellation, runtime wiring, vendor export extraction, complete
fixtures, browser/native trusted touch, performance rows, audits, default Mac and
Docker builds, the zero-skip full DB suite, CI, main merge and deployment remain
required. No native or heavy job was authorized for this checkpoint.
