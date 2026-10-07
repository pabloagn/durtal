# Task 0385: E-book storage and delivery: a private bucket, signed CloudFront URLs and a Range route

**Status**: Completed
**Created**: 2026-10-07
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0348, 0379
**Blocks**: None

## Overview

SLN-491, the e-book epic's sub-issue 2. E-book files get their own private
bucket (`durtal-ebooks`, eu-north-1) under keys that are their own checksums.
The app hands the browser short-lived signed CloudFront URLs for files it read
from the catalogue, so the reader takes only the bytes it needs by HTTP Range,
straight from AWS. When CloudFront is not configured (development, previews,
an outage), the app streams the same bytes itself, with Range support. The
AWS setup is checked in as code that plans before it applies; nothing in AWS
was created by this task.

## Implementation Details

Keys and storage:

- `src/lib/ebooks/keys.ts`: `ebookFileKey` (`files/<sha[0:2]>/<sha>.<ext>`),
  `ebookDerivedKey` (`derived/<sha>/cover-{240,400,800}.webp` and
  `manifest.json`) and `ebookStagingKey` (`staging/<uuid>/<name>`), each after
  `EBOOKS_PREFIX`. A key is built only from a 64-hex checksum, a known
  extension or derived name, or a lowercase uuid; anything else throws.
  `coverKeySha256` reads the checksum back out of a cover key it built, and of
  nothing else.
- `src/lib/ebooks/storage.ts`: `putEbookObject` always sets the object's
  headers (immutable cache control, the exact content type, an RFC 5987
  `Content-Disposition`, `x-amz-meta-sha256`, Intelligent-Tiering for files and
  Standard otherwise, SSE-S3) and sends `ChecksumSHA256`. A file's key must be
  the checksum of its bytes, and a file is written with `IfNoneMatch: "*"`, so
  it is never overwritten (a 412 is "already there"). `headEbookObject`
  (`ChecksumMode=ENABLED`; a multipart object's composite checksum is reported
  as such, with the metadata checksum beside it), `getEbookObjectRange`
  (streamed, never buffered) and `listEbookObjects` (paged). Under
  `DURTAL_PREVIEW_S3_DIR` all four use `DIR/<bucket>/<key>`, refuse `..`, and
  a range reads only its slice of the file.

Delivery:

- `src/lib/ebooks/delivery/files.ts`: the only readers that make the
  `CatalogueFile` and `CatalogueCover` types the signer and the URL helper
  take (branded with a `unique symbol`), so nothing can sign a key a client
  sent or one remembered from an earlier request. `isDeliverable`: stored or
  verified, with no DRM.
- `src/lib/ebooks/delivery/sign.ts`: `signedFileUrl` (canned policy) and
  `signedDerivedUrlBase` (one custom policy for `<cdn>/<prefix>derived/*`, so
  a page of covers costs one RSA signature). The expiry is the next 6-hour
  boundary plus 6 hours, so one file has one URL for 6 hours and every URL is
  good for 6 to 12 hours. Quarantined, missing, replaced and DRM files throw.
- `src/lib/ebooks/delivery/url.ts`: `fileUrlFor` and `coverUrlFor` give the
  signed CloudFront URL when `EBOOK_DELIVERY=cloudfront`, else the app's
  routes.
- `GET`/`HEAD /api/ebooks/files/[fileId]`: one range (the first of several),
  `bytes=a-b`, `bytes=a-` or the suffix `bytes=-n`, with 206, `Content-Range`
  and the exact length; 200 with `Accept-Ranges` for no range; 416 with
  `bytes */<size>`; a header that is not a byte range is ignored (RFC 9110).
  `ETag` is `"<sha256>"` and `If-None-Match` gives 304 without touching S3.
  A malformed id is 400 before any database or S3 call; an unknown file, a
  missing object, and quarantined, missing, replaced and DRM files are 404.
  The content type comes from the format (`contentTypeFor`), never the row.
- `GET /api/ebooks/files/[fileId]/url`: `{ url, expiresAt }`, no-store.
- `GET /api/reader/[ebookId]/cover?w=240|400|800`: the preferred file's
  derived cover, else the e-book's own. 302 to the signed cover in CloudFront
  mode, streamed WebP otherwise.

Verification:

