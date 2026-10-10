# Task 0448: SLN-577 private phone production delivery

**Status**: In Progress
**Created**: 2026-10-10
**Priority**: P0
**Type**: Infrastructure
**Depends On**: Independent concrete service/proxy packet review
**Blocks**: Owner phone acceptance

## Overview

Deploy the currently reviewed catalogue over the existing personal Tailscale HTTPS origin independently of unfinished reader work. Start from reviewed main94140915 plus normally landed CI-only main5e16ed7f. Phone acceptance adds only two page-local touch corrections on the book detail route; schema, dependency versions and catalogue actions remain unchanged. Preserve owner sorting files and manual3100. No migrations, ingestion, content writes, new dependencies, Funnel or tailnet changes.

## Implementation Details

Reuse the SOURCE_APPROVE702b7795 packager/launcher with a narrow P0 adaptation. Git-archive the final source commit into an isolated fresh build, install existing frozen-lockfile dependencies there, and run the production build using existing Node22.23.3/pnpm10.26.1. Keep Next's actual generated build ID separate from the immutable source commit/tree. Package a complete hash manifest including separately sourced deployment tools. Main health has no build identity: require the owned Node listener PID for launcher readiness and independently verify actual served build/assets and owner-data continuity before proxy publication.

Read only the existing owner `/Users/pabloaguirre/personal/durtal/.env.local` in memory, using Node's built-in dotenv parser and an exact runtime-name allowlist. Never copy a plaintext source into the build, release, plist, log or receipt. Fail closed on unsafe/missing required values. Reuse byte-identical SLN-491 helper from approved b232dd157f984ab32ab104318fc7a76ffaed435b only for runtime_identity(account608240934043, IAMuserdurtal-app), with a hash-pinned absolute AWS CLI, fixed STS endpoint, fifteen-second timeout and sanitized environment. No Keychain operations or default/work profiles. Production binds only127.0.0.1:3110; per-user launchd has private config/hash pins, bounded redacted logs and crash recovery. Source/proxy application awaits independent review of exact generated bindings and preimages.

## Completion Notes

Twenty-eight focused pure packaging/startup tests pass. The original unchanged catalogue reused retained exact-main gates. The phone acceptance corrections require fresh typecheck, full disposable-database test:local, relevant lint and a frozen-source build. Runtime and mobile evidence are independently bound to each exact release; source tests alone do not establish delivered phone access. Mac availability depends on power, wake state and owner login/FileVault unlock. Serve rollback removes only the matching new private proxy from the observed empty preimage.

The first archive preparation correctly refused tracked `.envrc` before dependency install. Exclude only that non-production local direnv instruction file, record the exact excluded path in preparation metadata, and keep all application/lockfile source pinned. No environment file is executed or copied. Scoped in-memory IAM preflight independently passed account608240934043/userdurtal-app.

## Phone acceptance corrections

Root delivered the original c4b7 catalogue through private Tailscale HTTPS with normal TLS validation, owned IPv4 loopback3110, a successful graceful restart and preserved owner3100. Read-only mobile diagnostics found two real press-area failures on the book detail page: the recommender website icon (12×12px) and Orders → Pipeline (52.3×20px). Correct them locally: reserve separate 44px coarse-pointer targets for a recommender name and its website, keep the small website icon on the first name line's cap-height center, and use the existing touch-hit area for Pipeline. Desktop icon size and cap alignment stay unchanged; shared record, carousel, action, schema and reader code are untouched. Verify long, short, multiple and absent recommender content, real press areas, clipping, overlap, alignment and page weight in a reviewed disposable preview before production replacement.

The earlier browser page error came from the QA harness blocking two intended SELECT-only server-action calls. A separate root-reviewed guard, pinned to the old artifact and exact observed initial arguments, passed the ordinary page-read check with zero page errors and HTTP200 read responses. This changes only QA permission policy; it does not change application actions or establish a production security defect. Final acceptance needs a newly bound guard for the new build. Physical owner-phone acceptance remains distinct from headless viewport evidence.
