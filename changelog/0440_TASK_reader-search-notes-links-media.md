# Task 0440: SLN-503 — Reader search, notes, links and media

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-499, SLN-500, SLN-501, SLN-502
**Blocks**: SLN-504, SLN-509

## Overview

Adds cancellable book search, semantic note popovers, safe links, and image/table
viewing to the reader. This source checkpoint incorporates accepted SLN-499
navigation. Accepted SLN-500/501 integration and the concrete SLN-502 PDF binding
remain gates; the ticket is not complete or deployed.

## Implementation Details

- Search folds Unicode text while preserving original UTF-16 offsets, including
  compatibility casing, accents, whitespace and cross-node ranges. Whole-word
  matching uses word-like Intl.Segmenter boundaries. A worker yields between
  bounded batches, applies backpressure, caps matches at 5,000 and owns cancellation.
- Sections are acquired lazily through independent abortable ZIP/remote reads.
  Canceling search preserves renderer reads. The panel persists versioned options,
  groups results by book order, renders safe excerpts and supports registered
  keyboard shortcuts. Search decorations remain separate from history marks.
- The PDF search consumer follows the measured SLN-502 producer method shapes.
  Its provider is deliberately unbound until accepted canonical integration;
  PDF search currently reports that the provider is unavailable. PDF decoration
  and navigation integration remain pending.
- Semantic and bounded heuristic notes use pristine document caching, safe cloned
  content, owned image leases, nested references and anchored popovers. Opening a
  note preserves reading position; Go to note uses shared navigation provenance.
- External links allow only HTTP, HTTPS and mailto and open synchronously with
  noopener/noreferrer. Internal references pass the same resolved-link policy.
- Eligible images open a modal viewer with fit, zoom and pan. Wide tables retain
  CFI positions, support horizontal scrolling and expose a cloned table viewer.
  SVG and table content are sanitized; gesture ownership respects physical RTL
  edges and releases turns at table boundaries.
- Added a small public-domain EPUB covering notes, adversarial links, multilingual
  search, images and wide tables. A separate temporary corpus contains exactly
  1,500,000 original UTF-16 text characters across 60 sections. Disposable seed
  preparation uses the existing gold-key helper and performs no cloud/DB writes.
- Updated reader design, routes, fixture attribution and native/performance QA
  recipes. No new dependency, schema or migration is introduced.

Vendored note source and extraction patch are recorded in VENDORED.md:

- Repository: readest/foliate-js.
- Commit: `08db61054bd5bc21f244c6ad128f103b6427b03c`.
- Original footnotes.js Git blob: `00870d9d9f4a6e1bdd9a8d44f4e313f9f0aa461c`.
- Original SHA-256: `733fd1fab6e1fc752aa7159836997f3ce692816edd820f5b590fc10e8d2d0d40`.
- Retained MIT notice, copyright 2022 John Factotum. License Git blob:
  `5930571b73151702a913179ef5f96313ad7d25d3`; SHA-256:
  `b621ffc351fe263bc9b09dd0bc1c9332fda9c462a3904c1e4f0b4d3236b9c28c`.

## Validation and Remaining Gates

Before QUIET-494, 124/124 focused tests passed across 13 suites, with zero skipped
or todo. These cover folding and offsets, strict links, note sanitization and
lifecycle, worker cancellation/backpressure, acquisition ownership, result caps,
PDF producer-consumer boundaries, panel rendering/navigation, media policies,
table CFI invariance, vendored search parity and reader input. Typecheck, scoped
ESLint, vendor syntax and whitespace checks passed. The final CapAligned wrapper
and existing theme-token substitutions have not been rechecked on this checkpoint.

Tests found and corrected progress publication after cancellation. Compatibility
uppercase folding was also independently corrected by normalizing with NFKC before
locale casing, while retaining original grapheme offsets. DOM/protocol unit tests
are not evidence of native touch, browser layout or measured performance.

QUIET-494 remains in force: no tests, typecheck, lint, build, font processing,
browser, Docker or stress jobs are active. Only source work and commits proceed.
Accepted PDF/annotation/preferences integration, independent source review,
headless Chromium/Firefox/WebKit trusted input, all performance and visual audits,
default Mac/Docker builds, zero-skip full DB suite, CI, main merge and deployment
remain required. No heavy/native job or live seed write is claimed by this checkpoint.
