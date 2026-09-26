# Task 0131: Complete shared pagination on publisher detail and review

**Status**: Completed
**Created**: 2026-09-26
**Priority**: HIGH
**Type**: Fix
**Linear**: SLN-313

## Overview

The publisher catalogue and unmatched-name review queue still used their original Previous/Next links after the shared pagination rollout. Both now use the same page size, jump, count, keyboard and navigation controls as the other lists.

## Implementation Details

- Shared input parsing bounds offsets before queries and redirects out-of-range pages to the last page.
- Publisher filter changes reset the page while preserving page size and other query parameters.
- Catalogue pagination still counts works and includes every matching edition of each work; review pagination counts editions. Stable ordering remains in the database queries.
- Action defaults remain 24 for existing callers; pages explicitly pass the shared page size.
- A PostgreSQL regression test covers 49 identically titled works, 48/1 page boundaries, unique coverage, malformed page input, and the review queue.
- No schema changes or live mutations.
