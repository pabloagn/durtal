# Task 0095: CI/CD Pipeline

**Status**: Deferred
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: None

## Overview
Create a GitHub Actions workflow for automated lint, typecheck, Docker image build, and push to the self-hosted registry on every push to `main` or version tag. Uses Tailscale GitHub Action (Option A from deployment spec) to join the mesh network and reach the internal registry.

## Implementation Details
- Workflow: `.github/workflows/build-and-push.yml`
- Two-job pipeline: lint (ESLint + TypeScript) then build-and-push (Docker build + registry push)
- Image tags: `latest`, short git SHA, semver version (on tag pushes)
- Required secrets: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `REGISTRY_HOST`, `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`
- Spec: `docs/11_DEPLOYMENT.md`

## Completion Notes
Deferred. Vitest is also not yet configured; add a test job when a test framework is set up.
