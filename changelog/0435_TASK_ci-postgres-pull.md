# Task 0435: CI PostgreSQL pull companion to SLN-509

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: Independent CI source review
**Blocks**: Re-running the full CI gate for the combined release

## Overview

CI run 37991107891 and one bounded rerun failed at the anonymous Docker Hub `postgres:16` pull before tests. Prepare a separate CI-only source proposal; no publishing, image pulls or release approval is implied.

## Implementation Details

The existing image preparation step invokes `scripts/qa/pull-ci-postgres.py` with a 21-minute workflow limit. Transient network/server pull failures get at most three attempts with 5/15-second backoff and a 180-second per-attempt limit. Quota failures move directly to provenance verification; terminal failures stop. The same limits apply to the mirror pull. Metadata requests have 15-second socket timeouts, response bounds and no retry; the workflow timeout bounds the entire step, including slow responses. SIGTERM and process exceptions kill and reap only the helper's Docker CLI process group.

The fallback uses the Docker Official Image publisher's ECR Public repository. Anonymous Docker Hub HEAD version checks do not count against pull quota. The current primary index digest must equal the computed mirror index hash, and the unique Linux/amd64 manifest body must equal its descriptor digest and size. A second primary HEAD refuses movement during comparison. Any failure to prove equality stops preparation. ECR's optional GET digest header is absent in the observed comparison; computed body hashes establish equality. A lagging mirror or unavailable primary HEAD therefore still blocks CI.

Pull the mirror by immutable platform digest; inspect Linux/amd64, tag that exact local image `postgres:16`, and verify local image identity. Private temporary Docker config, sanitized environment and the runner's explicit Unix socket avoid owner credentials and context changes. Invocation is guarded to GitHub Linux/X64; local `test-local.py`, its no-pull rule and all test assertions remain unchanged. No dependencies added.

`infra/ci/postgres-image-provenance.json` records the anonymous manifest-only comparison, source annotations and official documentation. The dated comparison is evidence for this proposal, not a stale future CI pin.

## Completion Notes

Pure fake-registry/fake-Docker tests cover success, quota, transient limits, terminal errors, unavailable provenance, mirror drift, corrupt bodies/headers/sizes, duplicate/missing platforms, architecture and tag identity, local refusal, private Docker command construction and timeout cleanup. The suite is discovered by the existing `test-local.py` Python test glob. No image layers, Docker operations, dependencies, live migrations or service changes were performed. Full `pnpm test:local` and the GitHub workflow remain unexecuted pending independent review and authorized publication. This companion leaves deployment source and primary owner files untouched.

The source verifier itself subsequently passed a bounded anonymous metadata-only comparison with the recorded digests. Seventeen pure tests passed before the final cleanup refinement (handling an already exited CLI process group and bounding its reap to five seconds). QUIET-494 began before a final test rerun; no checks will run during that window. The final source checkpoint therefore still needs independent review and a post-window pure test rerun before publication.
