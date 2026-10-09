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
- Corrections can move backward or forward, and keep paused/finished/abandoned status and status history unchanged. Session totals remain historical unless the corrected session is in the reading’s current edition. Shared recomputation uses native audio minutes with the current duration, same-edition print pages with the current page count, or raw percentages for percent-tracked readings. Derived counters cannot override the primary position. Historical session totals and endpoints remain intact for chapter-only edits.
- Existing edition/copy changes, quote refiling, progress logging, imports, timer and ebook route contracts were audited. Unchanged position fields are not submitted as corrections on an edition-only edit.
- The dialog uses the existing glass surface, scrolling body, inputs, selects, focus treatment and coarse-pointer targets; its new two-column field rows stack on narrow screens. Units remain visible in controls and the live preview.

## Completion Notes

Lightweight validation: 136 focused dialog/position/timer/reader regression tests passed; typecheck passed; lint passed with no errors and the existing warning baseline. Chapter edits can be cleared without removing earlier session chapters. Disposable database cases cover pages/percent/minutes, counted pages, backward/forward corrections, different editions, no latest log, closed readings, simultaneous total changes, invalid inputs and stale fingerprints.

Independent review fixes cover chapter-only/unchanged-field edits after ignored reader logs, simultaneous edition/audio-duration/start changes (90 of 120 minutes and 30 of 120 minutes), and sessionless smaller totals with a derived disabled current-place preview. Added disposable database cases assert stale/error integrity, unchanged ignored-session provenance/progress, counts and status history. Those database cases await the heavy slot.

The second source re-review adds actual dialog-payload/session-helper coverage for an explicitly re-entered percentage after a revised total (300 of 600 → 50% of 1200 means page 600). Untouched percentage fields show the canonical revised share and chapter-only edits do not submit a position correction. Chapter edits with no contributing log remain on the reading; ignored session rows are not written, and recomputation/metadata saves preserve both named and intentionally cleared chapters. Later chapter saves retain revised same-edition percentages and the reader-behind rule, without rewriting historical session totals. Additional disposable database cases await the heavy slot.

The third source re-review fixes audio duration normalization across every shared recompute path. Sequential duration → chapter → metadata regressions retain 300 minutes at 25% of a revised 1200-minute total, including when a stale page equivalent exists. Unit-precedence cases cover print pages, audio minutes, precise raw percentages, unknown totals and mixed editions/formats. The dialog uses the canonical counters for untouched inputs and its total line, including smaller totals on percent-tracked readings. The earlier explicit-percent-after-total-change regression continues to use a native page tracker displayed as Percent; a true percent tracker separately retains its raw share. Additional disposable database regressions await the heavy slot. Typecheck passes and lint retains 0 errors / 75 baseline warnings.

The fourth source re-review fixes combined total/current saves at the exported action boundary. Requested current values no longer enter the comparison baseline: open readings compare against independent session history under the final totals/start, then correct the session and derive the final reading counters. Totals, start and current position are staged and validated as one coherent row before building any atomic write, so smaller totals never create an invalid intermediate row. Every explicit current edit without a completed log is refused before writes, including no-op values combined with totals, start and metadata. A valid explicit 100% correction can replace an out-of-bounds native counter despite its capped percentage. Twenty-one in-memory exported-action tests use real validation/correction/planning/recompute logic and check each individual row write; they cover persisted sessions, later saves, units, edition changes, statuses, reader provenance, chapters, sessionless starts and atomic stale/invalid refusals. Database cases now assert persisted session endpoints and subsequent chapter/metadata recomputation as well as combined sessionless refusal. All 136 focused tests, typecheck and lint pass (0 errors / 75 baseline warnings); database execution remains pending.

Required heavy validation remains pending the coordinator’s slot: production/Docker build, disposable-app responsive interaction/alignment/page-weight QA, and full zero-skipped `pnpm test:local`. Independent review and an explicit merge slot are required before integration.
