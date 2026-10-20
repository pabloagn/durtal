# Task 1135: Collections are always open

**Status**: Completed
**Created**: 2026-10-20
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-1229 (dead code survey), the collection switch. Every collection in
`WORK_DOMAINS` carried `enabled: true`, and a gate read it in a dozen places:
three route layouts (`films`, `paintings`, `perfumes`) that returned a 404 for
a closed collection, `getEnabledWorkKinds()`, the export route and format, the
collection pickers, quick search, the taxonomy family list, statistics and the
dashboard. The switch is on for every collection,
and turning one off now would hide records that exist, so it goes.

## Implementation Details

- `src/lib/catalogue/domains.ts`: `enabled` removed from every domain and from
  its type; `getEnabledWorkKinds()` removed. Callers read `DOMAIN_ORDER`.
- `src/lib/catalogue/domain-gate.ts` and the three collection `layout.tsx`
  files removed: they only ran the gate.
- Export (`api/export/route.ts`, `interchange/export.ts`, `interchange/format.ts`)
  no longer refuses a collection as "not open"; a selection without domains
  exports every kind in `WORK_KINDS`.
- `actions/collections.ts`: the kind filters on adding to a collection and on
  its search go; the record's own id decides.
- Quick search, taxonomy families and browse, work relations, organization
  directory, similar ranking, counts, navigation, shortcuts, the dashboard and
  the empty catalogue read `DOMAIN_ORDER`, or no kind list at all where one
  only filtered: quick search no longer passes a kind list to each group (its
  work groups still sort in `DOMAIN_ORDER`), and similar ranking and
  `catalogueIsEmpty` drop a `kind in (...)` that every row matched.
- `/settings/about` no longer lists which collections are open.
- Tests that toggled or mocked the switch now assert every collection is
  listed (taxonomy families, empty dashboard links, curation capabilities).
- Docs 01, 02, 04, 05, 11, 13 and 14 no longer describe the switch (docs/01's
  section is now "Collections", and the export API lists no "not open" 404); docs/11's
  "Rolling back a collection" says collections are permanent and that a build
  from before this change still has the switch.

## Completion Notes

This covers the `enabled` flag only. The rest of SLN-1229 (unused exports,
test-only files and actions, the media route's `workId`, storage keys, and the
storage migrations held for a deploy) stays on the ticket.

Checks: typecheck clean; lint shows no new warnings in the changed files; the
753 suites without a database pass; the build passes, the browser audit
(alignment, design, overflow) passes 72 of 72 page loads on /, /perfumes, /films,
/paintings, /taxonomy, /settings/data, /settings/about and /organizations in
three browsers, and page weight is within budget. The container's disk is full, so the
database suites (taxonomy applicability, work kind migration, collections) ran
in CI's "Tests (with database suites)" rather than locally.

Self-review (code-review, high) found stale docs and comments that still
described the switch, filters and guards that could no longer fail (an empty
kind list in export, the empty catalogue and `collectableNouns`), and leftover
parentheses on the organization page; all fixed in this PR.
