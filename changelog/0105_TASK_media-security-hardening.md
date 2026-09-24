# Task 0105: Media Upload Security Hardening

**Status**: Completed
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
Media upload endpoints lack MIME type validation, file size limits, and URL sanitization. This creates security risks including arbitrary file upload and SSRF.

## Implementation Details
1. **MIME type whitelist** — Validate `contentType` in presign and upload routes:
   - Allowed: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
   - Reject all others with 400
   - Apply to: `/api/media/process` (presign mode), `/api/media/upload`, `/api/media/from-url`

2. **File size limit** — Add 50 MB max to all media upload routes (comment attachments already have 25 MB limit)

3. **URL sanitization in `/api/media/from-url`**:
   - Block `file://`, `ftp://`, `data:` URL schemes — allow only `https://`
   - Block private/internal IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x)
   - Add 30-second fetch timeout
   - Add 50 MB response size limit

4. **Bulk endpoint protection** — `/api/media/reprocess` and `/api/media/backfill-palettes` should require an admin header or secret (e.g., `X-Admin-Token`) since the app has no auth layer (Authelia handles auth externally, but these are expensive operations)
