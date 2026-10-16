import { describe, expect, it } from "vitest";
import { extractSourcePage } from "@/lib/enrichment/source-extract";
import { assessSourceContent, blockedSourceText, usableSourceQuality } from "@/lib/enrichment/source-quality";
import { sourceProfile, sourceRequests, structuredSourceType } from "@/lib/enrichment/source-profiles";
import { acceptsEvidenceType } from "@/lib/net/safe-fetch-page";

// Synthetic regressions shaped like the four-book pilot's failures. No owner
// catalogue data, stored book text or external requests are used by these tests.
const identity = { titles: ["The Example"], authors: ["Jane Author"] };
const publisher = "https://www.penguin.co.uk/books/the-example";
const product = (description = "", extra = "") =>
  `<html><body><main><h1>The Example</h1><span itemprop="author">Jane Author</span>${description}${extra}</main></body></html>`;
const assess = (body: string, url = publisher) => assessSourceContent(extractSourcePage(body, url), url, { identity });

describe("source profiles and extraction quality", () => {
  it("routes exact catalogue identities to official APIs without expanding fetch permission", () => {
    expect(sourceRequests("https://openlibrary.org/works/OL123W/The_Example").urls).toEqual(["https://openlibrary.org/works/OL123W.json"]);
    const bnf = sourceRequests("https://catalogue.bnf.fr/ark:/12148/cb12345678x");
    expect(bnf.urls).toHaveLength(2);
    expect(new URL(bnf.urls[0]).searchParams.get("query")).toBe('bib.persistentid any "ark:/12148/cb12345678x"');
    expect(new URL(bnf.urls[1]).searchParams.get("query")).toMatch(/^aut\./);
    expect(sourceProfile("https://openlibrary.org.evil.test/works/OL123W").key).toBe("article");
    expect(sourceProfile("https://penguin.co.uk.evil.test/book").key).toBe("article");
    expect(structuredSourceType("https://openlibrary.org/works/OL123W")).toBeNull();
    expect(acceptsEvidenceType("application/json", null)).toBe(false);
    expect(acceptsEvidenceType("application/json", "json")).toBe(true);
    expect(acceptsEvidenceType("application/xml", "json")).toBe(false);
  });

  it("rejects verification bodies, navigation shells, empty extraction and the wrong primary book", () => {
    expect(blockedSourceText("Human verification: verify you are human")).toBe(true);
    expect(blockedSourceText("A character says just a moment, then leaves.")).toBe(false);
    expect(assessSourceContent({ text: "Home Menu Catalogue Search Account Help" }, "https://review.example").status).toBe("extraction_failed");
    expect(assessSourceContent(null, publisher).status).toBe("extraction_failed");
    expect(assess(product().replaceAll("The Example", "Another Novel"), publisher).status).toBe("identity_mismatch");
    // A related item matching the requested book cannot rescue a wrong record.
    expect(assess(product().replaceAll("The Example", "Another Novel").replace("</main>", "<aside>The Example Jane Author</aside></main>")).status).toBe(
      "identity_mismatch",
    );
  });

  it("reports publisher omissions and separates synopsis from biography, reviews and recommendations", () => {
    const page = extractSourcePage(
      product(
        "<h2>Synopsis</h2><p>A short novel about memory.</p><h2>Other details</h2>",
        '<aside>Jane Author was born in Paris.</aside><div class="reviews">A breathtaking first-person novel.</div><div class="recommendations">A book set in Tokyo.</div>',
      ),
      publisher,
    )!;
    expect(page.text).toContain("A short novel about memory.");
    expect(page.text).not.toMatch(/Paris|first-person|Tokyo/);
    expect(assessSourceContent(page, publisher, { identity })).toMatchObject({
      status: "partial",
      present: ["title", "contributors", "description"],
      missing: expect.arrayContaining(["publication", "language", "extent"]),
    });
    for (const section of page.sections!) expect([...page.text].slice(section.start, section.end).join("")).toMatch(new RegExp(`^${section.role}:`));
    // Missing synopsis is visible, not replaced with a review or biography.
    expect(assess(product("", '<div class="reviews">A magnificent book.</div>')).missing).toContain("description");
    expect(extractSourcePage(product("", '<div class="reviews">A magnificent book.</div>'), publisher)?.text).not.toContain("magnificent");
  });

  it("keeps a short structured record usable and refuses mismatched or unparsed records", () => {
    const url = "https://openlibrary.org/works/OL123W.json";
    const body = JSON.stringify({
      key: "/works/OL123W",
      title: "The Example",
      authors: [{ name: "Jane Author" }],
      description: { value: "Brief." },
    });
    const result = extractSourcePage(body, url)!;
    expect(result.text).toContain("description: Brief.");
    expect(usableSourceQuality(assessSourceContent(result, url, { identity }))).toBe(true);
    expect(extractSourcePage(body.replace("OL123W", "OL999W"), url)).toBeNull();
    expect(extractSourcePage("Verification failed", url)).toBeNull();
    expect(extractSourcePage("{broken", url)).toBeNull();
    expect(assessSourceContent({ text: "BnF catalogue navigation", fields: ["mainText"] }, url).status).toBe("extraction_failed");
  });

  it("reads one BnF UNIMARC record and preserves fields without mixing associated records", () => {
    const url = sourceRequests("https://catalogue.bnf.fr/ark:/12148/cb12345678x").urls[0];
    const xml = `<srw:searchRetrieveResponse xmlns:srw="urn:srw"><srw:numberOfRecords>1</srw:numberOfRecords><srw:record><srw:recordIdentifier>ark:/12148/cb12345678x</srw:recordIdentifier><srw:recordData><record type="Bibliographic"><datafield tag="200"><subfield code="a">The Example</subfield></datafield><datafield tag="700"><subfield code="a">Author</subfield><subfield code="b">Jane</subfield></datafield><datafield tag="101"><subfield code="a">fre</subfield></datafield></record></srw:recordData></srw:record></srw:searchRetrieveResponse>`;
    expect(assess(xml, url)).toMatchObject({
      status: "partial",
      present: ["record", "title", "contributors", "language"],
    });
    expect(extractSourcePage(xml.replace("cb12345678x", "cb99999999x"), url)).toBeNull();
    expect(extractSourcePage("<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>", url)).toBeNull();
  });

  it("does not select a recommendation's JSON-LD when several products appear", () => {
    const books = [
      {
        "@type": "Book",
        name: "Other Novel",
        author: "Someone Else",
        description: "Wrong.",
      },
      {
        "@type": "Book",
        name: "The Example",
        author: "Jane Author",
        description: "Right.",
        numberOfPages: 123,
      },
    ];
    const page = extractSourcePage(product(`<script type="application/ld+json">${JSON.stringify(books)}</script>`), publisher)!;
    expect(page.text).toContain("Right.");
    expect(page.text).not.toContain("Wrong.");
    expect(page.fields).toContain("extent");
  });
});
