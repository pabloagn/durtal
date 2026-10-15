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
  - one-word names, such as `studio` (a Tailscale MagicDNS short name or a
    LAN name), so a phone opening `http://studio:3110` is not refused. A page
    can only own a name with a dot in it;
  - the names in `DURTAL_ALLOWED_HOSTS`, comma-separated, without a port (a
    public or custom name), each on any port.
- A `Host` name with a character a host name cannot have is refused before
  the suffix test (`evil.example#.local`).
- The port is not compared: rebinding changes the name, not the port.
  `X-Forwarded-Host` is never read, since a page on a rebound name can set
  it. A request with no `Host` header does not come from a browser and
  passes.
- **`src/proxy.ts`** runs it first, before the same-origin check, the eBook
  id check, the reader's policy and the list redirects. It covers every page
  (and so every server action) and every API route. Only `/_next/` (build
  files and the dev server's hot reload) is outside the proxy's matcher. The
  matcher used to skip every path with a dot too, but the catch-all not-found
  page answers `/zz.y` and runs any server action posted to it, so a
  rebinding page could reach the library there (found in review). Public
  files now pass through the proxy, which does nothing else to them.
- **`src/lib/env.ts`**: an entry in `DURTAL_ALLOWED_HOSTS` that is not a host
  name (a scheme, a port, a wildcard) stops the server at startup.
- **The live release** (`scripts/deploy/mac_release.py`) accepts
  `DURTAL_ALLOWED_HOSTS` as a public runtime setting, so the live app can be
  given a name. The homelab compose in `docs/11_DEPLOYMENT.md` sets it to the
  Traefik name.
- **`scripts/qa/reader-engine-check.mjs`**: the plain-http font row opens
  `durtal.local` instead of `durtal.test`, a name the guard allows and
  browsers still treat as insecure.
- Documented in `.env.example`, `docs/13_CONFIGURATION.md` and
  `docs/05_API_REFERENCE.md` (Host check).

## Completion Notes

- `src/__tests__/api/allowed-hosts.test.ts`: the names allowed and refused,
  a listed name on any port and in any case, malformed entries, the proxy
  refusing a page, a server action, an API route and a reader page on
  another name with 421 (the #218 simulation, same-origin to the browser),
  `X-Forwarded-Host` ignored, and the startup check. With the guard taken out
  of the proxy, 6 of its cases fail. The matcher is checked with Next's
  `unstable_doesMiddlewareMatch`: dotted paths and public files run the
  guard, `/_next/static` and `/_next/webpack-hmr` do not (4 of 7 fail on the
  old matcher). One-word names and the strict name check: 6 cases fail on
  the first version of the guard.
- `scripts/qa/test_mac_release.py`: the variable is a public runtime setting,
  never a secret name.
