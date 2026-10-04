# Task 0289: API Hardening

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-293. Some routes accepted more than they needed: any S3 key, any id, any file type. The issue was written on 2026-09-25; since then the maintenance routes have come to need `ADMIN_TOKEN` always (SLN-423, documented), and the three upload routes have come to share one pipeline that checks the owner type and that the owner exists before any S3 write (SLN-300). This task closes what was still open.

## Implementation Details

- **No route takes an arbitrary S3 key.**
  - `POST /api/s3/presign` is deleted (no caller; it signed an upload or read URL for any key). `getPresignedReadUrl` went with it.
  - `GET /api/s3/read` serves only `gold/media/`, `gold/covers/` and `gold/comments/` (`isReadableKey`, `src/lib/s3/read-headers.ts`): raw uploads, intermediate files and anything else answer 400 before S3 is asked.
  - `POST /api/media/process` (the TUI's two-step upload): presign signs nothing until the owner exists, and takes the raw file's extension from its checked type, not from the file name; process reads only the key presign named for that owner and file id.
- **Malformed ids answer 400 and touch nothing**: one `isUuid` (`src/lib/utils/uuid.ts`; `UUID_RE` in `src/lib/api/rest.ts` now comes from it, and `/api/authors/[id]` drops its copy). Checked in `/api/media/upload`, `/api/media/from-url`, both modes of `/api/media/process`, `/api/media/preview-monochrome`, `DELETE /api/media/[id]`, `GET /api/comments` (also the type: `work` or `author`), `PATCH` and `DELETE /api/comments/[commentId]`, and both attachment routes. Before, the database refused the text and the route answered 500.
- **Comment attachments**: an allow-list by extension (`src/lib/s3/attachment-types.ts`: images, documents, text and code, archives; no programs or scripts). The stored and served type comes from that list, not from the browser, and the extension and the shown name are cleaned (no folders, no control characters, at most 255 characters).
- **Every caught error that answers 500 is logged** with its route (eleven routes: works, works/[id], authors, authors/[id], search, match, stats, media/[id], reader cover and file, s3/read).
- The `reprocess` route's comment no longer says it updates the database: it rewrites thumbnails over the same keys.
- Docs: `docs/05_API_REFERENCE.md` (presign gone; read, process, comments and attachments rules), `docs/07_STORAGE.md` (reads go through the app, and which folders).

## Completion Notes

- `src/__tests__/api/hardening.test.ts`: the presign route is gone; `isReadableKey` and the read route refuse raw and other keys without asking S3; twelve requests with malformed ids answer 400 and call no S3, ingest, download or delete; process signs nothing for a missing owner, takes the extension from the type and reads only its own raw key (four foreign keys refused, the right one processed); attachments refuse programs and store the extension's type under a clean name.
- `src/__tests__/s3/read-route.test.ts`: its HTML, SVG and untyped files now sit under `gold/comments/`, the folder such files can come from; the headers they check are unchanged.
- `pnpm typecheck`, `pnpm lint` (0 errors), `python3 scripts/qa/test-local.py`: 1,622 tests in 131 files pass, 0 skipped. No page changed, so no browser check.

### Not changed

- `POST /api/media/reprocess` and `POST /api/media/backfill-palettes` stay as routes: they need `ADMIN_TOKEN` on every call since SLN-423, which the issue offered as the alternative to moving them to `scripts/`.
- Existing comment attachments keep the type they were stored with; there are none in the newest backup.
