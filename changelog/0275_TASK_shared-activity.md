# Task 0275: Activity, Comments and Cleanup for Every Kind of Record (SLN-372)

**Status**: In Progress
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
