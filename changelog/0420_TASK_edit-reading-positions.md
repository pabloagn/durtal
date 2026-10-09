# Task 0420: Edit a reading’s start and current position

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: SLN-444, SLN-447
**Blocks**: None

## Overview

SLN-475 adds starting position, current position and chapter to Edit reading, with a live starting-position line that includes the unit and total. No migration or dependency changes.

## Implementation Details

- `updateReadingSchema` accepts one starting unit and a strictly single-unit `currentPosition`, plus a validated chapter. Existing current-column inputs remain forbidden.
- `updateReading` checks the submitted fingerprint and writes metadata, session correction and recomputed starts in one atomic batch. Invalid positions, stale reads and missing logs cannot leave metadata partially saved. Smaller totals can be submitted with matching start/current corrections.
- `correctLastLog` uses the latest completed session, keeps its identity, dates, duration, note, format and edition, and maps corrections to another session edition through the share of the work. Only a meaningful current-position correction of a reader-generated log makes its source manual; this intentional manual provenance is reflected in exports. Chapter-only edits and unchanged current fields preserve source and progress. Chapter edits target the last session that contributed to the effective position, leaving ignored reader logs intact. Automatic reader logs retain their existing behind-progress rule.
- Start edits run `recomputeQueries`, keeping counted pages tied to the reading’s new start. Running timers cannot be edited. Current-position edits without completed logs are refused; the dialog disables those controls and explains how to proceed. Start and chapter can be edited before a first log.
- Corrections can move backward or forward, and keep paused/finished/abandoned status and status history unchanged. Session totals remain historical unless the corrected session is in the reading’s current edition. Current percentages normalize to revised totals when required.
- Existing edition/copy changes, quote refiling, progress logging, imports, timer and ebook route contracts were audited. Unchanged position fields are not submitted as corrections on an edition-only edit.
- The dialog uses the existing glass surface, scrolling body, inputs, selects, focus treatment and coarse-pointer targets; its new two-column field rows stack on narrow screens. Units remain visible in controls and the live preview.

## Completion Notes

Lightweight validation: 100 focused dialog/position/timer/reader regression tests passed; typecheck passed; lint passed with no errors and the existing warning baseline. Chapter edits can be cleared without removing earlier session chapters. Disposable database cases cover pages/percent/minutes, counted pages, backward/forward corrections, different editions, no latest log, closed readings, simultaneous total changes, invalid inputs and stale fingerprints.

Independent review fixes cover chapter-only/unchanged-field edits after ignored reader logs, simultaneous edition/audio-duration/start changes (90 of 120 minutes and 30 of 120 minutes), and sessionless smaller totals with a derived disabled current-place preview. Added disposable database cases assert stale/error integrity, unchanged ignored-session provenance/progress, counts and status history. Those database cases await the heavy slot.

Required heavy validation remains pending the coordinator’s slot: production/Docker build, disposable-app responsive interaction/alignment/page-weight QA, and full zero-skipped `pnpm test:local`. Independent review and an explicit merge slot are required before integration.
