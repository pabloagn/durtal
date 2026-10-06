# Task 0314: Smart suggestions, predicted rating and recommender trust

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0306 (SLN-449), 0309 (SLN-452), 0313 (SLN-456)
**Blocks**: Reading tracker step 14 (SLN-458)

## Overview

Step 13 of 15 of the reading tracker (SLN-442, sub-issue SLN-457). "What
should I read next?" answered from Joris's own catalogue and history, with
reasons he can check, in one tap: next in a series, authors and
recommenders he trusts, what is at hand in the home he is in, books that
have waited on the shelf, kept varied; a predicted rating only when it can
back it up; Not now, Never and Not for me that it learns from. No outside
service and no language model. Migration `0073_reading_suggestions`
(generated on main after SLN-405's 0071 and SLN-381's 0072) adds
`recommendation_feedback` and two `app_settings` columns.

## Implementation Details

- Migration: `recommendation_feedback` exactly as the parent defines it (no
  branch had it), with `book_parent_required`; `app_settings.
  reading_suggest_hide_anathema` and `reading_prediction_gate`. The migration
  test and the book-only lists cover them; a book merge keeps the newer row
  (`recommendationFeedbackMergeQueries`).
- The engine (`src/lib/reading/suggest/`): `load.ts` (one query for every
  book), `context.ts` (`getSuggestionContext`: never cached; the gate's
  daily check), `build.ts` (C over taste evidence only, the base rate, IDF,
  the taste profile, series), `features.ts` (a registry of nine features,
  each scoring 0 to 1 with a reason and evidence, or null without data),
  `score.ts` (weighted sum, the 15% reason rule, candidates, constraints,
  MMR with λ = 0.7, Pick one for me), `params.ts` (one parser for the page
  and the API), `predict.ts` (k-NN, leave-one-out, the gate), `rereads.ts`
  and `view.ts`. Taste evidence only (`tasteRatingSql`), owned by
  `ownedBookCondition`, at hand by `at-hand.ts`.
- Pages: `/reading/suggestions` (constraints bar, the list 24 a page,
  Worth re-reading, the rated-books line, the Hidden view, Pick one for me),
  the Suggestions tab, three suggestions on `/reading`, "See suggestions" in
  Up Next's empty state, the predicted rating on an unread book's page while
  the gate is on, a recommender's track record, "Suggest a book" in the
  palette, Settings → Reading's "Hide Anathema in suggestions".
- Actions (`src/lib/actions/suggestions.ts`): `setSuggestionFeedback`,
  `removeSuggestionFeedback`, `restoreSuggestionFeedback`; `FEEDBACK_REASONS`
  in `src/lib/reading/constants.ts`.
- API: `GET /api/readings/suggestions` with the token, the page's
  constraints (400 for an unknown one), reasons, scores, features and
  evidence ids.
- `scripts/qa/suggestions-eval.ts`: the evaluation and the top 10 on a
  preview, read-only.
- Docs 02, 03, 04, 05 and 06.

## Completion Notes

- On Joris's data (the 5 Oct 2026 backup, read-only, through
  `scripts/qa/suggestions-eval.ts` on a `--from-dump` preview with no
  seeds): 690 books, none with taste evidence, as the backup has no finished
  readings. The evaluation: n 0, coverage 0%, MAE and baseline MAE none,
  gate off ("needs 30 rated books"). The first request stored that result in
  `reading_prediction_gate`; no prediction shows anywhere.
- Top 10 Owned suggestions on that data, in the order of 6 Oct 2026 (equal
  scores take an order of the day). With no home remembered: 1. The Man
  Without Qualities (0.80: Digital; First in The Man Without Qualities),
  then at 0.50 each, "Digital": Hurricane Season, Spider, Heliogabalus: Or,
  The Crowned Anarchist, Bruges-la-Morte, Ferdydurke, The Adversary, The
  Torture Garden, Beware of Pity, Madonna in a Fur Coat. At Amsterdam: 1. The
  Man Without Qualities (0.80: On your shelf in Amsterdam; First in The Man
  Without Qualities), then at 0.50 each: Las tierras arrasadas, The Atrocity
  Exhibition, Bruges-la-Morte and Beware of Pity (On your shelf in
  Amsterdam); Spider, Heliogabalus, Ferdydurke, The Adversary and The Torture
  Garden (Digital). Without ratings, acquisition dates or taxonomy, at hand
  and series are the only signals, as the issue foresaw. The engine adds the
  others by itself as readings and the taxonomy arrive.
- That run found one fault, fixed here: with nearly every book at 0.50, the
  title broke the ties, so the top ten were always the books that start with
  A, and Pick one for me drew only from them. Equal scores now take a hash
  of the day and the book: the same order all day, another the next.
- With the QA seeds (68 books with taste evidence, 47 of them a seeded 2025):
  coverage 92.6%, MAE 0.673, baseline MAE 0.654: the prediction is not 10%
  better than the mean, so the gate stays off. Forced on for the UI checks,
  the book page reads "You would likely rate it 3.5 to 4".
