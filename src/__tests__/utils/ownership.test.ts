import { describe, expect, it } from "vitest";
import { heldCopies, holdsNoCopy } from "@/lib/utils/ownership";

const editions = (...statuses: string[][]) =>
  statuses.map((list) => ({
    instances: list.map((status, i) => ({ id: `${status}-${i}`, status })),
  }));

describe("held copies (SLN-1127)", () => {
  it("counts every copy that is not deaccessioned, across editions", () => {
    expect(
      heldCopies(editions(["available", "deaccessioned"], ["lent_out"])).map(
        (c) => c.status,
      ),
    ).toEqual(["available", "lent_out"]);
  });

  it("says an accessioned book with only former copies holds none", () => {
    expect(holdsNoCopy("accessioned", editions(["deaccessioned"]))).toBe(true);
    expect(holdsNoCopy("accessioned", editions([]))).toBe(true);
    expect(holdsNoCopy("accessioned", editions(["missing"]))).toBe(false);
  });

  it("says nothing for a book that isn't accessioned", () => {
    expect(holdsNoCopy("wanted", editions([]))).toBe(false);
    expect(holdsNoCopy("deaccessioned", editions(["deaccessioned"]))).toBe(false);
  });
});
