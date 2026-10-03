import { describe, it, expect } from "vitest";
import { escapeLike, containsPattern } from "@/lib/utils/like";

describe("escapeLike", () => {
  it("leaves plain text unchanged", () => {
    expect(escapeLike("Mémoires d'outre-tombe")).toBe("Mémoires d'outre-tombe");
  });

  it("escapes percent signs", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes underscores", () => {
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes backslashes", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("escapes every special character in a mixed string", () => {
    expect(escapeLike("%_\\%")).toBe("\\%\\_\\\\\\%");
  });

  it("returns an empty string for empty input", () => {
    expect(escapeLike("")).toBe("");
  });
});

describe("containsPattern", () => {
  it("wraps the escaped text in wildcards", () => {
    expect(containsPattern("_")).toBe("%\\_%");
    expect(containsPattern("Dune")).toBe("%Dune%");
  });
});
