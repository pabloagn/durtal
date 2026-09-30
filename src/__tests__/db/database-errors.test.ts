import { describe, it, expect } from "vitest";
import {
  readableDatabaseError,
  withReadableErrors,
} from "@/lib/db/errors";

/** The shape the ORM produces: SQL in the message, the database error as cause. */
function wrapped(code: string, message: string) {
  return new Error(`Failed query: update secret set x=$1\nparams: private`, {
    cause: Object.assign(new Error(message), { code }),
  });
}
describe("readable database errors", () => {
  it("passes our trigger and assertion messages through without SQL", () => {
    const error = readableDatabaseError(
      wrapped("P0001", "The end date cannot precede the start date"),
    ) as Error;
    expect(error.message).toBe("The end date cannot precede the start date");
    expect((error.cause as Error).message).toContain("Failed query");
  });
  it("names constraint failures plainly, with caller wording where given", () => {
    expect(
      (readableDatabaseError(wrapped("23505", 'duplicate key value violates unique constraint "x"')) as Error).message,
    ).toBe("This would duplicate an existing record");
    expect(
      (
        readableDatabaseError(wrapped("23503", 'insert or update on table "x" violates foreign key constraint "y"'), {
          reference: "The house is still in use",
        }) as Error
      ).message,
    ).toBe("The house is still in use");
    expect(
      (readableDatabaseError(wrapped("23514", 'new row for relation "x" violates check constraint "y"')) as Error)
        .message,
    ).toBe("A value breaks a catalogue rule");
  });
  it("keeps a rule's own message even when it uses a constraint code", () => {
    expect(
      (
        readableDatabaseError(
          wrapped(
            "23514",
            "Taxonomy family does not apply to this domain and record level",
          ),
        ) as Error
      ).message,
    ).toBe("Taxonomy family does not apply to this domain and record level");
    expect(
      (
        readableDatabaseError(
          wrapped(
            "23505",
            'duplicate key value violates unique constraint "x"',
          ),
        ) as Error
      ).message,
    ).toBe("This would duplicate an existing record");
  });
  it("leaves validation, connection and unknown errors unchanged", async () => {
    const plain = new Error("Choose a parent location");
    expect(readableDatabaseError(plain)).toBe(plain);
    const network = Object.assign(new Error("connect failed"), {
      code: "ECONNREFUSED",
    });
    expect(readableDatabaseError(network)).toBe(network);
    const unknown = wrapped("40001", "could not serialize access");
    expect(readableDatabaseError(unknown)).toBe(unknown);
    await expect(
      withReadableErrors(async () => {
        throw wrapped("P0001", "Perfume not found");
      }),
    ).rejects.toThrow(/^Perfume not found$/);
  });
});
