import { sql, type SQL } from "drizzle-orm";
import { formatReadingDate } from "@/lib/reading/dates";

/**
 * A copy's loans, kept in `instance_status_history` (SLN-1125). The row that
 * lends a copy, and the row that ends the loan, carry the borrower and the
 * lending date in `notes`: "Lent to Léon from 2026-10-18". Either part can be
 * missing ("Lent to Léon", "Lent from 2026-10-18", "Lent").
 */

/** The note for a loan, in SQL: what `parseLoanNote` reads back */
export function loanNoteSql(lentTo: SQL, lentDate: SQL): SQL {
  return sql`concat_ws(' ', 'Lent', 'to ' || nullif(btrim(${lentTo}), ''), 'from ' || (${lentDate})::text)`;
}

const NOTE = /^Lent(?: to ([\s\S]+?))?(?: from (\d{4}-\d{2}-\d{2}))?$/;

/** The borrower and lending date in a loan note, or null for any other note */
export function parseLoanNote(notes: string | null): { lentTo: string | null; lentDate: string | null } | null {
  const match = notes ? NOTE.exec(notes) : null;
  return match ? { lentTo: match[1] ?? null, lentDate: match[2] ?? null } : null;
}

export interface StatusChange {
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date | string;
  notes: string | null;
}

export interface PastLoan {
  lentTo: string | null;
  lentDate: string | null;
  /** When it came back (or the copy left lending another way), as a day */
  endedOn: string;
}

/** The loans that ended, newest first: each change that took a copy off "Lent out" */
export function pastLoans(history: StatusChange[], dayOf: (at: Date) => string): PastLoan[] {
  return history
    .filter((h) => h.fromStatus === "lent_out" && h.toStatus !== "lent_out")
    .map((h) => ({ at: new Date(h.changedAt), loan: parseLoanNote(h.notes) }))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .map(({ at, loan }) => ({ lentTo: loan?.lentTo ?? null, lentDate: loan?.lentDate ?? null, endedOn: dayOf(at) }));
}

/** "Lent to Léon, 18 Oct to 2 Nov"; the year shows when it is not this year's */
export function pastLoanLine(loan: PastLoan, today: string): string {
  const day = (date: string) => formatReadingDate(date, "day", { omitYear: date.slice(0, 4) === today.slice(0, 4) });
  const who = `Lent to ${loan.lentTo?.trim() || "someone"}`;
  if (loan.lentDate === loan.endedOn) return `${who} on ${day(loan.endedOn)}`;
  return loan.lentDate
    ? `${who}, ${day(loan.lentDate)} to ${day(loan.endedOn)}`
    : `${who}, until ${day(loan.endedOn)}`;
}
