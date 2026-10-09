# Task 0438: SLN-501 reader typography, themes and device preferences

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: HIGH
**Type**: Feature
**Depends On**: SLN-493, SLN-499, SLN-500
**Blocks**: SLN-502, SLN-509

## Overview

Replace the reader's five cookie settings with validated device defaults and
book overrides, self-hosted reading fonts, publisher-preserving typography,
page themes and layout controls. This first checkpoint contains only the
coordinator-authorized pure policies; it does not integrate them into the reader.

## Implementation Details

- Strict presentation schemas cover every current field, exact numeric steps,
  nonempty overrides, scope/reset inputs and the atomic defaults/book-clearing
  input contract. Stored JSON recovers each valid known field independently.
- Device defaults, effective layering, per-field keyboard scope and legacy
  adoption mapping are pure. Device classification uses the viewport's short
  side; resizing must not select a different class during an open session.
- Typography and colour CSS are separate outputs. Publisher mode only scales
  typography. Override mode protects inline emphasis, special fonts, artwork,
  drop caps and OpenType settings. Declaration transformations consume original
  publisher values so a later document pass can restore them reversibly.
- Colour calculations implement sRGB filtering and WCAG contrast. Rubrics keep
  their hue through OKLCH lightness adjustment and gamut mapping. Selection and
  highlight fills are fitted against the same filtered text and actual blend
  opacity when needed.
- The dark page palette matches current Quiet Glass tokens. The specified Sepia
  selection and rose fill fall below 4.5:1 at 70% brightness (4.3896 and 4.4734
  respectively); only failing rendered fills are adjusted toward the page
  background, retaining their declared base colours.
- Layout policy covers flow, spreads, line length, margins and reduced motion.
  Font advances are explicit source-bound inputs. Synthetic test metrics are
  clearly marked and are not presented as measurements of shipped fonts.
- Export the planned v1 inventory of 36 font faces and three licences for the
  offline cache. No font assets have been acquired or generated in this stage.
  Final font manifests, axes, coverage, byte sizes, measurement values and exact
  fonttools commands remain to be audited and recorded after authorization.
- New presentation fields can be added to the shared schema/defaults without a
  database migration. Changes outside the colour fields default to layout work;
  SLN-502's exact fixed-format fields and policies remain with that issue.

## Completion Notes

Pure checkpoint only. The database schema/migration, server actions, saving,
drawer/Settings UI, font files, document style pass, owned adapter reflow,
decoration integration and cover-spread patch are not implemented here.

Checkpoint validation: 102 focused tests passed in nine files, zero skipped,
in 864 ms. The focused TypeScript check, source ESLint with zero warnings and
Prettier check passed. These checks cover pure policies only. Full typecheck/
lint/deadcode, the zero-skip database suite, default Mac production build,
Docker/CI, native browser/audit/performance acceptance and deployment are still
gated.

Migration 0085_reader_preferences is reserved, not generated. No live or cloud
writes were performed. The primary checkout and manual server are untouched.

## Schema review packet (additive preparation)

`src/lib/db/schema/reader-preferences.ts` is the exact proposed declaration,
exported from the schema index and documented in docs/02. It declares the five
ticket columns, the named device-class CHECK, NULLS NOT DISTINCT scope unique
key, cascade FK and e-book index. No extra custom SQL, JSON CHECK, function,
trigger or user/device column is proposed for 0085. Generation waits for the
coordinator's schema approval and prerequisite migration sequence. The migration
test's added-tables list will be amended with generation, then run on the
disposable database; no present database has this proposed table yet.

Shared presentation now includes SLN-502's exact fixed fields:

| Field           | Validation          | Desktop | Tablet | Phone   |
| --------------- | ------------------- | ------- | ------ | ------- |
| `fixedFit`      | `page`, `width`     | `page`  | `page` | `width` |
| `cropMargins`   | `auto`, `on`, `off` | `auto`  | `auto` | `auto`  |
| `pdfThemePages` | boolean             | `true`  | `true` | `true`  |

Zoom is ephemeral. SLN-502 owns applying these policies to PDF/comic documents;
this task validates, layers, edits and persists their values with the rest of
the shared JSON. Defaults remain Literata with font sizes 20/19/18 px, margins
48/40/16 px and spread auto/auto/none for desktop/tablet/phone respectively.

