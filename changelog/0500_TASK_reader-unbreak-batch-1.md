# Task 0500: Reader fixes, batch 1 (Look up, Track this book, sync stall, uploads)

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The first batch from the 13 October e-book review (`/mnt/project-files/ebooks/review-2026-10-13.md`). It fixes four things that were broken outright: SLN-661, SLN-669, SLN-668 and SLN-671.

## Implementation Details

- **SLN-661, Look up was an empty panel.** The popover header uses `glass-bar`. Its `::before` material layer sits at `inset: 0` of the nearest positioned ancestor. The header was not positioned, so the layer covered the whole popover, tabs and text included. Footnote popovers had the same fault. The header in `anchored-reader-popover.tsx` now takes `relative`.
- Fixes to Look up itself:
  - The language button now names both languages, such as "Latin → English", in its text and its `aria-label`.
  - A passage already in the target language opens on Sources, not Translate.
  - When the browser cannot translate on the device, the tab says so and lists the links. Before, it showed a skeleton that never resolved.
  - Wiktionary and Wikipedia failures now name the site and link to it (`Unreachable` in `lookup-html.tsx`). When the browser is offline they say "No connection.".
- **SLN-669, "Track this book" always failed.** `startReaderReading` created the reading with `startedPrecision: "day"` but no `startedOn`. The new-reading validation refused that. The reading now starts on the reading day of the first counted sitting, or of now when there is no sitting, using the reading-day start hour from settings.
- **SLN-668, syncing stopped for good after two tabs.** On a fresh browser, two reader pages opened at once each minted a `durtal-device` id, and the browser keeps only the last. The other page's outbox rows then failed the device check. They were marked blocked, and replay never passes a blocked head, so places and highlights in that browser stopped syncing, silently and for good.
  - When an authenticated preflight returns a valid current id that differs from the head row's id, replay now moves every unclaimed row under the superseded id to the current id and sends them. This is `adoptDevice` in `outbox-policy.ts` and the store.
  - This is safe because the outbox and the cookie live in the same browser profile and origin, so those rows are this device's own unsent work. The server writes with the cookie's id in any case.
  - A blocked head is probed at most once per page. It is still never sent from replay.
  - A signed-out page never adopts.
- **SLN-671, uploads got 403 except on localhost.** `uploadAccess` compared `Origin` with `req.nextUrl.origin`. The standalone server always sees its own URL as localhost, whatever address the browser used. The guard now relies on `crossOriginRefusal`, which trusts `Sec-Fetch-Site` and otherwise compares `Origin` with `Host`.

## Completion Notes

- Tests:
  - popover tests for the header, the language label and the no-translator state;
  - a database test, `src/__tests__/integration/reader-start-reading.test.ts`, which fails without the fix;
  - transport tests for adopting a waiting head, freeing a blocked head and a signed-out page;
  - the native IndexedDB check in `scripts/qa/reader-offline-store.mjs`, now asserting adoption, which replaces "blocked without relabeling";
  - an upload route test with a non-localhost Host.
- `docs/01_ARCHITECTURE.md` now records the device adoption.
- No migration and no new packages.
