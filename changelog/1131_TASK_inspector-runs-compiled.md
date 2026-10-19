# Task 1131: The e-book inspector runs as compiled JavaScript

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 1130
**Blocks**: None

## Overview

Uploads on live failed at the check. Replaying the service's own container on the Mac (Colima, cgroup v2), the worker stopped first with a Go panic, "failed to create new OS thread": `worker.mjs` loaded TypeScript through tsx, tsx started esbuild, and Node's threads plus esbuild's ran into `--pids-limit=16`. With that worked around, it stopped at "Cannot find package '@/lib'": the image copied only part of `src`, and `src/lib/env.ts` imports `@/lib/api/allowed-hosts`. Nothing said why, because the service dropped the worker's stderr.

## Implementation Details

- `infra/ebooks/inspector/build.mjs` (new) compiles `worker-entry.ts` and every source it reaches into `/inspector/inspector.mjs` while the image is built, with `@/` as `src` and ES2022 class fields, as tsx ran it before. Packages stay imports of the image's `node_modules`. It refuses to compile anything outside `src/lib`, the part the image copies and `build-inspector` checks is committed. It uses the esbuild that tsx already brings: no new package.
- `Dockerfile.inspector`: a `worker` stage copies `src/lib` and runs the build; the image gets `inspector.mjs` and the plain `worker.mjs`. The entrypoint is unchanged. `infra/ebooks/inspector/tsconfig.json` is gone.
- `worker.mjs` no longer registers tsx. It reads the environment's names first, then imports `inspector.mjs`, and `runInspectorWorker(inherited)` checks those names. libvips adds `VIPSHOME` when sharp loads, so a check made after loading refused every run with "Inspector inherited unexpected environment"; a `VIPSHOME` the container did inherit is still refused. A failure while loading still becomes the one bounded stderr line.
- `OwnedInspectorRuntime.execute` puts the container's state and exit, out of memory, the docker exit when it is not 0, and the first 512 characters of the worker's stderr into "Inspector did not complete successfully (exited, exit 1): ...", which the service logs (`inspectorFailureDetail`). Control, format and bidi characters are dropped from it.
- `build-inspector` refuses uncommitted changes anywhere in `src/lib` now, since the image compiles from it.
- New `src/__tests__/ebooks/upload-inspector-image.test.ts` runs the built image with `inspectorCreateArguments` on an EPUB, a PDF and a comic. It runs only where `DURTAL_INSPECTOR_IMAGE` names a pinned image, as the upload service's user.

## Completion Notes

In the cloud container (Docker with cgroup v1, `apk` blocked) the image was built on node:22-alpine with musl dependencies installed the same way, and the worker run with the service's exact create arguments. Before: no report. After: past the thread limit, the alias and the environment check (the third blocker, found here); with the cgroup v1 values faked for that local run only (the cloud has no `memory.max`), the EPUB, PDF and comic fixtures each give a report and exit 0. The Mac should rebuild the image and run the new test against it.
