# Task 0156: Book Domain Isolation

**Status**: Completed locally; awaiting review and deployment
**Created**: 2026-09-30
**Priority**: HIGH
**Type**: Infrastructure
**Linear**: SLN-347 (parent SLN-345)
**Depends On**: SLN-346
**Blocks**: Shared entities and non-book activation

## Implementation Details

Legacy book queries now filter domain before counting, ordering and pagination.
This covers library lists/details, dashboard, timeline, matching, order/series
pickers, recommendation pages, taxonomy families/items, collection selections,
exports, slug backfills and harmonization scans. Global slug collision checks
remain global. Author sorting now selects the correct page from the entire
filtered book selection, with deterministic title/ID ties.

Book edits check identity before changing related records. Mixed-domain bulk
selections fail before any write. Edition creation/reparenting validates the
parent before processing covers. Book deletion cannot clean up another domain's
comments, images or activity. Book harmonization refuses executable merges
unless both records are books; kind is a protected merge field.

Migration 0034 adds database guards to editions, work authors, acquisition
targets, orders, Calibre links and book-status history. These relationships
remain book-only even for direct SQL/imports. The legacy series fields are
reserved for books. Existing FKs and cascades remain intact. Queries through
editions, instances and author links therefore inherit the same boundary,
including publisher views, edition collections, Calibre ISBN matching and TUI
requests through the existing book API. Media, taxonomy and recommendations
remain reusable across domains.

Python book ingestion uses explicit book identity and rejects slug conflicts
with other domains, including conflict retries. Series reconciliation is scoped
to books. No production database was touched; apply migrations through 0034
before deploying this application revision. Other domains remain disabled.

## Verification

The mixed-domain PostgreSQL suite exercises all four kinds together: paging and
counts, primary-author sorting, details/dashboard/timeline/pickers, shared
taxonomy/recommendation counts, exports, forged mutation targets, all-or-nothing
bulk rejection, direct SQL constraints and executable merge rejection. The
existing book suites remain enabled. Five Python regressions exercise import
identity reuse and collision handling without loading application config.

No frontend layout files changed. Existing uncommitted author-picker work is
preserved separately. See task 0157 for reproducible database verification and
the final test baseline.
