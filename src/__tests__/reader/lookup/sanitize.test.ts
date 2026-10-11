// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeLookupHtml, sanitizeXdxf } from "@/lib/reader/lookup/sanitize";
import {
  wiktionaryDefinitionResponse,
  wiktionaryParseResponse,
  wikipediaSummaryResponse,
} from "@/lib/reader/lookup/responses";

const base = "https://en.wiktionary.org/wiki/lux";
function rendered(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

describe("lookup HTML and XDXF cleaning", () => {
  it("removes every executable/media/style attribute while retaining inert text", () => {
    const clean = sanitizeLookupHtml(
      '<p style="color:red" onclick="evil()"><script>script text</script><style>style text</style><img src="https://evil.invalid/word"><iframe src="/leak">frame text</iframe><form><input value="x">form text</form><b class="x">gloss</b></p>',
      { base },
    );
    const body = rendered(clean);
    expect(body.querySelector("script,style,img,iframe,form,input")).toBeNull();
    expect(body.querySelector("[onclick],[style],[class]")).toBeNull();
    expect(body.textContent).toContain("gloss");
    expect(body.textContent).toContain("script text");
  });
  it("resolves links and unwraps unsafe addresses, including encoded and credentialed schemes", () => {
    const body = rendered(
      sanitizeLookupHtml(
        '<a href="/wiki/lux" class="x">lux</a><a href="javascript:evil()">bad</a><a href="&#106;avascript:evil()">encoded</a><a href="https://user:secret@example.org">secret</a>',
        { base },
      ),
    );
    expect(body.querySelectorAll("a")).toHaveLength(1);
    expect(body.querySelector("a")?.getAttribute("href")).toBe(
      "https://en.wiktionary.org/wiki/lux",
    );
    expect(body.querySelector("a")?.getAttribute("target")).toBe("_blank");
    expect(body.querySelector("a")?.getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(body.textContent).toBe("luxbadencodedsecret");
  });
  it("bounds serialized bytes without splitting Unicode, HTML escapes or closing tags", () => {
    const clean = sanitizeLookupHtml(`<p>${"𐀀<&".repeat(10000)}</p>`, {
      base,
      maxBytes: 128,
    });
    expect(new TextEncoder().encode(clean).byteLength).toBeLessThanOrEqual(128);
    expect(clean.endsWith("</p>")).toBe(true);
    expect(rendered(clean).textContent).not.toContain("�");
    expect(sanitizeLookupHtml("text", { base, maxBytes: 0 })).toBe("");
    expect(() =>
      sanitizeLookupHtml("text", { base: "javascript:evil()" }),
    ).toThrow();
  });
  it("maps XDXF presentation, refuses entities, and makes kref link-free", () => {
    const clean = sanitizeXdxf(
      '<k>lux</k><tr>luːks</tr><ex>example</ex><abr>noun</abr><co>comment</co><dtrn>light &amp; day</dtrn><kref href="https://evil.invalid">other</kref>',
      { base },
    );
    const body = rendered(clean);
    expect(body.querySelector("b")?.textContent).toBe("lux");
    expect(body.querySelectorAll("small")).toHaveLength(2);
    expect(body.querySelector("a")).toBeNull();
    expect(body.textContent).toContain("light & dayother");
    expect(() =>
      sanitizeXdxf('<!DOCTYPE x [<!ENTITY bomb "x">]><dtrn>&bomb;</dtrn>', {
        base,
      }),
    ).toThrow();
    expect(() => sanitizeXdxf("<k>unclosed", { base })).toThrow();
  });
});

describe("synthetic provider responses", () => {
  it("matches multiword language headings and rejects oversized, cyclic or malformed responses", () => {
    const body = {
      parse: {
        text: '<h2>Greek</h2><p>modern</p><h2>Ancient Greek<span class="mw-editsection">[edit]</span></h2><p>ancient</p><h2>Latin</h2><p>later</p>',
      },
    };
    const result = wiktionaryParseResponse(body, {
      language: "grc",
      wikiLanguage: "en",
      base,
    });
    expect(rendered(result.html).textContent).toBe("ancient");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => wiktionaryDefinitionResponse(cyclic, "en")).toThrow(/JSON/);
    expect(() =>
      wiktionaryDefinitionResponse(
        {
          en: [
            {
              partOfSpeech: "Noun",
              language: "English",
              definitions: [{ definition: "x".repeat(2 * 1024 * 1024) }],
            },
          ],
        },
        "en",
      ),
    ).toThrow(/too large/);
    expect(() => wiktionaryDefinitionResponse({}, "constructor")).toThrow(
      /language/,
    );
    expect(
      wiktionaryDefinitionResponse(
        {
          en: [
            {
              partOfSpeech: "Noun",
              language: "English",
              definitions: [{ definition: "<img src='/x'>" }],
            },
          ],
        },
        "en",
      ).found,
    ).toBe(false);
  });
  it("selects the passage language, or preserves other-language entries with their labels", () => {
    const body = {
      la: [
        {
          partOfSpeech: "Noun",
          language: "Latin",
          definitions: [
            {
              definition: '<b onclick="x">synthetic light</b>',
              examples: ["synthetic example"],
            },
          ],
        },
      ],
      en: [
        {
          partOfSpeech: "Noun",
          language: "English",
          definitions: [{ definition: "synthetic unit" }],
        },
      ],
    };
    expect(wiktionaryDefinitionResponse(body, "la")).toMatchObject({
      found: true,
      sections: [{ code: "la", language: "Latin" }],
    });
    expect(wiktionaryDefinitionResponse(body, "grc")).toMatchObject({
      found: false,
      sections: [{ code: "la" }, { code: "en" }],
    });
    expect(wiktionaryDefinitionResponse({}, "la")).toEqual({
      found: false,
      sections: [],
    });
    expect(() =>
      wiktionaryDefinitionResponse({ la: "malformed" }, "la"),
    ).toThrow();
  });
  it.each([
    ["en", "en", "Old English", "English"],
    ["fr", "fr", "Ancien français", "Français"],
    ["el", "en", "Ancient Greek", "Greek"],
    ["grc", "en", "Some Ancient Greek", "Ancient Greek"],
  ])(
    "matches only the complete %s language heading",
    (language, wikiLanguage, historical, exact) => {
      const input = { language, wikiLanguage, base };
      for (const text of [
        `<h2>${historical}</h2><p>wrong historical gloss</p><h2>${exact}<span class="mw-editsection">[edit]</span></h2><p>right gloss</p><h2>Next</h2><p>wrong next gloss</p>`,
        `<div class="mw-heading"><h2>${exact}</h2></div><p>right gloss</p><div class="mw-heading"><h2>${historical}</h2></div><p>wrong historical gloss</p>`,
      ]) {
        const result = wiktionaryParseResponse({ parse: { text } }, input);
        expect(result.found).toBe(true);
        expect(rendered(result.html).textContent).toBe("right gloss");
      }
      expect(
        wiktionaryParseResponse(
          {
            parse: {
              text: `<h2>${historical}</h2><p>wrong historical gloss</p>`,
            },
          },
          input,
        ),
      ).toEqual({ found: false, html: "" });
    },
  );
  it.each([
    ["es", "Español"],
    ["fr", "Français"],
    ["de", "Deutsch"],
    ["it", "Italiano"],
    ["en", "Latin"],
  ])(
    "extracts only the %s section through wrapped headings",
    (wikiLanguage, name) => {
      const language = wikiLanguage === "en" ? "la" : wikiLanguage;
      const body = {
        parse: {
          text: `<div class="mw-heading"><h2>Other</h2></div><p>wrong entry</p><div class="mw-heading"><h2>${name}</h2></div><p>synthetic gloss</p><table><tr><td>noise</td></tr></table><div class="navbox">navigation</div><div class="noprint">print noise</div><sup class="reference">reference</sup><h2>Next</h2><p>wrong next</p>`,
        },
      };
      const result = wiktionaryParseResponse(body, {
        language,
        wikiLanguage,
        base,
      });
      expect(result.found).toBe(true);
      expect(rendered(result.html).textContent).toBe("synthetic gloss");
      expect(
        wiktionaryParseResponse(
          { parse: { text: "<h2>Not Españolish</h2>wrong" } },
          { language: "es", wikiLanguage: "es", base },
        ).found,
      ).toBe(false);
    },
  );
  it("normalizes Wikipedia summaries, preserves direction/disambiguation, and omits images", () => {
    const response = {
      titles: { display: "<b>Example</b>" },
      description: "synthetic description",
      extract_html:
        '<p>synthetic summary<img src="https://upload.wikimedia.org/x"></p>',
      type: "disambiguation",
      dir: "rtl",
      thumbnail: { source: "https://upload.wikimedia.org/x" },
      content_urls: {
        desktop: { page: "https://he.wikipedia.org/wiki/Example" },
      },
    };
    const result = wikipediaSummaryResponse(
      response,
      "https://he.wikipedia.org/wiki/",
    );
    expect(result).toMatchObject({
      dir: "rtl",
      disambiguation: true,
      article: response.content_urls.desktop.page,
      found: true,
    });
    expect(rendered(result.extract).querySelector("img")).toBeNull();
    expect(() =>
      wikipediaSummaryResponse(
        {
          ...response,
          content_urls: { desktop: { page: "https://evil.invalid" } },
        },
        "https://he.wikipedia.org/wiki/",
      ),
    ).toThrow();
    expect(
      wikipediaSummaryResponse(
        { ...response, extract_html: "" },
        "https://he.wikipedia.org/wiki/",
      ).found,
    ).toBe(false);
    expect(
      wikipediaSummaryResponse(
        { ...response, extract_html: "<p><br></p>" },
        "https://he.wikipedia.org/wiki/",
      ).found,
    ).toBe(false);
  });
});