- `pnpm ebooks:verify` (`scripts/ebooks/verify.ts`, `src/lib/ebooks/verify.ts`):
  one listing of the bucket, a HEAD with its SHA-256 for every object a row
  names (8 at a time), and the objects no row names, with the 24-hour
  in-flight rule. Read-only by default, through a read-only session that must
  fail a write probe. `--apply --backup <dump>` (a pg_dump custom file from the
  last hour) marks matches `verified` with `verified_at` and mismatches
  `missing`, one atomic per 500 rows; quarantined and replaced files keep their
  status. Reports go to `reports/ebooks/verify-<timestamp>.md` and `.csv`
  (`/reports/` is git-ignored).
- `scripts/maintenance/report-orphaned-s3.ts` lists the e-book bucket's
  `files/` and `derived/` objects no row names (a derived folder belongs to the
  file whose checksum names it), never deleting any. Before the AWS setup the
  bucket does not exist, and the report prints `ebooks: { bucket, missing:
  true }` (`ebookOrphanReport` in `src/lib/ebooks/verify.ts`).

The AWS setup, as code:

- `infra/aws/ebooks/`: the bucket policy (CloudFront's OAC may read only from
  the distribution; everyone but the admin is denied deleting `files/*`,
  deleting versions, and changing versioning, lifecycle or the policy), the
  lifecycle (noncurrent versions 30 days, expired delete markers, incomplete
  multipart uploads 7 days, `staging/` 2 days), the cache policy (path only,
  one year, compression on), the response headers policy (CORS answered by
  CloudFront, `Range` allowed, `Content-Range`, `Accept-Ranges`,
  `Content-Length` and `ETag` exposed, nosniff), the OAC, the distribution
  (HTTP/2 and 3, all edges, viewers restricted to a trusted key group), the
  app user's policy (no delete outside `staging/*`) and a $5 monthly budget
  with alerts at 80% actual and 100% forecast. No account id or secret: every
  value is a placeholder filled at run time.
- `scripts/aws/ebooks-storage.sh plan|apply`: `plan` makes only get, list,
  describe and head calls and prints what exists, what differs and what
  `apply` would do. `apply` refuses to run without `--yes-from-joris`, is
  idempotent, makes the key pair with openssl and writes the private key
  (base64 PEM) only to the env file, never to the terminal, then prints the
  values for the app's environment. It exits when the AWS CLI v2 is missing.

Environment and settings:

- `src/lib/env.ts`: `EBOOKS_BUCKET` (default `durtal-ebooks`),
  `EBOOKS_PREFIX`, `EBOOKS_REGION` (default `AWS_REGION`), `EBOOK_DELIVERY`
  (`app` by default), `EBOOK_CDN_URL` (https), `EBOOK_CDN_KEY_PAIR_ID` and
  `EBOOK_CDN_PRIVATE_KEY` (must decode to a PEM private key).
  `EBOOK_DELIVERY=cloudfront` with any CDN variable missing fails at startup
  with one message naming them. Also in `.env.example`, `docker-compose.yml`,
  `docs/11_DEPLOYMENT.md` and `docs/13_CONFIGURATION.md`.
- Settings › Integrations gains an "eBook storage" row: bucket, region,
  delivery, which variables are set, and a check that HEADs the newest stored
  file (or the bucket when there is none) and, with CloudFront, reads the first
  byte of a signed cover (or file). With no file and no bucket (before the AWS
  setup) it says "Not set up yet", not "Not working".
- `scripts/qa/preview-local.py` sets `EBOOK_DELIVERY=app`.

Docs: `docs/05_API_REFERENCE.md` (the three routes), `docs/07_STORAGE.md`
(the e-book bucket, keys, objects, versioning, delivery, verification, and
that `/api/s3/read` never reads an e-book), `docs/11_DEPLOYMENT.md` (the
setup, where the private key lives, rotation, the budget) and
`docs/13_CONFIGURATION.md`. The region is corrected to eu-north-1 in docs 01,
07 and 11 and `.env.example`.

## Completion Notes

Tests, 57 new:

- `src/__tests__/ebooks/keys.test.ts` (8): the three key builders, the
  prefix, and refusal of anything that is not 64 hex, a known extension or
  derived name, or a uuid.
- `sign.test.ts` (7, with an RSA key made in the test): the canned URL's
  fields and exact policy; one URL per 6-hour window and a new one after its
  boundary; always 6 to 12 hours; quarantined, missing, replaced and DRM files
  throw; the wildcard policy covers `derived/*` only, and every cover of a
  page shares one signature.
