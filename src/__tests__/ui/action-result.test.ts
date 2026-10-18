import { describe, expect, it } from "vitest";
import { z } from "zod";
import { actionResult } from "@/lib/actions/action-result";
import { ExpectedActionError } from "@/lib/actions/expected-error";

describe("expected server-action refusals", () => {
  it("returns successful values unchanged", async () => {
    expect(await actionResult(async () => ({ id: "saved" }))).toEqual({
      ok: true,
      value: { id: "saved" },
    });
  });
  it("returns deliberate business rules as data", async () => {
    expect(
      await actionResult(async () => {
        throw new ExpectedActionError("This reading is already open");
      }),
    ).toEqual({ ok: false, error: "This reading is already open" });
  });
  it("extracts our database rule without leaking the SQL wrapper", async () => {
    const cause = Object.assign(
      new Error("This film already has an unlabelled version"),
      { code: "P0001" },
    );
    const result = await actionResult(async () => {
      throw new Error("Failed query: private SQL and parameters", { cause });
    });
    expect(result).toEqual({ ok: false, error: cause.message });
  });
  it("never exposes built-in constraint details", async () => {
    const cause = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "private_table"',
      ),
      { code: "23505" },
    );
    expect(
      await actionResult(async () => {
        throw cause;
      }),
    ).toEqual({ ok: false, error: "This would duplicate an existing record" });
  });
  it("returns validation messages without property paths or supplied values", async () => {
    expect(
      await actionResult(async () =>
        z.string().min(1, "Give the publisher a name").parse(""),
      ),
    ).toEqual({ ok: false, error: "Give the publisher a name" });
  });
  it("rethrows unclassified failures, even ones that look like business text", async () => {
    for (const error of [
      new Error("This reading is already open"),
      new TypeError("Private server detail"),
    ])
      await expect(
        actionResult(async () => {
          throw error;
        }),
      ).rejects.toBe(error);
  });
});
