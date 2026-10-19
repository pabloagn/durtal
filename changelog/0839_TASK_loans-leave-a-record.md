# Task 0839: Loans leave a record

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0838
**Blocks**: None

## Overview

SLN-1125, from findings/copies-locations-survey-2026-10-18.md (findings 1, 3 and 7). A returned copy kept its borrower hidden in the database. Copy status changes were never written to `instance_status_history`. Nothing listed the copies out on loan. The status menu always lent from today, while Edit left the lent date empty. A loan with no name showed an empty "On loan" caption.

## Implementation Details

- `updateInstance` (`src/lib/actions/instances.ts`) writes an `instance_status_history` row whenever an edit changes the status. The row goes in the same `atomic` as the update, written first so it reads the status it changes from. A lend notes the new borrower and date; the change that ends a loan notes the stored ones ("Lent to Léon from 2026-10-18"). Any status but Lent out then clears `lent_to` and `lent_date`. No schema change.
- `src/lib/catalogue/loans.ts`: the note in SQL (`loanNoteSql`), read back (`parseLoanNote`), the loans that ended (`pastLoans`) and their line ("Lent to Léon, 18 Oct to 2 Nov").
- The book page loads each copy's history rows from Lent out, and the copy shows its loans. The loan now uses the reading pages' words (`copyWhereabouts`: "Lent to someone" with no name), followed by the loans that ended.
- The status menu offers "Mark as returned" on a lent copy. The Lend dialog gains a Lent date, defaulting to today. In Edit, choosing Lent out fills an empty Lent date with today.
- The library's Holding filter gains "Lent out" (`holding=lent_out`, in the API too): books with a copy out on loan.
- docs/02: the lent-out query uses `i.status = 'lent_out'`, and `instance_status_history` says what writes it. docs/05: the `holding` values.

## Completion Notes

- Database tests: lend, return and deaccession leave three history rows, the borrower kept on the first two and cleared from the copy; an edit that keeps the status writes none; a nameless loan notes "Lent"; `holding=lent_out` lists the lent book. The location copies, library reading, write routes and book page suites pass.
- Checked in Chromium, Firefox and WebKit: lend, the loan shown, Mark as returned (focus on the menu's button, the borrower cleared, two history rows), the loan in the copy's history after a reload, "Lent to someone", and the library's Lent out list.
- Audits clean on two book pages (one with a long borrower and three past loans, one lent with no name) and `/library?holding=lent_out` at 1440, 390 and 320. Page weight passes.
- The library lists the books; who has each copy and since when is on its book page. The library cards stay as they are.
