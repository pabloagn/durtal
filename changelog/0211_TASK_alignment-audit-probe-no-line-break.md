# Task 0211: Alignment audit probe adds no line break

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0206
**Blocks**: None

## Overview
The baseline probe from task 0206 was a zero-height `display:inline-block` span after the first character of a text node. An inline-block is an atomic inline, and an atomic inline adds a line break opportunity. In a shrink-fit box with `white-space: normal`, the min-content width then drops to the longest piece of the text. The box can shrink, and the text wraps after the first character.

On `/library` at 1024x768, the "Recent" sort button (a `display:block` flex item) shrank from 65.98px to 57.19px. "R" moved up to line 1 (top 151) and "ecent" went to line 2 (top 171). The audit reported 5 rows at +10.09px: the four view-mode icons and the search icon. Without the probe, these icons are +0.09px from the cap center.

## Implementation Details
- `baseline()` in `scripts/qa/alignment-audit.js` now inserts an empty inline (`all:unset;font-size:0;line-height:0`) right after the character. Its box has no height and its top is the baseline. It is not an atomic inline, so it adds no line break opportunity.
- The empty inline does not cut the text shaping. "R" and "e" keep their kerning: the split text node alone moves "e" by 0.016px (1/64px rounding). The inline-block cut the kerning and made the button 0.22px wider.
- `line-height:0` keeps the inline box from making the line taller when the inherited line height is a length.
- No change: the flex and grid wrapper, the split and join of the text node (React keeps the same node objects), the cap center formula, the output.
- Tried and rejected:
  - U+2060 WORD JOINER text nodes on both sides of the inline-block: Chrome still breaks there (same 57.19px width, same wrap).
  - `white-space: nowrap` or `text-wrap-mode: nowrap` on the probe: no effect.
  - `white-space: nowrap` on the text's element, or on a span around the character, the probe and the next character: no wrap, but the inline-block still cuts the kerning, and nowrap on the element changes text that has more than one line.
- Probe position, checked in a test box (16px sans): after the character, the probe stays on that character's line when the line breaks right after it (CJK text in an 18px box, a span that starts line 2, text after a leading space). Before the character, the probe went to the previous line in the leading-space case. So the probe stays after the character.

## Completion Notes
Measured on the dev server (:3100) with the 0206 script and the new script, rows paired by icon position. Instrumented copies of both scripts recorded, for each row, the first character, the next character, the last character of the text node, the icon and the text's element, before and while the probe is in place. A probe "moved layout" if one of these moved by more than 0.001px or the probe was not on the first character's line. Headless runs use Chrome for Testing with `--force-device-scale-factor` (see 0206), on the 11 pages of 0206.

| Run | Rows | Issues old → new | Offsets changed | Probe moved layout, old → new |
|---|---|---|---|---|
| Claude browser pane, ratio 1, `/library` 1024x768 | 26 | 5 → 0 | 5 (+10.09 → +0.09) | 5 → 0 |
| Claude browser pane, ratio 1, `/library` 1440x900 | 27 | 0 → 0 | 0 | 0 → 0 |
| Headless, ratio 1, 11 pages, 1440x900 | 389 | 0 → 0 | 0 | 0 → 0 |
| Headless, ratio 2, 11 pages, 1440x900 | 389 | 0 → 0 | 0 | 0 → 0 |
| Headless, ratio 1, 11 pages, 1024x768 | 388 | 5 → 0 | 5 (+10.09 → +0.09) | 10 → 0 |
| Headless, ratio 2, 11 pages, 1024x768 | 388 | 5 → 0 | 5 (+10.09 → +0.09) | 10 → 0 |

- The new probe is on the first character's line in all 1607 rows, and nothing moved in any row.
- Every row the old probe left alone has the same offset with both scripts, at ratio 1 and 2. So the top of the empty inline is the same baseline as the bottom of the inline-block.
- At 1024px the old probe also wrapped 5 more rows after the first character: the favourite button beside "Amphetamine Sulphate" on `/publishers` and 4 addresses on `/places`. Their first line did not move, so their offsets were correct.
- "Recent", direct check in the browser pane at 1024px: no probe, "R" and "e" at top 161. Old probe, tops 151 and 171. New probe, tops 161 and 161, probe top 175. The inline-block gives 175 too when the button has `white-space: nowrap`.
- After each run the body HTML is the same, and every text node is the same object with the same data.
- No row is over 0.5px in any run.
- Not covered: the same 4-level limit as in 0206 (the location card buttons).
