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
