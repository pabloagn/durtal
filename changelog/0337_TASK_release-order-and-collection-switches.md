# Task 0337: Release order and collection switches in the docs

**Status**: Completed
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Infrastructure
**Depends On**: 0267 (SLN-382 release gates)
**Blocks**: None

## Overview

SLN-382 asked for the ordered deployment, the domain readiness flags and the
recovery build to be documented, and for the architecture and configuration
docs to follow. Task 0267 documented backups, the recovery build and the
rollback drill in `docs/11_DEPLOYMENT.md`. The order of a release and the
collection switches were still written nowhere, and the deployment doc still
opened on a homelab that does not run Durtal.

## Implementation Details

- `docs/11_DEPLOYMENT.md`: the opening says where Durtal runs (`next dev`
  on :3100 from the main checkout, live Neon and S3) and that the Docker
  image is CI's proof of the Dockerfile. New section "Release order": merge
  on green CI, update the main checkout, back up, rehearse on the backup,
  check the journal's `when` against live, migrate from main only, data
  steps with their dry runs, serve (fresh Turbopack cache, health), verify;
  and how a collection opens (switch plus activation migration).
- `docs/01_ARCHITECTURE.md`: "Collections Open by Switch": `WORK_DOMAINS`,
  `getEnabledWorkKinds()`, `canUseWorkCapability()` and the database check
  `works_kind_enabled_check` with its activation migrations.
- `docs/13_CONFIGURATION.md`: `src/lib/catalogue/domains.ts` as a config file.

## Completion Notes

- Docs only. The rest of SLN-382 (rehearsal, recovery build, rollback drill,
  backup checks) is on main from task 0267.
