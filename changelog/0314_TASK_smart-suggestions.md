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
service and no language model. Migration `0071_reading_suggestions` (to be
renumbered 0072 at merge, after SLN-405's 0071) adds `recommendation_feedback`
and two `app_settings` columns.

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

RESULTS
