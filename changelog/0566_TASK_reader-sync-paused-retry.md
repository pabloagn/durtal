# Task 0566: The reader says when sync is paused, with Retry

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0500
**Blocks**: None

## Overview

SLN-668, the third acceptance row: "If sync is paused for any reason, the
reader says so (Sync paused · Retry) instead of failing silently." 0500 made
replay move past a head blocked under a superseded device id, but a queue
that still stalled, behind a blocked head or a server that keeps refusing,
said nothing. Places and highlights made there waited on the device with no
sign.

## Implementation Details

- `src/lib/reader/offline/sync-paused.ts`: `syncPaused(rows, online)`. Sync
  is paused when the outbox head is blocked, has failed to send three times
  in a row (`PAUSED_AFTER_ATTEMPTS`), or has stayed first in the queue for
  two minutes while online (`PAUSED_AFTER_MS`). Offline is not a pause: the queue waits
  for the network on its own. Only the head counts, since replay goes in
  order.
- `src/components/reader/use-sync-paused.ts`: reads the outbox every 5 s
  while the page is visible, and at once on `online`, `offline`,
  `visibilitychange` and a persistence error. The first read waits 5 s, so
  it never competes with opening the book.
- `reader-view.tsx`: when no other notice is up, the reader's notice says
  "Sync paused. Your places and highlights are kept on this device until it
  resumes." with a Retry button (`aria-label` and tooltip "Retry sync"). It
  takes the resume notice's layout: one row on a desktop, the button on a row
  of its own on a phone.
- The hook keeps which head it saw first and since when, and restarts that
  clock when the page becomes visible or comes back online: time hidden or
  offline is not time stuck.
- Retry is `transport.retryNow()`. A person pressing it is the explicit
  reconciliation a blocked head waits for: signed in again under this
  device, the head goes through `store.reconcile` with its own reference,
  as the annotations panel's retry does; a row under another device id is
  still refused. It also lets a blocked head be probed again (replay probes
  one once per page), and `store.retryNow()` clears a waiting head's
  backoff, then replays in the foreground. Online, visibility and device
  probes still never unblock anything.

## Completion Notes

- Tests: new `sync-paused.test.ts`; `transport-wake.test.ts` gains Retry for
  a head waiting out its backoff, a blocked head probed again on each Retry,
  and a blocked head freed on Retry once the cookie's device changed. The
  native IndexedDB checks (`scripts/qa/reader-offline-store.mjs`) gain Retry
  clearing a backoff and leaving a blocked head blocked.
- In the browser, on a production preview, with the place saves answered 503
  and the head set to three failed attempts: the message shows, Retry sends
  the place once and the queue empties, in Chromium, WebKit and Firefox at
  1440, 390 and 320. Alignment, design and overflow audits are clean on the
  reader with the message up.
- Review: two common pauses went unsaid. With the server unreachable
  (the device check fails), replay counts no attempt, so the message never
  showed in 15 minutes; it now shows after about 2 minutes. After signing
  out and in again, Retry could not send a head blocked by the 401; it now
  reconciles it. The reviewer's fix, with tests for both, checked in
  Chromium, WebKit and Firefox.
- Not covered (the ticket stays open): the device id is still minted per
  request, so two first requests at once still make two ids (replay adopts
  the newer one, per 0500); and the two-tab end-to-end check the ticket
  asks for.
- No migration and no new packages.
