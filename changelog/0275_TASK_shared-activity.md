# Task 0275: Activity, Comments and Cleanup for Every Kind of Record (SLN-372)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-297 (activity accuracy), 0202 (perfumes), 0213 (films), paintings, SLN-351 (venues)
**Blocks**: SLN-379

## Overview
History and comments covered books and authors only. Films, perfumes and
paintings recorded nothing and showed no history; a comment could be posted
for an id that did not exist; organizations and venues had no comments, and
their merges and deletes knew nothing of them. Now every kind of record has
a typed place in the history, its edits are recorded as readable
differences, and merges and deletes carry or clear its comments and files.

## Implementation Details

**Registry** (`src/lib/activity/entities.ts`): `ACTIVITY_ENTITY_TYPES`
(work, author, organization, venue) with their tables and merge names. Older
rows keep "work" and "author".

**Resolution** (`src/lib/activity/owners.ts`): `ownerExists(type, id)` and
`resolveEntity(type, id)`: the record as it is now, its name and its page (a
work by its collection, a person's author page, a publisher page, a venue
page; null for an organization outside publishing until it has a page),
following `harmonization_redirects` for a merged id (`mergedFrom`), null once
deleted.

**Comments** (`/api/comments`): any registry type; a post for a record that
does not exist answers 404 and stores nothing; an unknown type answers 400;
the history entry takes the record's type (`organization.comment_added`).
`ActivityTimeline`, `CommentEditor` and `CommentItem` take any registry type.

**Differences** (`src/lib/activity/work-changes.ts`): `workSnapshot` reads a
work's title, credits (by role), organizations (by role) and classification
(custom taxonomy items and art movements) in one query; `recordWorkChanges`
records `work.title_changed`, `work.credit_added` / `_removed`,
`work.organization_added` / `_removed` and `work.classification_added` /
`_removed`. Used by `updateFilm`, `updatePerfume`, `updatePainting` and
`replaceTaxonomyAssignments`; the create services record `work.created`.
Containers record `work.bottle_added`, `work.bottle_updated` (with what
changed: status, amount left, condition, location, formulation) and
`work.bottle_removed`; `recordWhereabouts` records `work.location_recorded`
(from, to, custody, certainty). Entries are awaited after the commit and
never fail the edit. Each has a description in `event-config.ts`.

**Pages**: the film, perfume and painting pages end with their history and
comments. A `refreshKey` from each server render reloads the history after any
save that refreshes the page.

**Merges and deletes**: `referencesTo` lists comments, activity and gallery
layouts for `publishing_houses` (as `organization`) and `venues` (as
`venue`), so merges move them. `deleteOrganization` and `deleteVenue` remove
them in their transaction and pass the comment files to the S3 cleanup
(`ownedMediaObjects("organization")` and the new `venueObjects`); a failed S3
cleanup leaves the delete done and reports `cleanupPending`.

**Cache**: every page renders on request (`force-dynamic`), and the only
cached reads are reference lists (taxonomy, locations, recommenders,
settings), which their own mutations invalidate. A reverse view (a film
showing a renamed director) reads the change at once; a test pins it.

## Completion Notes
- Tests: `integration/shared-activity.test.ts` (database: each kind of record
  resolves to its page, a merged book resolves to the kept one with its
  comment, a missing record resolves to null; a comment on a missing record
  answers 404 and stores nothing, an unknown kind 400, organizations and
  venues take comments; a film edit records the new title, an added producer
  and an added genre, entries with one timestamp page without repeats or
  gaps, and a renamed director shows on the film at once; a bottle added,
  changed and removed and a painting moved from Paris to Tokyo read as
  sentences; an organization merge moves its comment and its delete clears
  comments, history and comment files, reporting a failed S3 cleanup as
  pending; a venue delete clears its comments and history).
  `venues-retailers.test.ts` now expects the venue's comment-file folder in
  its cleanup.
- Checks: `pnpm typecheck` clean; `pnpm lint` has no errors and no new
  warnings; `python3 scripts/qa/test-local.py` passed 130 of 131 files, the
  one failure being that venue expectation, then the affected suites pass
  (39 tests).
- Browser on `preview-local.py --from-dump` of the 2026-10-04 11:37 backup
  with seeded films, perfumes and a painting: edited a film's title from its
  menu; the Activity part showed "Changed title from ... to ..." as soon as
  the dialog closed, at 1440 and 390px. The perfume and painting pages end
  with Activity and the comment box. Alignment and design audits: no
  finding.
- Limits: an organization outside publishing resolves with no page until the
  organization pages (SLN-369) land; organization and venue pages do not show
  a history yet (their comments and history are stored, merged and cleaned).
