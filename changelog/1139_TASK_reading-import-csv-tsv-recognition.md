# Task 1139: Reading import CSV and TSV recognition

**Status**: In Progress
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: SLN-1082
**Blocks**: SLN-894

## Overview

SLN-1090 Phase 1 accepts reading-history CSV and TSV and identifies the app’s eight table exports truthfully. Session/note writing and restoration remain a later phase.

## Implementation Details

Shared header declarations move to the pure export columns module; schema exports retain their existing names and values. Header-based detection identifies catalogue, session and note files without labelling them foreign exports or promising an unavailable restore path.

The delimited reader handles BOM, quoted delimiters/newlines, doubled quotes and CRLF/LF. Malformed quotes, duplicate/empty headers and excess cells are refused. Upload controls accept CSV/TSV and retain the existing size, origin and empty-file checks. Raw-file storage uses the detected delimiter’s MIME type.

Raw parsing preserves apostrophes. Recognized Durtal reading files keep legacy formula-guard decoding; third-party files do not have authored apostrophes stripped. The legacy Durtal escape ambiguity requires a later versioned fidelity change.

## Completion Notes

Root and independent PM source review passed. Typecheck and all 149 tests across ten complete focused unit/API files passed; independent cleanup confirmed no remaining owned processes or resources and unchanged source/protected inputs. UI alignment/page-weight checks, the full test:local gate, and Phase 2 session/note restoration remain pending. SLN-1369 separately owns lossless TSV export fidelity. SLN-1090 remains In Progress. No store, claim, identifier, database schema, package or session/note writer changes.
