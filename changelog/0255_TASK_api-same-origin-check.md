# Task 0255: Same-Origin Check for the API Routes

**Status**: In Progress (draft PR, waits for Pablo's choice)
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-310 and SLN-423 found that many API routes accept any call: media
upload and delete, S3 presign and read, comments, export, reader, venues,
search and more. A token cannot guard them, because the app's own pages call
them from the browser. A web page on another site could make Pablo's browser
call them: upload, delete or export through his session on :3100.

## Implementation Details
- `src/lib/api/same-origin.ts` adds `crossOriginRefusal(req)`. It reads
  `Sec-Fetch-Site`: `same-origin` and `none` pass, `same-site` and
  `cross-site` get 403. When an older browser sends no `Sec-Fetch-Site`, it
  compares `Origin` with `Host`. A call with neither header passes: it does
  not come from a web page (curl, the TUI, scripts).
- `src/proxy.ts` now also matches `/api/:path*` and runs the check there,
  before any route. Pages keep the page-size redirect as before.
- Every API route gets the check, the token routes too. The tokens still
  apply on top, so no legitimate caller sees a change.
- `docs/05_API_REFERENCE.md` has a Same-origin check section.
- Upload size. When the proxy runs on a route, Next.js passes the route only
  the first 10 MB of the body by default, so uploads over 10 MB failed ("The
  image did not arrive intact"; a comment attachment answered 500).
  `next.config.ts` sets `experimental.proxyClientMaxBodySize` to `"55mb"`: the
  largest upload is a 50 MB image (`MAX_MEDIA_SIZE_BYTES`), attachments allow
  25 MB. `scripts/qa/upload-size-check.mjs` sends 9, 12 and 49 MB uploads to
  `/api/media/upload` without an owner: the route reads the whole body and
  refuses it, so nothing is stored.
- `src/__tests__/api/same-origin.test.ts` covers the helper and the proxy.

## Completion Notes
- This stops cross-site calls through the browser (CSRF). It does not stop
  another device on the same network: that device can send any header. The
  dev server bind (`-H 127.0.0.1`, SLN-423) or a login closes that.
- The alternative is a login for the whole app. Pablo decides; this draft is
  the recommended option.