- `file-route.test.ts` (12): 200 with `Accept-Ranges`; `bytes=0-99` is 206
  with `bytes 0-99/<size>` and 100 bytes; the suffix `bytes=-65557`; an open
  range and only the first of several; `bytes=<size>-` is 416; a header that
  is not a byte range is ignored; 304 without an S3 call; 400 before any
  database or S3 call; 404 for an unknown file, a missing object and each
  undeliverable status; the format's type whatever the row says; HEAD.
- `cover-route.test.ts` (4), `preview-dir.test.ts` (5: writes under
  `DIR/<bucket>/<key>`, never overwrites, refuses a key that is not the
  bytes' checksum, reads exactly a range's slice, refuses `..`),
  `before-setup.test.ts` (6: with neither a bucket nor a file Settings says
  not set up yet; with the bucket and no file it works; a catalogued file in a
  missing bucket fails; the orphan report names the bucket as missing, lists
  orphans once it exists, and still fails on any other S3 error),
  `aws-setup.test.ts` (6: the JSON documents carry no account id or secret;
  only the admin may delete book files; `apply` refuses without
  `--yes-from-joris` before any AWS call; no AWS CLI v2 stops it; `plan`
  makes read-only calls only; `apply` in an empty account makes every piece
  once and writes the key only to the env file) and `env.test.ts` (+3).
- Database suite `src/__tests__/integration/ebook-delivery.test.ts`
  (`DURTAL_EBOOK_DELIVERY_TEST_DATABASE_URL`, `sln491_ebook_delivery`, 6):
  only rows read are signed; the url route refuses each undeliverable file; a
  range is served from the bucket; verification reports every case read-only,
  applies only with a backup from the last hour, and the orphan report lists
  an unreferenced object older than a day and not a younger one.

Gates, in a cloud container: `pnpm typecheck` clean; `pnpm lint` 0 errors
(77 warnings, as on main); `pnpm deadcode` clean;
`python3.12 scripts/qa/test-local.py` 271 files, 3,013 tests passed, 0
skipped. `pnpm build`, then a preview (`--start --seed-large 50 --s3-dir`):
`page-weight.js` every route within budget (`/library` 90 of 300 KB),
`phone-audit.mjs` no sideways scroll, `interaction-audit.mjs` no failures,
and Settings › Integrations in headless Chrome 153, Firefox 155 and WebKit
26.6 at 1440, 768 and 390 px: alignment, design, overflow and touch audits
clean (0 alignment deviations, 0 low-contrast text).

Range reads: two files seeded by hand (5 MB and 1 MB, sub-issue 3's
`--seed-reader` is not on main yet), read with `fetch` from a page of the app
in all three browsers: `bytes=0-1023` gave 206 with exactly 1,024 bytes and
`bytes 0-1023/<size>`; `bytes=-22` gave the last 22 bytes; `bytes=<size>-`
gave 416; no preflight request in any browser. Three reads took 113 to 180
ms in all, from the local preview.

Deviations from the issue:

- No new dependency. The signer uses `node:crypto` (RSA-SHA1 and CloudFront's
  URL-safe base64) instead of `@aws-sdk/cloudfront-signer`. Both URL kinds were
  compared byte for byte with the package's output for the same key, resource
  and expiry, outside the repository.
- `scripts/aws/ebooks-storage.sh` writes the private key to `.env.local` by
  default (`--env-file` to change it), the file the app and `scripts/` load, and
  which git ignores; the issue says `.env`.
- The cover route's redirect is cached for `min(86400, seconds the signature
  has left - 3600)` instead of a flat 86400, so a cached redirect never outlives
  its signature.
- Settings' S3 row now says "Keeps covers, photos and attachments", since
  e-books live in their own bucket.

Not done here, and waiting on Joris's own yes:

- `scripts/aws/ebooks-storage.sh apply` (the bucket, distribution, key group,
  policies, lifecycle and budget), then `plan` reporting no difference, and the
  signed-URL checks from the Mac (206 from the edge, `x-cache` hit, unsigned
  and expired URLs refused, time to first byte). Until then the app delivers
  with `EBOOK_DELIVERY=app`, which needs no AWS.
- Safari: the browser checks used headless Chrome, Firefox and Playwright
  WebKit.
- Cloud build: no docker build, no `.env.local`, no backup and no live
  database; the merging thread re-checks the docker build.
