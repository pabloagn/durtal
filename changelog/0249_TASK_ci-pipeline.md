# Task 0249: CI Pipeline (SLN-249)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: 0214 (SLN-276, the production build reads no secrets)
**Blocks**: None

## Overview
Add a GitHub Actions workflow that checks every pull request, every push to
`main` and every `v*` tag: lint, typecheck, the full test suite with the
database suites, and a Docker image build.

## Implementation Details
- `.github/workflows/ci.yml`, three jobs:
  - `lint`: `pnpm lint` and `pnpm typecheck` on Node 22.
  - `test`: `pnpm test:local` (`scripts/qa/test-local.py`). It runs the
    Python book import tests and every Vitest suite, including the database
    suites, against a disposable `postgres:16` container. The job pulls the
    image first, because the script never pulls. Reports upload as the
    `test-reports` artifact.
  - `docker`: builds the image with Buildx after `lint` and `test` pass.
- The workflow needs no secrets.
- `docs/11_DEPLOYMENT.md`: the CI/CD section now describes this workflow.

## Completion Notes
The issue asked for a push to a self-hosted registry over Tailscale. Durtal
runs only on the owner's Mac, so there is no registry or host. The image is
built but not pushed, and no Tailscale or registry secrets exist. A push step
(for example to GHCR) can be added when a remote host exists.

`pnpm test` alone skips the database suites (SLN-434). CI runs
`pnpm test:local` instead, so CI runs them.

Checked locally on the worktree off `main` (c9f6359): lint and typecheck
passed; `pnpm test:local` passed 1488 of 1488 tests in 108 files, 0 skipped;
`docker build .` succeeded with no secrets; `act -l` parses the workflow into
the three jobs.
