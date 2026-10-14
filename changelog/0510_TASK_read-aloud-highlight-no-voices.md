# Task 0510: Read aloud highlights its sentence and says when there is no voice

**Status**: In Progress
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-679, from the e-book review of 13 Oct. With no voices on the device,
read aloud started anyway. It then said "Read aloud stopped: the voice failed.
Try another voice." while the voice menu said "No voices available on this
device". The sentence being read had no highlight. Pausing turned it into a
real selection, which opened the selection toolbar over the speech bar.

## Implementation Details

- No voices (`src/lib/reader/speech/session.ts`):
  - `toggle` and `startSelection` open the player without playing when the
    device has no voice at all, natural voices included;
  - the speaker reports `no-voice` instead of trying one, as a safety net;
  - the player (`player.ts`) pauses on `no-voice` with no message and no
    retry;
  - the player and the voice menu say "No voices on this device."
- The sentence being read is a `speech` decoration, highlighted in the
  theme's link colour at the highlight opacity, both while it plays and when
  it is paused or shown. It is drawn once its page is shown, and "clear" (stop,
  or a new place) removes it. It is never a selection, so pausing opens no
  toolbar. The touch-only `selectsSentences` option is gone, since no device
  selects any more.

## Completion Notes

- Checked headless:
  - WebKit (4 voices) at 1440 and 390 px: playing and paused both show one
    highlighted sentence with nothing selected. Next sentence moves the
    highlight, and Esc clears it.
  - Chromium (no voices) at 1440 and 390 px: `a` opens the player with "No
    voices on this device." and nothing plays; the old voice-failed message
    no longer appears.
- WebKit, 150 "Next sentence" presses: page-follow stays on spread
  boundaries within a section at 1440 and 1280 px. Crossing into the next
  section at 1280 px still lands on a half-spread, with the end of the last
  section on the left. Contents jumps land the same way (noted in 0505). It
  is the vendored paginator's jump into an adjacent rendered section, so it
  stays open here.
- The alignment, design and overflow audits are clean with the player open
  at 1440, 390 and 320 px in Chromium, Firefox and WebKit.
