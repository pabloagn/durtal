import { describe, it, expect } from "vitest";
import { isMediaWidth, mediaUrl, withMediaWidth } from "@/lib/s3/media-url";
import { maxCardWidth } from "@/components/shared/grid-columns";

describe("mediaUrl", () => {
  it("encodes the key", () => {
    expect(mediaUrl("gold/covers/a b/thumb.webp")).toBe(
      "/api/s3/read?key=gold%2Fcovers%2Fa+b%2Fthumb.webp",
    );
  });

  it("adds a version from a date as epoch ms", () => {
    const url = mediaUrl("k", { version: new Date(1700000000000) });
    expect(new URL(url, "http://x").searchParams.get("v")).toBe(
      "1700000000000",
    );
  });

  it("omits a missing version", () => {
    expect(mediaUrl("k", { version: null })).toBe("/api/s3/read?key=k");
  });

  it("adds a width", () => {
    expect(mediaUrl("k", { width: 400 })).toBe("/api/s3/read?key=k&w=400");
  });
});

describe("withMediaWidth", () => {
  it("keeps the other params and sets w", () => {
    const url = withMediaWidth("/api/s3/read?key=k&v=1&_r=2", 240);
    const params = new URL(url, "http://x").searchParams;
    expect(params.get("key")).toBe("k");
    expect(params.get("v")).toBe("1");
    expect(params.get("_r")).toBe("2");
    expect(params.get("w")).toBe("240");
  });

  it("replaces an existing w", () => {
    expect(withMediaWidth("/api/s3/read?key=k&w=800", 400)).toBe(
      "/api/s3/read?key=k&w=400",
    );
  });
});

describe("isMediaWidth", () => {
  it("accepts only the allowed widths", () => {
    expect(isMediaWidth(400)).toBe(true);
    expect(isMediaWidth(401)).toBe(false);
    expect(isMediaWidth(Number.NaN)).toBe(false);
  });
});

describe("maxCardWidth", () => {
  it("covers full-width phone Large cards through the coarse viewport boundary", () => {
    for (const viewport of [320, 390, 430, 767]) {
      // The page shell can give a single Large card viewport minus 32px.
      expect(maxCardWidth(2)).toBeGreaterThanOrEqual(viewport - 32);
    }
    // Compact stays bounded by the existing desktop maximum; its phone
    // projection is at most two cards above 328px, or one below it.
    for (const columns of [3, 4, 5, 6, 7, 8]) {
      expect(maxCardWidth(columns)).toBe(432);
      expect(maxCardWidth(columns)).toBeGreaterThanOrEqual((767 - 8) / 2);
      expect(maxCardWidth(columns)).toBeGreaterThanOrEqual(327);
    }
  });

  it("bounds cards over desktop containers and phone projections", () => {
    expect(maxCardWidth(2)).toBe(767);
    expect(maxCardWidth(6)).toBe(432);
  });

  it("accounts for the single readable card before a second column fits", () => {
    for (const columns of [3, 4, 5, 6, 7, 8])
      expect(maxCardWidth(columns)).toBeGreaterThanOrEqual(432);
  });
});
