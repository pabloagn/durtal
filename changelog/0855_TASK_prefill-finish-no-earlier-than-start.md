# Task 0855: Prefill Finish no earlier than the start

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: Task 0854 (SLN-927)
**Blocks**: None

## Overview

SLN-928: when a reading started in Amsterdam on 16 October is finished from Los Angeles while it is still 15 October there, the Finish dialog must open on 16 October and allow submission.

## Implementation Details

- The default is the later of the browser's reading day and the stored start. An explicit finish date supplied by the invoking flow remains unchanged.
- The date cap from SLN-927 permits that existing valid start after travel, without accepting arbitrary dates in the future.
- The direct `finishReading` action uses the same default when `finishedOn` is omitted, then validates the computed date against the trusted-start cap. Explicit future dates remain rejected.
- Pure default-date tests cover westward travel, an earlier/equal/unknown start, and an invalid future start still rejected by the date cap.
- Mounted Finish-dialog regressions verify the prefilled value, enabled Finish button and submitted date/timezone in Los Angeles and Amsterdam, including an unknown start. Only the clock's Date is faked; timers remain live.
- A direct-action database regression covers an omitted finish date for the Amsterdam-16-October / Los-Angeles-15-October case and verifies that an explicit later date is still refused.

## Completion Notes

Source prepared as a separate commit after reviewed SLN-927 source. Tests and typecheck have not run; the heavy slot belongs to the performance lane. Combined targeted validation and subsequent full-suite/browser checks remain required before landing. No database, live catalogue or service changes.

### Combined date validation — 17 October 2026

Grant #9 ran the reviewed date source and implicit-server-default follow-up against fresh disposable PostgreSQL. **All 170 tests passed in 9 suites, with 0 skips; serial `pnpm typecheck` passed.** The database runner removed its container and volumes. No build, browser or live application process was started.

| Suite | Passed |
| --- | ---: |
| `integration/reading.test.ts` | 63 |
| `integration/reading-routes.test.ts` | 9 |
| `ui/search-keys.test.ts` | 22 |
| `ui/reading-dialogs.test.ts` | 31 |
| `ui/unsaved-changes.test.ts` | 19 |
| `reading/dates.test.ts` | 11 |
| `reading/future-dates.test.ts` | 8 |
| `ui/date-picker-limits.test.ts` | 2 |
| `reading/finish-date-default.test.ts` | 5 |

The run used Node 22.23.3 and Python 3.12.13. Command: `PATH=/private/tmp/durtal-sln569-runtime/node-v22.23.3-darwin-arm64/bin:$PATH /Users/pabloaguirre/.local/share/uv/python/cpython-3.12.13-macos-aarch64-none/bin/python3 /private/tmp/sln927-928-guarded-tests.py`, then `PATH=/private/tmp/durtal-sln569-runtime/node-v22.23.3-darwin-arm64/bin:$PATH pnpm typecheck`. The wrapper verified unchanged Python prerequisite bytes against `a426d630` and coverage of every current prerequisite before reusing the passing `/private/tmp/durtal-release-review/tests-954/summary.json` evidence. Only those prerequisites were reused; all 170 date/reading tests and database fixtures ran fresh.

Reports: `/private/tmp/sln927-928-guarded-tests/summary.json`, `vitest.json` and `vitest.log`. Test execution took 93.07 seconds; setup through cleanup took 102.20 seconds. The pre-receipt source fingerprint was `613d7afb2105ed59803e921a1078aaa4d7a4db2fd79361d4c842a0ac6f76c488`, with file hashes recorded in `/private/tmp/sln927-928-tested-source.json`, based on committed head `697da0932fd7cce6a0fdb25d556a88f6afeec828` plus the implicit-default follow-up. All tested code files were unchanged before adding this receipt.

Slot #9 is released. Full-suite, build and rendered browser/alignment/page-weight gates remain pending. Published SLN-926 was untouched.