- Server time on the backup (690 books, 9 requests each, the final code):
  `/reading/suggestions` 143 ms median (140 to 190 ms), `/reading` 140 ms
  (133 to 155 ms); nearly all of it is `getSuggestionContext`, whose one book
  query takes about 115 ms in psql with its rows sent. Under the issue's
  300 ms.
- JIT (SLN-487): the book query runs with `set local jit = off` in its own
  transaction. Its plan cost (226,000 on 695 books) is over
  `jit_above_cost`. Today JIT about pays for itself end to end (113 to 127 ms
  with it, about 116 ms without; `explain analyze` showed 142 to 155 ms
  against 64 to 69 ms, but it leaves out building and sending the rows), so
  the page moved only from 150 to 145 ms median. The cost grows with the
  catalogue, and past `jit_optimize_above_cost` (500,000) the optimized
  compile alone takes about 200 ms, as on `/series`. With it, `explain
  (analyze)` shows no JIT section. The coordinator's suggested fix, `unnest`
  in place of a set-returning function, does not apply: the cost comes from
  the per-book subqueries.
- Page weight on a production-build preview with the same seeds before
  (#110) and after: `/` 264 KB both, `/reading` 93 then 111 KB (the three
  suggestions), `/reading/next` 46 then 47 KB, `/library` 299 KB both.
  `/reading/suggestions` is 254 KB with the gate on and every section shown
  (220 KB with the gate off), 173 KB on the backup. Every route within
  budget.
- Browsers, all headless, never a window: Chrome, Firefox and WebKit at
  1440, 768 and 390 px, 12 steps (the list, constraints, Worth re-reading,
  the filter panel, Why this?, Not for me, Pick one for me, the Hidden view,
  the hub strip, the book page line, the recommender page, the setting).
  They found, and this PR fixes:
  - "Shorter than X, which you passed on as too long" stood on almost every
    card for 30 days after one long book was passed on. It now shows in Why
    this? only; the rule still lowers longer books.
  - "Digital" or the shelf was said twice on a card, in the line and as a
    reason. The line now leaves the place out when a reason says it.
  - The Anathema mark beside a title sat 4 px off the cap-height center.
  - Why this? and `EstimateInfo` kept the browser's own popover background
    (`Canvas`), so the glass never showed, and in Firefox and WebKit, whose
    `Canvas` is lighter, `fg-secondary` text fell to 4.31:1. Both take
    `bg-transparent`, as the tooltip does.
  - Cover links had no name; they take the title, as on other cards.
  - The book page read the gate from the settings cache, which the engine's
    write cannot clear during a render, so a gate turned on could stay hidden
    there for up to an hour. It reads the gate fresh (`predictionGateOn`).
  After the fixes: no alignment deviation over 0.5 px, no contrast flag, no
  unnamed control, no overflow. WebKit's console errors are the covers the
  preview has no S3 image for, and, on the book page, link prefetches it
  cancels on leaving, as in the SLN-452 run.
- Journeys: `reading` with its new suggestion steps (See suggestions from an
  empty Up Next, about 500 pages at hand in Amsterdam, Why this?, Not now,
  Not for me with a reason, Undo in the Hidden view, Pick one for me
  started), `import`, `perfumes`, `films` and `paintings` pass. The journey
  helpers now tick a filter option by its label and take the dialog on
  screen: every suggestion's hidden Why this? popover is a dialog too.
- Seen on the way, not changed here (SLN-487): `/series` takes about 220
  ms on a preview whose statistics are fresh, because Postgres JIT-compiles
  `getSeriesSuggestions` (it estimates 1,000 rows for each
  `regexp_split_to_table`): 218 to 232 ms with JIT against 5 ms without, end
  to end. Another thread fixes it on main.
- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL
  16), on the branch merged with main at 25b2438: 220 files and 2,480 tests,
  none skipped. New: the database suite `reading-suggestions` (12: the
  context's numbers are numbers; the Owned scope leaves out a deaccessioned
  copy; a copy added at the home is at hand on the next call; Never, Not now
  and Not for me hide, Not now expires, removing a row brings the book back;
  a second verdict replaces the first; the Hidden view; a merge keeps the
  newer row; the gate is written at most once in 24 hours and read fresh for
  the book page; the rated-books line equals its library link's count; the
  API's 401, 400 and suggestions) and the unit suite `suggest` (27: each
  feature and its threshold, the 15% reason rule, the weighted sum, MMR and
  the order of the day, the constraints and their parser, the too-long and
  author-pause rules, k-NN and the gate's hysteresis, re-reads, taste
  evidence only, Pick one for me with no ratings). `pnpm typecheck` and
  `pnpm deadcode` are clean; `pnpm lint` has 81 warnings, as on main.
- Migration: generated with `pnpm db:generate` on main as
  `0073_reading_suggestions` (after 0071 and 0072); its SQL is the same as
  the first generation, with `book_parent_required` as custom SQL after a
  statement breakpoint, and its snapshot chains to 0072. Every preview above
  rehearsed it on the backup (`--from-dump`).
