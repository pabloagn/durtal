# Task 1030: Editions on a book page

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-1132, from findings/editing-works-editions-survey-2026-10-18.md (items 14 to 16). Editions without years listed in the order of their random ids. On a phone, an edition card was about 400px tall, mostly empty Quotes and Copies sections. Add edition started in English with the work's title, even for a French work, and choosing another language left "This is a translation" unticked.

## Implementation Details

- `src/lib/actions/works.ts` (`workDetailWith`): a book's editions sort with the original-language ones first, then by year (newest first, editions with no year after), then by title, then by id. The quotes' edition groups follow the same order (SLN-480).
- `edition-detail-card.tsx` and `edition-quotes.tsx`: an edition with no copies and no quotes or notes shows one line, "No quotes or copies yet · Add a quote", in place of its two sections. Add instance stays in the card's action bar as the copies' focus fallback. The cover sits beside the title from a 280px card up; it was stacked below 400px.
- `edition-add-dialog.tsx` and `edition-form.tsx`: a new edition starts in the work's original language (else the new-book language). Its Title starts empty with the work's title as the placeholder, and an empty Title saves as the work's title. Choosing a language other than the work's ticks "This is a translation", and choosing the work's language unticks it; either can be changed by hand afterwards. Both Add edition entry points pass the work's language.

## Completion Notes

- Database test (`book-links`): five editions without years, or with equal years, list in the same stable order on every load, the original language first.
- At 390 with touch, an edition with nothing in it went from 466px to 241px (299px with a three-line title). Three such cards take about 760px; they took about 1,400px.
- Checked in Chromium, Firefox and WebKit: the order after reloads, the folded line, and Add edition on a French work (starts in French, unticked; English ticks it; back to French unticks it; an empty Title saves as "Against Nature").
- Alignment, design, overflow, layout and touch audits clean on two book pages at 1440, 390 and 320. Page weight passes. Unit tests pass.
