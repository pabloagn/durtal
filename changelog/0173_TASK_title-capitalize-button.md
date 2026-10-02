# Task 0173: Title capitalize button

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
Every book title field has a small "Aa" button at its right end. One press capitalizes the title correctly: "the man without qualities" becomes "The Man Without Qualities", and small words such as "the", "of" and "with" stay small in the middle.

## Implementation Details
- Rules: `src/lib/utils/title-case.ts` (`capitalizeTitle(title, language?)`), pure module, tests in `src/__tests__/utils/title-case.test.ts`.
- English titles get title case. First and last words and the first word after `:`, `?`, `!`, a dash or `/` get a capital. Articles, coordinating conjunctions, `as`, `to` and short prepositions (at, by, from, in, into, of, on, onto, per, upon, via, vs, with) stay small. Longer prepositions get a capital, as publishers print them ("Without", "Over", "Under", "About").
- Typed capitals stay: "McCarthy", "USA", "H.P.", "1Q84". A title in capitals ("THE TRIAL") is rewritten from small letters. Roman numerals become capitals ("Vol. II"). Compounds: "Slaughterhouse-Five", "Out-of-Print", "Auto-da-Fé".
- Subtitles without a colon (common in ISBNdb data): a typed capital "A", "An" or "The" after a noun starts a subtitle and stays ("Infinite Jest A Novel"). "Justine, or The Misfortunes of Virtue": the word after "or," starts a second title.
- Other languages use sentence case. A capital there can mark a name, so only safe changes are made: first word capital, articles and prepositions small, other words as typed (all capitals become small letters).
- The language comes from the words first (English vs Spanish, French, Italian, Portuguese, German function words), and from the form's language field only when the words do not decide. The field is often wrong for titles ("fr" for "The Great Gatsby", "es" for "Fictions").
- UI: `src/components/shared/title-input.tsx` (`TitleInput`), built on a new `suffix` slot in `src/components/ui/input.tsx`. The button types the result in as an edit, so Cmd+Z undoes it. It is dimmed when the title is already correct. Focus stays in the field.
- Used on: Edit Work and quick edit (title), edition form (title, subtitle), Add Book wizard (title), series dialog (title, original title), new order (title).

## Completion Notes
- Ran the rules on all 1,308 work, edition and subtitle titles in the database (no writes). 35 would change; about 30 are fixes ("Brave new world", "The Rings Of Saturn", "A Good Man is Hard to Find"). Known misses: single-word acronym titles in capitals ("VALIS" becomes "Valis"), foreign titles stored with language "en" ("Vivir abajo"), and a subtitle that starts with a preposition and has no colon.
- Browser on :3100: Edit Edition, Edit Work, Add series and Add Book wizard. The icon center is 0.18px from the input text's cap-height center; the button inset is 4px on the right, top and bottom.
