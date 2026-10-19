# Task 0773: The offline worker updates after a release

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1145 (offline survey of 18 Oct, item 2). Once a book was made available
offline, that device kept the release's worker for good. A new release went
unseen, the offline pages stayed the old ones online as well as offline, and
the old offline reader called server actions the new server no longer has.
Only clearing the site's data got out of it.

## Implementation Details

- `src/lib/reader/offline/install.ts`: the app reads `/offline-assets.json`
  with a query that is new each time (`?t=`). The installed worker matched the
  path and answered from its own cache, which holds its own release's copy, so
  the app kept registering the old release. The query misses that cache, so
  today's workers send it to the server too: devices already stuck are freed
  by this change alone.
- `checkOfflineUpdate()`: on a device that has a worker, it asks the server
  for its release and, when it differs, registers it beside the running one.
  It resolves to the new worker once it waits. A device with no worker gets
  none and makes no request.
- `takeOverWith(worker)`: asks the waiting worker to take over now and
  resolves once it controls the page.
- `src/components/shared/offline-update.tsx`: runs the check when Durtal opens
  online, comes back online, or comes back into view after an hour. In the
  catalogue, a waiting release shows "A newer version of Durtal is ready" with
  Reload, which lets it take over and reloads. The two offline pages run the
  check without the offer (they have no toaster); the new release takes over
  when Durtal's pages next close.
- `public/sw.js`:
  - `/offline-assets.json` comes from the server first, and from the
    release's copy only offline.
  - `SKIP_WAITING` lets a waiting release take over when a page asks.
  - Earlier releases' shell and asset caches (about 13.5 MB each) are deleted
    on the first page the new release serves. Kept: downloaded books, a
    release installing or waiting, and releases open pages announced. Not on
    activation: headless Firefox, closed with a release waiting, activated it
    (its activation cleanup ran), then
    started the old one again on the next launch, which would have found its
    caches gone.
- The reader's own offline page (`src/app/reader`) is left as it was.

## Completion Notes

- Two releases on one address, headless Chromium, Firefox and WebKit, in
  persistent profiles at 1440, 390 and 320. Release A (today's worker) was
  installed, then releases B to E were served in turn:
  - Opening the library on B showed the offer in 2.4-4.4 s with B waiting.
    Reload put B in control, left only B's caches and books, and
    `/ebooks/offline` came from B (15 of 15 scripts in the server's build). It
    stayed on B after the browser was reopened.
  - Closing without Reload: on the next launch the new release ran and the
    old caches were gone. In Firefox the new release takes over a few seconds
    into that launch, and clears the old caches on the next page.
  - A fresh profile: no worker, no manifest request.
- Rebased on main with SLN-1033's toast action target, at 390 and 320:
  release A was installed and B served in Chromium, WebKit and Firefox, then
  C in Chromium and WebKit. The offer showed in 2.4-3.8 s each time. Once the toast has settled,
  the alignment, design and touch audits report nothing; Reload's target is
  44 px. Reload put the new release in control, with only its caches and the
  downloaded books left.
- After main's per-request page policy (SLN-1240), with main's own worker
  installed (2e4fe7cc) and this change served, in persistent profiles: the
  offer showed in 3.2-4.3 s at 1440 in Chromium, Firefox and WebKit, and in
  3.0-3.8 s at 390 in Chromium and WebKit. Reload put the new release in
  control with only its two caches; `/ebooks/offline` ran 15 of 15 of the
  server's scripts, and stayed on the new release after reopening. No
  policy refusal or page error in any engine. The alignment, design and
  touch audits report nothing with the offer shown. Offline, Chromium and
  Firefox open `/ebooks/offline` from the worker with its scripts running;
  Playwright's WebKit refuses offline navigations in this harness.
- Page weight passes on every measured route.
- `src/__tests__/reader/offline/offline-update.test.ts`, 8 tests.
