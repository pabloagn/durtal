# Task 0959: Release tooling: a general live migration, a switch that rolls back, a launcher that checks the schema

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: The next deploy

## Overview

Nothing in the repository could migrate the live database for the next release. The SLN-646 adapter that reached Neon on 14 Oct was pinned to that one batch: 89 journal entries, 81 ledger rows before and 88 after, one commit and one worktree path. A failed start left the app down until someone loaded the old plist by hand, and the launcher never checked that the database had the build's migrations. Source: findings/release-path.md, items 2, 3, 5 and 9. Fixes SLN-1318, SLN-1319 and SLN-1320.

## Implementation Details

- `scripts/deploy/live_migrate.py` (new, SLN-1318). Four commands, each writing a private receipt in a new folder under `--receipts`:
  - `backup`: a pg_dump 16 custom-format dump of the live database, through Docker `postgres:16` over libpq with TLS and channel binding. It refuses an empty file or one that is not a custom-format dump, and records the ledger it read.
  - `rehearse`: restores that dump into a throwaway local `postgres:16` container (no published port), checks the restored ledger is the one the backup read, applies the pending migrations, reads the ledger back and records the row counts that changed. It makes no live connection, and the container is removed and checked.
  - `migrate`: applies the journal entries the live ledger lacks, in order and in one transaction, the way Drizzle writes them: each migration's statements, then its ledger row. Its gates:
    - A rehearsal of this build's journal that passed.
    - Its backup under an hour old, of the same database, with the dump unchanged.
    - The live ledger exactly as the backup read it, and the same pending list as rehearsed.
    - The runtime config's release has the same commit and migrations as the preparation.
  - Inside the transaction:
    - `lock_timeout` 10 s and `statement_timeout` 120 s.
    - An exclusive lock on the ledger.
    - A check, before and after, that the ledger holds the expected count and last hash.
  - After it, `migrate` reads the ledger back. On a failure it reads the ledger once to record whether the transaction rolled back or committed with its acknowledgement lost, and never retries. It writes the `live-migrations.json` evidence that `transition-plan` takes.
  - `status`: the live ledger against the release's journal.
  - Pending follows Drizzle's own rule: every entry newer than the ledger's newest `created_at`. The newest row must be one of the journal's entries with the same hash. Older rows are not compared, since the live ledger does not line up one to one with the journal (the SLN-646 adapter pinned 81 rows for its first 82 entries).
  - A migration with a psql metacommand line or its own transaction control is refused.
  - The live URL comes from the packaged, reviewed helper exactly as the launcher reads it. Database messages go to a redacted private log, never the terminal.
  - Dumps, receipts and the switch's plists are refused under `/tmp` and `/private/tmp`, which macOS empties.
- `scripts/deploy/mac_release.py`:
  - `migration_state(entries, latest)`: the shared pending rule.
  - `package` now packages `live_migrate.py` with the other deploy tools.
  - `switch` (SLN-1319): re-verifies both plans (plist, config hash, release), and requires the current release to be the one serving. Then it boots out the job, waits for the port to free, bootstraps the target, and waits up to 180 s until a healthy Durtal answers from a listener whose working directory is the target release.
  - If the target is not serving in time, `switch` boots it out and bootstraps the previous plan again. It writes a receipt: `SWITCHED`, `ROLLED_BACK`, `ROLLBACK_FAILED` (naming the plist to load by hand) or `OLD_RELEASE_DID_NOT_STOP`.
- `scripts/deploy/runtime_launcher.py` (SLN-1320): before the first spawn, `require_migrated` reads the ledger's newest row and refuses to start when the database lacks any of the release's migrations, logging which.
  - It reads the way the app does: one read-only batch to Neon's HTTP SQL endpoint, the request `@neondatabase/serverless` 1.0.2 sends (checked against the installed driver's code).
  - A database ahead of the release starts, as a rollback over additive migrations.
  - A failed read refuses the start too. Crash restarts do not re-read.
- `scripts/deploy/sln646/` is removed: the general adapter replaces it.
- Tests:
  - `scripts/qa/test_live_migrate.py`, pure:
    - the pending rule;
    - the transaction script;
    - the journal refusals;
    - TLS and channel binding;
    - volatile folders and empty dumps;
    - every `migrate` gate;
    - the failure read-back and nothing-pending.
  - `scripts/qa/test_live_migrate.py`, on real throwaway `postgres:16` databases (skipped without Docker and the image):
    - A database migrated by Drizzle's own migrator to two entries short is backed up, rehearsed and migrated. It ends with the same ledger and the same `pg_dump --schema-only` as a database Drizzle migrated in full.
    - A ledger that moved after the backup is refused.
    - A failing migration leaves neither its ledger rows nor its first statement's table.
    - A rehearsal of a failing migration writes no receipt.
    - An empty dump never rehearses.
  - `scripts/qa/test_mac_release.py`:
    - the launcher's Neon request;
    - behind, ahead and failed reads;
    - no spawn when behind;
    - the switch's four outcomes;
    - the switch's refusals.

## Completion Notes

`python3 scripts/qa/test_live_migrate.py`: 13 tests, including the four database tests, in about 42 s. `python3 scripts/qa/test_mac_release.py`: 55 tests. Changing the ledger row the adapter writes makes the database test fail. Nothing ran against the live app, the live database or the Mac.

Still open on the Mac:
- Moving the live release, rollback plist and receipts out of `/private/tmp` (SLN-1317). Until then, `switch` refuses the current plist if it is there.
- Whether `~/Library/LaunchAgents` holds a copy of the plist for reboots. `switch` loads the plists from where they are, as the manual step did.
- docs/11's release order (SLN-1227).
