import { describe, expect, it } from "vitest";
import { parseLoanNote, pastLoanLine, pastLoans } from "@/lib/catalogue/loans";

// SLN-1125: a copy's loans live in its status history, the borrower and the
// lending date in the note of the row that ends each loan.
describe("a copy's loans", () => {
  it("reads the borrower and the date back from a loan note", () => {
    expect(parseLoanNote("Lent to Léon from 2026-10-18")).toEqual({ lentTo: "Léon", lentDate: "2026-10-18" });
    expect(parseLoanNote("Lent to Anne from Lyon from 2026-10-18")).toEqual({ lentTo: "Anne from Lyon", lentDate: "2026-10-18" });
    expect(parseLoanNote("Lent to Léon")).toEqual({ lentTo: "Léon", lentDate: null });
    expect(parseLoanNote("Lent from 2026-10-18")).toEqual({ lentTo: null, lentDate: "2026-10-18" });
    expect(parseLoanNote("Lent")).toEqual({ lentTo: null, lentDate: null });
    expect(parseLoanNote("ebook operation 12")).toBeNull();
    expect(parseLoanNote(null)).toBeNull();
  });

  it("lists the loans that ended, newest first", () => {
    const day = (at: Date) => at.toISOString().slice(0, 10);
    const loans = pastLoans(
      [
        { fromStatus: "available", toStatus: "lent_out", changedAt: "2026-01-02T10:00:00Z", notes: "Lent to Anne from 2026-01-02" },
        { fromStatus: "lent_out", toStatus: "available", changedAt: "2026-02-01T10:00:00Z", notes: "Lent to Anne from 2026-01-02" },
        { fromStatus: "lent_out", toStatus: "missing", changedAt: "2026-11-02T10:00:00Z", notes: "Lent to Léon from 2026-10-18" },
      ],
      day,
    );
    expect(loans).toEqual([
      { lentTo: "Léon", lentDate: "2026-10-18", endedOn: "2026-11-02" },
      { lentTo: "Anne", lentDate: "2026-01-02", endedOn: "2026-02-01" },
    ]);
  });

  it("says who had it and when, with the year only when it is not this year's", () => {
    expect(pastLoanLine({ lentTo: "Léon", lentDate: "2026-10-18", endedOn: "2026-11-02" }, "2026-11-05")).toBe("Lent to Léon, 18 Oct to 2 Nov");
    expect(pastLoanLine({ lentTo: "Léon", lentDate: "2026-11-02", endedOn: "2026-11-02" }, "2026-11-05")).toBe("Lent to Léon on 2 Nov");
    expect(pastLoanLine({ lentTo: null, lentDate: null, endedOn: "2025-11-02" }, "2026-11-05")).toBe("Lent to someone, until 2 Nov 2025");
  });
});
