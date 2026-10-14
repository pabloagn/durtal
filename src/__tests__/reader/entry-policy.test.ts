import { describe, expect, it } from "vitest";
import {
  readerEntryPolicy,
  readerReturnDestination,
} from "@/lib/reader/entry-policy";

const ebookId = "11111111-1111-1111-1111-111111111111";
const fileId = "22222222-2222-2222-2222-222222222222";
const readerPath = `/reader/${ebookId}?file=${fileId}`;

describe("reader return destination", () => {
  it.each([
    "/",
    "/library?ebook=yes&view=list",
    "/library/nadja#copy-1",
    "/series/surrealism",
    "/collections/favourites",
    "/people/andre-breton",
    "/publishers/gallimard",
    "/taxonomy/genre/surrealism",
    "/recommenders/123",
    "/reading/suggestions",
    "/ebooks?q=Nadja",
  ])("retains catalogue destination %s", (path) => {
    expect(readerReturnDestination(path)).toBe(path);
  });

  it.each([
    null,
    1,
    "",
    "https://evil.example/library",
    "//evil.example/library",
    "/\\evil.example",
    "javascript:alert(1)",
    "/api/ebooks",
    "/reader/123",
    "/libraryish",
    "/settings",
    "/library\n",
    "/library/%2f%2fevil.example",
    "/library/%5cevil.example",
    "/library/%00",
    "/library/%252f%252fevil.example",
    "/library/../api/ebooks",
    "/library/%2e%2e/api/ebooks",
    `/${"a".repeat(2048)}`,
  ])("refuses an unsafe or unrelated return destination %s", (path) => {
    expect(readerReturnDestination(path)).toBeNull();
  });

  it("preserves an encoded book title or search term without decoding it into navigation", () => {
    expect(
      readerReturnDestination("/library/%C3%A0-rebours?q=two%20words"),
    ).toBe("/library/%C3%A0-rebours?q=two%20words");
  });
});

describe("reader document entry", () => {
  it("keeps the exact selected file and separate return destination for the navigation adapter", () => {
    expect(
      readerEntryPolicy(readerPath, "/series/surrealism?view=list"),
    ).toEqual({
      readerPath,
      returnTo: "/series/surrealism?view=list",
      navigation: "document",
    });
    expect(readerEntryPolicy(`/reader/${ebookId}`, null)).toEqual({
      readerPath: `/reader/${ebookId}`,
      returnTo: null,
      navigation: "document",
    });
  });

  it("keeps reader entry valid when the caller must supply a safe fallback destination", () => {
    expect(readerEntryPolicy(readerPath, "//evil.example")).toEqual({
      readerPath,
      returnTo: null,
      navigation: "document",
    });
  });

  it.each([
    `/library/${ebookId}`,
    `/reader/not-an-id`,
    `/reader/${ebookId}/extra`,
    `https://evil.example/reader/${ebookId}`,
    `//evil.example/reader/${ebookId}`,
    `/reader/${ebookId}?file=not-an-id`,
    `/reader/${ebookId}?file=${fileId}&file=${fileId}`,
    `/reader/${ebookId}?redirect=https://evil.example`,
    `/reader/${ebookId}?from=not-a-device`,
    `/reader/${ebookId}?from=${fileId}&from=${fileId}`,
    `/reader/${ebookId}#script`,
    `/reader/../library/${ebookId}`,
    `/reader/${ebookId}\n`,
  ])("refuses invalid reader entry %s", (path) => {
    expect(readerEntryPolicy(path, "/library")).toBeNull();
  });

  it("opens at another device's place when the link names it (SLN-665)", () => {
    const deviceId = "33333333-3333-4333-8333-333333333333";
    expect(readerEntryPolicy(`${readerPath}&from=${deviceId}`, "/ebooks")?.readerPath)
      .toBe(`${readerPath}&from=${deviceId}`);
    expect(readerEntryPolicy(`/reader/${ebookId}?from=${deviceId}`, "/ebooks")?.readerPath)
      .toBe(`/reader/${ebookId}?from=${deviceId}`);
  });
});
