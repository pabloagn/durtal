import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ReaderNotFound from "@/app/reader/not-found";
import { identifierLabel } from "@/lib/ebooks/identifier-label";

describe("e-book page presentation (SLN-1040)", () => {
  it("gives the standalone reader not-found view exactly one page heading", () => {
    const html = renderToStaticMarkup(ReaderNotFound());
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>eBook not found<\/h1>/);
    expect(html).not.toContain("<h2");
    expect(html).toContain('href="/ebooks"');
  });

  it.each([["isbn13", "ISBN-13"], ["ISBN-10", "ISBN-10"], ["doi", "DOI"],
    ["mobi-asin", "Kindle ASIN"], ["calibre", "Calibre"], ["custom_id", "Custom id"]])(
    "names the %s identifier as %s", (scheme, label) => {
      expect(identifierLabel(scheme)).toBe(label);
    },
  );
});
