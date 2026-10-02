import { describe, expect, it } from "vitest";
import { slugFitsBase } from "@/lib/works/slug";

describe("slugFitsBase", () => {
  const base = "libra-by-don-delillo";

  it("accepts the base and a numbered base", () => {
    expect(slugFitsBase(base, base)).toBe(true);
    expect(slugFitsBase(`${base}-2`, base)).toBe(true);
    expect(slugFitsBase(`${base}-12`, base)).toBe(true);
  });

  it("refuses an old title, a missing slug and a non-number suffix", () => {
    expect(slugFitsBase("libra-penguin-essentials-by-don-delillo", base)).toBe(false);
    expect(slugFitsBase(null, base)).toBe(false);
    expect(slugFitsBase(`${base}-ii`, base)).toBe(false);
    expect(slugFitsBase(`${base}2`, base)).toBe(false);
  });
});
