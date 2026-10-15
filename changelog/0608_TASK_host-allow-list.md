# Task 0608: The app answers only to its own names

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

A guard against DNS rebinding, suggested in the review of #218. A hostile
page can point its own name at the Mac. The browser then treats the app as
that page's own origin, so the same-origin check on the API routes (task
0255) lets its calls through: the review simulated a page on
`evil.example:3410`, and the upload route and the reader's position and
annotation routes admitted it. Nothing in the app checked the `Host` name.

## Implementation Details

- **`src/lib/api/allowed-hosts.ts`**: `hostRefusal` answers `421` with a
  plain-text reason, `no-store`, when the `Host` header's name is not one of
  the app's. The app's names:
  - `localhost` and names under `.localhost`, any IP address (127.0.0.1, a
    LAN or a Tailscale address) and names under `.local` (the Mac's own
    network name, which the phone shortcuts use). No outside page can own
    these, so they are always allowed;
  - Tailscale names under `.ts.net`, also always allowed, so opening Durtal by
    its Tailscale name needs no setting. Tailscale assigns these names and
    their addresses; outside a tailnet a name there resolves only to
    Tailscale's own relays, never to an address a page chooses;
  - the names in `DURTAL_ALLOWED_HOSTS`, comma-separated, without a port (a
    public or custom name), each on any port.
- The port is not compared: rebinding changes the name, not the port.
  `X-Forwarded-Host` is never read, since a page on a rebound name can set
  it. A request with no `Host` header does not come from a browser and
  passes.
- **`src/proxy.ts`** runs it first, before the same-origin check, the eBook
  id check, the reader's policy and the list redirects. It covers every page
  (and so every server action) and every API route; build assets and public
  files are outside the proxy's matcher and hold nothing private.
- **`src/lib/env.ts`**: an entry in `DURTAL_ALLOWED_HOSTS` that is not a host
  name (a scheme, a port, a wildcard) stops the server at startup.
- **The live release** (`scripts/deploy/mac_release.py`) accepts
  `DURTAL_ALLOWED_HOSTS` as a public runtime setting, so the live app can be
  given a name.
- Documented in `.env.example`, `docs/13_CONFIGURATION.md` and
  `docs/05_API_REFERENCE.md` (Host check).

## Completion Notes

- `src/__tests__/api/allowed-hosts.test.ts`: the names allowed and refused,
  a listed name on any port and in any case, malformed entries, the proxy
  refusing a page, a server action, an API route and a reader page on
  another name with 421 (the #218 simulation, same-origin to the browser),
  `X-Forwarded-Host` ignored, and the startup check. With the guard taken out
  of the proxy, 6 of its cases fail.
- `scripts/qa/test_mac_release.py`: the variable is a public runtime setting,
  never a secret name.
