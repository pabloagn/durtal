import { describe, expect, it } from "vitest";
import robots from "@/app/robots";

describe("private catalogue crawler policy", () => {
  it("disallows every crawler from every path", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
