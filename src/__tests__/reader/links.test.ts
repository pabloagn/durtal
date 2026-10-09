import { describe, expect, it } from "vitest";
import {
  classifyReaderLink,
  EXTERNAL_WINDOW_FEATURES,
} from "@/lib/reader/links/policy";

describe("reader link scheme policy", () => {
  it.each([
    "javascript:alert(1)",
    " JaVaScRiPt:alert(1) ",
    "data:text/html,x",
    "file:///tmp/x",
    "blob:https://durtal.test/x",
    "tel:123",
    "custom:book",
    "java\nscript:evil",
    "https:\\evil.test",
    "https:evil.test",
    "https://",
    "http://user:password@example.com",
    "mailto:a@b.test?subject=x%0D%0Aevil",
    "mailto:",
  ])("blocks %s", (href) => {
    expect(classifyReaderLink(href)).toEqual({ kind: "blocked" });
  });
  it.each([
    "chapter.xhtml#p2",
    "../notes.xhtml#n1",
    "#n1",
    "book%20part.xhtml",
  ])("preserves book-relative %s", (href) => {
    expect(classifyReaderLink(href)).toEqual({ kind: "internal", href });
  });
  it("canonicalizes allowed external links and protocol-relative URLs", () => {
    expect(classifyReaderLink(" HTTPS://Example.com/a ")).toEqual({
      kind: "external",
      scheme: "https:",
      href: "https://example.com/a",
    });
    expect(classifyReaderLink("//example.com/a")).toEqual({
      kind: "external",
      scheme: "https:",
      href: "https://example.com/a",
    });
    expect(classifyReaderLink("mailto:joris@example.com")).toEqual({
      kind: "external",
      scheme: "mailto:",
      href: "mailto:joris@example.com",
    });
    expect(classifyReaderLink("http://example.com").kind).toBe("external");
  });
  it("requires opener and referrer isolation", () => {
    expect(EXTERNAL_WINDOW_FEATURES.split(",")).toEqual([
      "noopener",
      "noreferrer",
    ]);
  });
  it("blocks malformed scheme-like relative references and empty input", () => {
    expect(classifyReaderLink(":evil")).toEqual({ kind: "blocked" });
    expect(classifyReaderLink(" \t")).toEqual({ kind: "blocked" });
  });
});
