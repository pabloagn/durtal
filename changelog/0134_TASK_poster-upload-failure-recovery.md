# Task 0134: Poster upload failure recovery

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-321: The user reported intermittent drag-to-poster upload failures followed by successful retries. Local development logs contain two `Failed to parse body as FormData` errors (19:33:45.007 and 19:36:19.661). These occur before image processing, S3 or database writes. The origin of the malformed request is not established by the available logs.

## Implementation Details

- Classify request-body parsing failures with an explicit HTTP 400 code, useful error text, and a request ID. Log content length and abort state without image contents, URLs or credentials.
- Retry once, rebuilding multipart FormData, only when the server confirms this pre-write failure. Never automatically retry network errors or generic HTTP failures where an image may already have been saved.
- Display server errors instead of hiding them behind “Failed”; replace fabricated progress percentages with an honest uploading/processing status.
- Track simultaneous uploads by UUID rather than a captured array index. Reset the file input so choosing the same file again works, and keep current monochrome parameters in callback dependencies.
- Image processing, active-poster selection and author monochrome behavior remain unchanged. No database migration.

## Completion Notes

Nine tests cover the pre-write route boundary, bounded retry, fresh multipart bodies, useful error propagation, non-JSON errors, and no retry for ambiguous failures. Full suite, typecheck and lint pass alongside task 0133. Existing live book data was not mutated. This is recovery and diagnostic hardening; it does not claim to have reproduced the original intermittent browser transport fault.
