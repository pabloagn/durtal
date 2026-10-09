# Task 0448: SLN-577 private phone production delivery

**Status**: In Progress
**Created**: 2026-10-10
**Priority**: P0
**Type**: Infrastructure
**Depends On**: Independent concrete service/proxy packet review
**Blocks**: Owner phone acceptance

## Overview

Deploy the currently reviewed catalogue over the existing personal Tailscale HTTPS origin independently of unfinished reader work. Application and schema behavior remain byte-identical to main94140915; landed CI-only main5e16ed7f is included normally. Preserve owner sorting files and manual3100. No migrations, ingestion, content writes, new dependencies, Funnel or tailnet changes.

## Implementation Details

Reuse the SOURCE_APPROVE702b7795 packager/launcher with a narrow P0 adaptation. Git-archive the final source commit into an isolated fresh build, install existing frozen-lockfile dependencies there, and run the production build using existing Node22.23.3/pnpm10.26.1. Keep Next's actual generated build ID separate from the immutable source commit/tree. Package a complete hash manifest including separately sourced deployment tools. Main health has no build identity: require the owned Node listener PID for launcher readiness and independently verify actual served build/assets and owner-data continuity before proxy publication.

Read only the existing owner `/Users/pabloaguirre/personal/durtal/.env.local` in memory, using Node's built-in dotenv parser and an exact runtime-name allowlist. Never copy a plaintext source into the build, release, plist, log or receipt. Fail closed on unsafe/missing required values. Reuse byte-identical SLN-491 helper from approved b232dd157f984ab32ab104318fc7a76ffaed435b only for runtime_identity(account608240934043, IAMuserdurtal-app), with a hash-pinned absolute AWS CLI, fixed STS endpoint, fifteen-second timeout and sanitized environment. No Keychain operations or default/work profiles. Production binds only127.0.0.1:3110; per-user launchd has private config/hash pins, bounded redacted logs and crash recovery. Source/proxy application awaits independent review of exact generated bindings and preimages.

## Completion Notes

Twenty-seven focused pure packaging/startup tests pass. Broad retained exact-main gates need no repeat for unchanged app/schema. Build, runtime and mobile evidence will be recorded after execution; source tests alone do not establish delivered phone access. Mac availability depends on power, wake state and owner login/FileVault unlock. Serve rollback removes only the matching new private proxy from the observed empty preimage.
