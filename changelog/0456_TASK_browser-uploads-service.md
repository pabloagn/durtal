# Task 0456: Switch on browser uploads

**Status**: Completed
**Created**: 2026-10-12
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0451
**Blocks**: SLN-506 acceptance

## Overview

SLN-506: `/ebooks/upload` and its routes were built, but nothing installed the upload broker, so every upload call answered 503. This adds the command that runs the owned upload service and the app startup that connects to it.

## Implementation Details

- `scripts/ebooks/upload-service.ts` (`pnpm ebooks:upload-service`): `build-inspector` builds `infra/ebooks/inspector` at the current commit with a source label; `init` writes the private `service.json` and `bridge.json` (mode 0600, folder 0700, never overwritten; a rerun only moves the service to a new inspector image); `start` composes `OwnedUploadService` through `composeActualUploadService` and runs it until SIGINT/SIGTERM, exiting non-zero on failure for a supervisor loop. It uses the e-book commands' environment (`--aws-profile` or `--preview PORT`) and refuses a config made for another database.
- `src/lib/ebooks/upload/service-config.ts`: the two files' schemas, the configuration (binding from `supervisorBindingSha256`, build evidence pinned by digest and revision) and a private-file reader (absolute, no symlink, owner only).
- `src/instrumentation.ts`: with `EBOOK_UPLOAD_BRIDGE`, the app installs the authenticated socket client at startup (`installUploadAppBridgeFromFile`). A bad bridge logs one error and leaves uploads off; the app still starts.
- The upload routes map errors by a brand (`isUploadError`, `isUploadAdmissionRefusal`), not only `instanceof`: the client installed at startup comes from the instrumentation bundle, whose copies of the error classes failed `instanceof` in the route bundle, so a 404, a 409 refusal or "not running" all came back as a 503 uncertain outcome.
- `UploadHostClient`: a missing socket or a refused connection (nothing sent) answers 503 `upload_unavailable` "The upload service is not running", not the uncertain-outcome error.
- `EBOOK_UPLOAD_BRIDGE` in `src/lib/env.ts`, `.env.example`, `docs/13_CONFIGURATION.md`, and the Mac standalone runtime config's public settings (`scripts/deploy/mac_release.py`, path only). `scripts/qa/preview-local.py --upload-service DIR` runs a service bound to the preview's database. `docs/11_DEPLOYMENT.md`, Browser uploads, describes setup and operation.

## Completion Notes

- Tests: `upload-service-config.test.ts`, `upload-core/app-bridge.test.ts` (install from file, other database refused), `upload-host-bridge.test.ts` (service not running), `scripts/qa/test_mac_release.py` (bridge path only).
- Cloud checks, on the production build with a disposable preview: a server with `EBOOK_UPLOAD_BRIDGE` installed the client at startup and reached a real `UploadHostBridge` on a real private socket (batch read, `ready: true`); with the socket gone it answered 503 "The upload service is not running"; without the variable, 503 "not available yet"; a bridge for another database logged one line and the app served normally. As a non-root user, `init --preview` wrote both files (0600, folders 0700) and a rerun kept them; `start --preview` composed the service, opened the spool, took the host lock and stopped at Docker's preflight with exit 1.
- Not checked here: the inspector cannot be built in the cloud (apk is blocked) and this Docker runs cgroup v1, which the preflight refuses by design. The end-to-end upload runs on the Mac (Docker Desktop with the containerd image store).
- Review: the file input on `/ebooks/upload` was 20 px tall on touch; it is now at least 44 px (`pointer-coarse:min-h-11`). The browser audit passes on the page in Chrome, Firefox and WebKit at 1440/768/390.
- No migration, no new package. The first `start` against a database writes the volume's row in `ebook_upload_capacity`.
