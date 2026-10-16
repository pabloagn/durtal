# Task 0809: Server actions under /_next/ are refused on other names

**Status**: Completed
**Created**: 2026-10-16
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0608
**Blocks**: None

## Overview
SLN-896. The server-side review of main (`findings/server-review-2026-10-16.md`). The host allow-list (task 0608) refuses a request on a name that is not Durtal's, so a page that points its own name at the Mac (DNS rebinding) reaches nothing. The proxy's matcher left out every path under `/_next/`, for the build's own files. But Next.js runs a server action, or a form posted without JavaScript, on any path, `/_next/` included, so a rebound page could post one there and the host check never saw it.

## Implementation Details
- `src/proxy.ts`: the matcher takes `/_next/:path*` too. A matcher can't tell a GET from a POST, so the proxy lets a GET or HEAD under `/_next/` through first (`buildFile`): scripts, styles, fonts, `/_next/image` and the dev server's hot reload still load on any name, and are never redirected to a saved page size. Any other method there gets the host check like a page: 421 on another name, through to Next.js on Durtal's own.
- Tests: `src/__tests__/api/allowed-hosts.test.ts`. The proxy runs under `/_next/`; the build's files load on any name with GET and HEAD and are never redirected; a server action, a form post, a PUT and a DELETE under `/_next/` get 421 on another name and pass on Durtal's own. The matcher and redirect tests fail without the fix.

## Completion Notes
Checked against a production build: see the PR.
