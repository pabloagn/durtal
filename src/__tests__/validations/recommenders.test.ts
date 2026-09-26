import { describe, expect, it } from "vitest";
import {
  parseWebsite,
  recommenderInputSchema,
  websiteLabel,
} from "@/lib/validations/recommenders";

describe("recommender website", () => {
  it.each([
    [
      "https://www.youtube.com/@Lifeonbooks",
      "https://www.youtube.com/@Lifeonbooks",
    ],
    ["youtube.com/@Lifeonbooks", "https://youtube.com/@Lifeonbooks"],
    ["http://chatgpt.com", "https://chatgpt.com/"],
    ["  claude.com  ", "https://claude.com/"],
  ])("accepts %s", (raw, expected) => {
    expect(parseWebsite(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([null, undefined, "", "  "])("clears for %j", (raw) => {
    expect(parseWebsite(raw)).toEqual({ ok: true, value: null });
  });

  it.each([
    "javascript:alert(1)",
    "ftp://x.com",
    "localhost",
    "https://u:p@x.com",
    "not a site",
  ])("rejects %s", (raw) => {
    expect(parseWebsite(raw).ok).toBe(false);
  });

  it("labels websites without the scheme", () => {
    expect(websiteLabel("https://www.youtube.com/@Lifeonbooks")).toBe(
      "youtube.com/@Lifeonbooks",
    );
    expect(websiteLabel("https://claude.com/")).toBe("claude.com");
  });
});

describe("recommender input", () => {
  it("trims the name and normalizes the website", () => {
    expect(
      recommenderInputSchema.parse({ name: "  Claude ", url: "claude.com" }),
    ).toEqual({
      name: "Claude",
      url: "https://claude.com/",
    });
  });
  it("requires a name and a valid website", () => {
    expect(recommenderInputSchema.safeParse({ name: " " }).success).toBe(false);
    expect(
      recommenderInputSchema.safeParse({ name: "X", url: "javascript:x" })
        .success,
    ).toBe(false);
  });
});
