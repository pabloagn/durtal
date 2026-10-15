# Task 0596: One reader device id per browser, however many tabs open first

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0500, 0566
**Blocks**: None

## Overview

SLN-668's last items. The proxy made a `durtal-device` id for every reader
page request without the cookie, so two reader tabs opened at once in a fresh
browser (a new profile, cleared cookies, a session restore) made two ids. The
browser kept the last one; the other tab read under the stale id for its whole
session. Its rows were relabelled when they replayed (0500), but its own "this
device" place, resume keys and sitting requests still named an id the server
no longer had for it.

Now the id is made once, before any book opens, and every tab gets the same
one. The ticket's two-tab end-to-end check comes with it.

## Implementation Details

- `src/proxy.ts` no longer makes the cookie; it only sets the reader page's
  Content-Security-Policy.
- `POST /api/reader/device` makes the id when the browser has none (or a
  malformed one) and returns a valid one unchanged. `GET` stays read-only.
  The cookie's attributes are `deviceCookieOptions` in `src/lib/reader/device.ts`.
- `src/lib/reader/device-handshake.ts` (`settleDeviceId`): under the
  `durtal-reader-device` Web Lock, POST, then read the cookie back with GET.
  Tabs take turns, so the first makes the id and the rest are given it.
  "cookies-off" when the browser did not keep the cookie, so the page never
  reloads in a loop. Without Web Locks it still asks, as before.
- `src/app/reader/[ebookId]/page.tsx`: a request without a valid cookie
  renders `DeviceHandshake` (`src/components/reader/device-handshake.tsx`)
  before any book, plug-in or place loads. It shows "Opening the book", then
  reloads with the cookie. If cookies are off or Durtal cannot be reached it
  says so with Retry and Back (`OpenError`). A browser that already has the
  cookie opens the reader as before, in one page load. `reader-view.tsx` is
  unchanged.
- `scripts/qa/reader-two-tabs.mjs`: two tabs on the EPUB 3 fixture in a fresh
  context open at once. It checks one id made and kept, every place request
  naming it, and the stored place being the newest tab's with both open and
  after the older one closes (its leave save does not put its place back). It
  also checks that a third tab opens at that place, and that nothing is refused
  and no sync notice shows. It runs against a disposable preview
  (`preview-local.py --start --s3-dir DIR --seed-reader`).
- `scripts/qa/page-weight.js` sends a fixed device cookie, so the
  `/reader/*` row still measures the reader rather than the handshake step
  (16 KB without it, 23 KB with it on the seeded preview).
- Docs: the device id's origin in `docs/02_DATA_MODEL.md` and the device
  routes in `docs/05_API_REFERENCE.md`.

## Completion Notes

- `reader-two-tabs.mjs` on a production preview of main: in Chromium, WebKit
  and Firefox, two ids were made for the two first requests. With this
  change, one id was made and every check passes in all three.
- Headless Firefox at 1440 reopens a saved place one screen early, with one
  tab too (left at /36/1:52, reopened at /24/1:62). That is the reopen
  check's concern (`reader-engine-check.mjs place`), so this script checks
  only that the third tab opens at the newest tab's place rather than the
  older one's.
- Handshake states, with the device route stubbed: Durtal unreachable, then
  Retry opens the book; cookies not kept shows its message without
  reloading; a returning browser makes no handshake call and loads once. Checked
  in Chromium and WebKit. Alignment, overflow, design and touch audits are
  clean on the opening, unreachable and cookies-off states. They ran in
  Chromium, Firefox and WebKit at 1440, 1024, 768, 430, 390 and 320 (54 of
  54).
- Tests: `device-handshake.test.ts` covers the POST route (make, keep,
  replace a forged id, refuse another origin), the lock and read-back, two
  tabs taking turns, cookies off, and unreachable. `csp.test.ts`: the proxy
  never sets the cookie. `return-route.test.ts`: a request without the cookie
  renders the handshake, keeps Back and loads no book.
- No migration, no new package.
- Review fix: over plain http (a Mac's `.local` address) Web Locks are
  missing, so two first tabs can still race, and the read-back called the
  losing tab "cookies-off" (2 of 8 runs). The read-back now accepts any
  stored id (0 of 19). Each handshake request gives up after 15 s, so a
  stalled one shows "Durtal could not be reached" with Retry and frees the
  lock for the other reader tabs.
