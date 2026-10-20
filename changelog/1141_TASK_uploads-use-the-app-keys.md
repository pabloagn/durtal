# Task 1141: Uploads use the app's own AWS keys

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The e-book upload service accepted only the `durtal-personal` SSO sign-in. That sign-in expires, and uploads then stopped until a person ran `aws sso login --profile durtal-personal`. The app itself, and covers, already read S3 with the app's own IAM keys, which never expire.

## Implementation Details

- `scripts/ebooks/environment.ts`: `loadEnvironment` takes `appCredentials`. It keeps the app's IAM keys from the env file and skips the personal sign-in. It refuses `--aws-profile` with it, and a missing key.
- `scripts/ebooks/upload-service.ts`: `init` and `start` take `--app-credentials`. With no personal session, `src/lib/ebooks/storage.ts` uses the app's IAM client, as the app does.
- `scripts/deploy/upload_agent.py`: the launchd agent starts the service with `--app-credentials`, so it no longer needs the `aws` executable or a profile.
- `docs/11_DEPLOYMENT.md`: the upload commands and the sign-in note.

Other e-book commands (ingest, match, storage setup) still take `--aws-profile durtal-personal`.

## Completion Notes

The upload agent tests pass (`python3 -m unittest scripts/qa/test_upload_agent.py`, with `TMPDIR` outside `/tmp`). The upload service runs with `--app-credentials` on the Mac.
