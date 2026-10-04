# Task 0267: Release Gates, Recovery Build and Rollback Drill

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: 0222, 0224 (collections opened), 0266
**Blocks**: None

## Overview

SLN-382 with the gates SLN-379, SLN-380 and SLN-381. Perfumes, films and paintings went live together (migrations 0053–0055) before the release gates ran. The live backup (`live-before-0053-0056-20261004-113735.dump`), the rehearsal and the row-count check were done then. Still missing: an S3 backup check, a compatible recovery build, a rollback drill and a report on the remaining enrichment limits. This task runs them, against disposable restores only, never live.

## Implementation Details

- `scripts/qa/preview-local.py --start` serves the production build instead of `next dev`, as the Docker image serves it: the standalone `server.js` with `.next/static` and `public` beside it. It refuses to start without a build. The data cache of the standalone build is cleared like the dev one.
- `docs/11_DEPLOYMENT.md`, new section "Backups, Recovery and Rollback": how a database backup is taken and verified, the S3 findings, how to check a build against a backup, and how to close a collection again without losing its rows.

## Completion Notes

### SLN-382: recovery

- **Production build:** `pnpm build` on main 726fb3b, with no secret in the environment: passes.
- **Recovery build:** main with `enabled: false` for perfume, film and painting (`src/lib/catalogue/domains.ts`), migrations kept. Typecheck and build pass.
- **Rollback drill** (`--start`, disposable restores):
  1. Main's build on `live-before-0053-0056-20261004-113735.dump`: 0053–0056 applied, 108 tables, 21,297 rows, 0 tables with changed rows. Added a perfume, a film and a painting through their forms; dumped that database.
  2. Recovery build on that dump: strict restore (`--exit-on-error`), 0 tables with changed rows, every table's row count identical to step 1 (works: 673 books, 1 perfume, 1 film, 1 painting). `/`, `/library`, `/authors`, `/collections`, `/series`, `/publishers`, `/taxonomy`, `/settings/about`: 200. Every collection page, list and detail: 404. No link to a collection on the dashboard. `/library?q=` finds none of the three records.
  3. Main's build on the same dump: the three detail pages answer 200 and name their record.
- **Database backup verification:** the drill's restores are strict restores of a live backup and of a dump of a migrated copy; both succeeded.
- **S3:** every key the newest backup names (3,274) exists in the bucket (3,374 objects, 468 MB; 100 objects are named by no row of that backup). The app's IAM user is refused `GetBucketVersioning`, `GetBucketReplication` and `GetBucketLifecycleConfiguration`, so whether the bucket keeps deleted or overwritten files is unknown. A read-only copy of the whole bucket is now in `~/personal/durtal-backups/s3-20261004/` with `MANIFEST.json`: all 3,374 objects copied, every size and MD5 equal to the bucket's ETag, and all 3,274 keys the backup names present. No object was written to the bucket.

### SLN-379: workflows

- `python3 scripts/qa/test-local.py` on main plus task 0266: 1,614 tests across 131 files, 0 skipped.
- In the browser on a disposable restore of the newest backup (next dev and the production build): each collection created a record through its form (with a new house, director or painter), took a favourite, filtered by favourites and by its maker, and opened its detail page; perfumes and films send an out-of-range page to the last page (paintings since task 0266).
- Not covered: automated browser journeys; collecting and exporting the new kinds (export leaves them out, SLN-375); the legacy book flows were checked by the suites, not in the browser, in this pass.

### SLN-380: layouts and accessibility

- `alignment-audit.js` and `design-audit.js` on 12 collection pages (three homes, three favourite lists, three details, three add pages) at 1440 and 390 px, and on the painting pages at 768 px: 0 deviations over 0.5 px, 0 low-contrast texts, 0 unnamed or nested controls, no horizontal scroll, no console errors.
- Not covered: keyboard paths, dialog focus return, reduced motion and touch.

### SLN-381: performance

- `node scripts/qa/page-weight.js` on a restore of the newest backup: 9 of 10 routes within budget; `/library` is 313 of 300 KB.
- Not covered: collection queries at a large seeded catalogue; query plans.

### Remaining enrichment limits

- **No lookup for the new kinds.** Perfumes, films and paintings are entered by hand: no film metadata lookup (SLN-376), no perfume source-assisted entry (SLN-377), no museum enrichment or location verification from a museum source (SLN-378).
- **No export or import** of the new kinds (SLN-375).
- **Harmonization** does not yet respect domain identity (SLN-373).
- **Acquisition targets** (orders) exist for books only (SLN-374).
- **Taxonomy pages** count and list book links only; perfume notes and formulation classification are not counted there (task 0222).
- **Pictures** of the new kinds go through the shared media manager (S3); there is no automatic image source.
