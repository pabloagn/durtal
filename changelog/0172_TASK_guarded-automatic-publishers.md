# Task 0172: Guarded automatic publisher decisions

**Status**: Completed
**Created**: 2026-10-01
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0170, 0171
**Blocks**: None

## Overview
Books added by ISBN kept their ISBNdb publisher as plain text: 290 of 412 editions with a publisher name had no house. The owner chose "automatic when safe, ask when not". Metadata sources send distributors, platforms, placeholders, cut-off text and wrong books, so every automatic decision passes guardrails, is logged, and can be undone.

## Implementation Details
- Engine: `src/lib/publishers/resolution.ts` (server module, no Next.js cache use; shared by actions and the script). Name checks: `src/lib/publishers/names.ts` (`publisherNameProblem`, `cleanPublisherName`, `relatedPublisherKeys`, `sameBookTitle`).
- Automatic link (alias): exactly one house has a similar loose name, the ISBNs point at no other house, the name passes the guardrails, and every edition title matches its work title.
- Automatic house (create): no house is similar or related (shared two-word phrase, not a place; or the same distinctive first word), every edition has a valid ISBN that no house uses, at most two ISBN publishers, no other new name shares the ISBN (other spellings of the same name excepted), titles match, guardrails pass. Spellings of one new publisher share one house; close new names ("Seix Barral", "Seix Barral - Argentina") are held. The house gets the cleaned name and keeps the source spelling as alias.
- Guardrails hold: placeholders ("Unknown", "[s.n.]"), print-on-demand and self-publishing platforms, distributors, parent labels (Courier Corporation, National Geographic Books), "a division of" text, cut-off or full-width junk, more than one name or a place, web addresses, numbers, a publisher equal to the book's author, and edition titles unlike the work title (a wrong book).
- Runs after `createEdition`, `rematchEdition`, `updateEdition` (publisher, imprint or ISBN changed) and Fast Track, with a brake of 20 new houses per 24 hours. Failures never block adding a book; the name stays in the inbox.
- Migration `0034_publisher_name_rules` adds `publisher_auto_decisions` (one row per name ever; undo sets `undone_at`). A name with a row is never decided automatically again. Automatic decisions never save ISBN rules.
- Undo removes the alias, or deletes the created house with its automatic links while nothing else depends on it (no confirmed links, targets, imprints, rules, specialties or added details; not a merge survivor).
- Inbox: "N names can be decided safely" panel with one Apply button; each row shows "Safe to decide" or "Needs you" with the reason; "Automatic decisions" log with Undo. Publisher pages say when a house was created automatically. Manual "Create" also uses the cleaned name.
- Script: `pnpm exec tsx --tsconfig tsconfig.json scripts/publishers/auto-resolve.ts` prints the plan; `--apply` writes it.
- `docs/02_DATA_MODEL.md` updated.

## Completion Notes
- Dry run on a copy of live data (290 editions without a house, 124 names): 21 links to similar houses, 57 new houses (Maclehose and MacLehose Press share one), 115 editions linked; 46 names (175 editions) left for a person: Penguin spellings, Knopf Doubleday, National Geographic, HarperCollins and Vintage imprints, platforms and unclear names.
- Plan review found and fixed before any write: duplicate houses for spellings of one publisher, imprints of Penguin Random House not recognized, false family matches ("A&C Black" and "Black Coat Press", "University of Oklahoma" and "University of California", "New York" places), full-width junk and parent labels.
- Browser checks on the copy: Apply linked 115 editions and created 57 houses; Undo returned "47North" to the inbox as "Needs you"; the publisher page shows the automatic origin. Alignment audit: 0 deviations over 0.5px; 124 checkboxes within 0.5px.
- Tests: guardrail unit tests and database tests for automatic links, clean houses, every hold reason, spellings sharing a house, close names, wrong books, the daily brake, dry runs and undo. Full suite: 735 passed.