### Actor and scope

Docs/01 explicitly defines a single-user app gated by external Authelia at the
reverse proxy, with no application user/session model. Preference actions follow
that existing boundary and Next's same-origin action checks. A device class is
an explicit validated action input because Settings can edit any class; it is
not an actor ID. A reader fixes the detected class once per open. Book IDs and
the optional defaults action's `clearBookOverrideId` must be valid UUIDs and
refer to existing e-books before writes. A read for an open book returns only
its three possible rows and the three defaults, never an unbounded library
scan. A Settings override list is a separate bounded/paginated query.

### Atomic writes and overlapping devices

Proposed server actions read the relevant default/book rows first, including
absent scopes, and plan a field patch against their current values. Defaults
are repaired into a complete validated presentation; book rows remain partial
and nonempty. Every writer, reset and cookie adopter uses the same class lock
`pg_advisory_xact_lock(hashtextextended('reader-preferences:' || device_class, 0))`
inside the existing `atomic()` batch. The next batch statement asserts the
exact snapshot for every affected scope: row ID, JSONB value and updated_at,
or continued absence. Read a database-computed fingerprint of those JSONB rows,
including `updated_at::text`, rather than round-tripping timestamp precision
through a JavaScript Date. The assertion uses the existing `harmonization_assert`
function with a distinct internal retry message; no new migration function.
After a lock waits, the next statement sees the winning writer's committed
rows under PostgreSQL READ COMMITTED, so an outdated snapshot aborts the whole
batch. Only that conflict is retried, with a fresh read/merge and a bounded
three attempts. Other failures return readable action errors. No Neon
interactive transaction, precomputed full-row last-write-wins update or
catalogue activity event is used.

Updating defaults while the open book has overrides applies only the edited
fields to the defaults and removes those exact fields from that book row in
one batch; other book fields survive and an empty row is deleted. The optional
`clearBookOverrideId` is valid only for defaults writes. Resetting a book deletes
its row. Resetting defaults upserts the built-in full class defaults, retaining
a defaults row so a late legacy cookie cannot undo the reset. Successful actions
read and return the actual scoped rows, so a caller does not invent the stored
result.

### Cookie adoption and pending edits

Adoption reads `durtal-reader-settings` from the actual server request rather
than accepting a new presentation from the client. Parse the cookie's JSON
(including the existing URI-encoded cookie form); validate the old five choices
and map them with `fromLegacyReaderSettings`. Malformed legacy data maps to the
class defaults. The insert takes the same class lock and uses ON CONFLICT DO
NOTHING: the first existing/adopted defaults row wins. A cookie already absent
is an idempotent read. The client deletes the cookie only after an acknowledged
successful adoption/read; failures keep it for retry. No source writes that
cookie after integration, and Display reset excludes it from clearing.

The hook must retain pending patches separately from acknowledged rows, preview
immediately, and serialize the debounced 800 ms saves per class/scope. While a
request is in flight, subsequent edits stay pending; a response acknowledges
only the captured patch generation. On failure that generation remains pending
and retry occurs on the next change or `online`. A late response must not
replace a newer pending edit or reset. Scope/file switches flush or retain the
correct original scope rather than sending a patch to a new book. Adoption
completes before the first write for that class; edits during it stay queued
and are applied over the returned rows. No `setPresentation` from a stale save
response, position write or tracker activity is permitted.

This packet contains declaration/default source and a concurrency proposal,
not implemented server actions or a claim of migration/native acceptance.

The coordinator relayed independent PURE_SOURCE_APPROVE for immutable checkpoint
`e2065663e78dfde526a068ae410f38e8e8a9ccb2`: 106 tests, zero skipped
(the original 102 plus four adversarial review checks). Font assets/metrics,
reversible styling, persistence and owned reflow remain integration gates.

Additive schema preparation validation: 103 focused tests in nine files,
zero skipped, 284 ms. Focused TypeScript includes the actual Drizzle declaration
and its imported schema dependencies; it passed. Changed source ESLint with
zero warnings, Prettier and `git diff --check` passed. Full mandatory gates
remain reserved for the coordinator's heavy slot.
