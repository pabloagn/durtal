import { describe, it, expect } from "vitest";
import {
  requireMatchProbability,
  requireFiniteScore,
} from "@/lib/ebooks/match/validation";

describe("persisted matcher numeric boundary", () => {
  it.each([NaN, Infinity, -Infinity, -0.01, 1.01])(
    "rejects invalid probability %s",
    (value) => {
      expect(() => requireMatchProbability(value)).toThrow(
        "finite value from 0 to 1",
      );
    },
  );
  it.each([null, 0, 0.5, 1])(
    "accepts nullable bounded probability %s",
    (value) => {
      expect(() => requireMatchProbability(value)).not.toThrow();
    },
  );
  it.each([NaN, Infinity, -Infinity])(
    "rejects nonfinite weight or margin %s",
    (value) => {
      expect(() => requireFiniteScore(value, null)).toThrow("must be finite");
      expect(() => requireFiniteScore(1, value)).toThrow("must be finite");
    },
  );
  it("permits negative finite weights and margins for weak candidates", () => {
    expect(() => requireFiniteScore(-500, -10)).not.toThrow();
  });
});
