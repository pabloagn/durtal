# Task 0961: Keep the upload service running, and say when it needs a sign-in

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1326. The e-book upload service went down on 19 Oct when its AWS SSO session expired, and nothing started it again: docs/11 pointed at "the same supervisor loop" as the server, which never existed for it. The app said only "The upload service is not running", which does not tell anyone what to do.

## Implementation Details

- `scripts/deploy/upload_agent.py` (new): `plan` writes the launchd agent `com.durtal.ebook-upload`. It runs `scripts/ebooks/upload-service.ts start` from a checkout under the pinned Node (so launchd's SIGTERM reaches the service), `KeepAlive {SuccessfulExit: false}`, `ThrottleInterval` 60, `ExitTimeOut` 300, umask 077, a private log. It writes 0600 and never over an existing file, and installs nothing. It refuses `/tmp` and `/private/tmp`, a state folder without a private `service.json`, a checkout without `node_modules/tsx` or `.env.local`, and relative or writable tools.
- `scripts/ebooks/personal-session.ts`: an AWS CLI failure whose message says the SSO token or session expired throws `AwsSignInNeeded`, on the first export and on a refresh.
- `scripts/ebooks/upload-service.ts`: when start or a refresh fails for that reason, the service writes `status.json` beside its socket and exits 78, so launchd restarts it; it clears the file once it is ready.
- `src/lib/ebooks/upload/service-status.ts` (new): writes the file atomically (0600) and reads it only when it is a small regular file owned by this user and private to them.
- `host-bridge.ts`: a down service with that note answers 503 `upload_sign_in_needed`, "Uploads need the Mac to sign in to AWS again." The upload page shows the same sentence before a file is chosen.
- docs/11, Browser uploads: the agent, how to install, restart, check and stop it, and the sign-in recovery.

## Completion Notes

- Tests: `scripts/qa/test_upload_agent.py` (5), `src/__tests__/ebooks/upload-sign-in.test.ts` (4, real files and socket), a sign-in case in `personal-session.test.ts`, a notice case in `upload-workbench.test.ts`.
- Not done here: installing the agent on the Mac, and choosing credentials that do not expire every few hours. Both need Joris on the Mac.
