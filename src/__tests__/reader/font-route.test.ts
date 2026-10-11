import { describe, expect, it } from "vitest";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";
import { presentationFromPreferences, policyTypographyCss } from "@/lib/reader/presentation";
import { fontFaceCSS } from "@/lib/reader/presentation/fonts";
import { inspectFontMarkup, collectBookFontFacts } from "@/lib/reader/presentation/font-preflight";
import { chooseReaderFontRoute, fontPresentationChangeKind, type CoreFontRelease } from "@/lib/reader/presentation/font-route";
import core from "@/lib/reader/presentation/font-core-profile.json";
import { guardFontResourceLoad } from "@/lib/reader/engines/foliate/font-resource-gate";

const policy = { ...PRESENTATION_DEFAULTS.desktop, font: "garamond" } as const;
const markup = (content: string, css = "") => `<html lang="en"><head><style>${css}</style></head><body>${content}</body></html>`;
// Synthetic certificate for pure routing tests only. No product release or real font is enabled.
const release: CoreFontRelease = {
  profileId: core.id, manifestSha256: core.measuredManifestSha256,
  nativeShapingAccepted: true, browserMappingAccepted: true, normalTypographyAccepted: true,
  languages: ["en"], policyFontSizes: [20],
  files: core.files.map(face => ({ style: face.style as "roman" | "italic", weight: face.weight as 400 | 700,
    sha256: face.sha256, path: `/fonts/reader/test/core-${face.weight}-${face.style}.woff2` })),
};

describe("pre-resource font routing", () => {
  it("keeps the measured core unavailable without reviewed shaping and publication", () => {
    const route = chooseReaderFontRoute(policy, inspectFontMarkup(markup("office <strong>bold</strong> <i>italic</i>"), "en"));
    expect(route.kind).toBe("full");
    expect(route.referenceBytes).toBe(255748);
    expect(route.firstTextBudgetAccepted).toBe(false);
    expect(route.reasons).toContain("core-shaping-or-publication-unaccepted");
    const p = presentationFromPreferences(policy, "https://reader.example");
    expect(p.fontFaces).not.toContain(core.family);
    expect(p.fontFaces).not.toContain("/test/");
  });

  it("admits exact normal core facts only with a synthetic fully bound release", () => {
    const facts = inspectFontMarkup(markup("office <strong>bold</strong> <i>italic</i>"), "en");
    expect(facts.complete).toBe(true);
    const route = chooseReaderFontRoute(policy, facts, { release });
    expect(route.kind).toBe("core");
    expect(route.referenceBytes).toBe(151368);
    expect(route.firstTextBudgetAccepted).toBe(false);
    expect(chooseReaderFontRoute(policy, facts, { release: { ...release, manifestSha256: "wrong" } }).kind).toBe("full");
  });

  it.each([
    ["weight450", markup("word"), { ...policy, fontWeight: 450 }],
    ["heading600", markup("<h1>Title</h1>", "h1{font-weight:600}"), policy],
    ["nestedbold", markup("<strong>bold <strong>more</strong></strong>"), policy],
    ["oblique", markup("word", "p{font-style:oblique}"), policy],
    ["accent", markup("caf\u00e9"), policy],
    ["combining", markup("e\u0301"), policy],
    ["greek", markup("\u03b1"), policy],
    ["dlig", markup("word", 'p{font-feature-settings:"dlig" 1}'), policy],
    ["smallcaps", markup("word", "p{font-variant-caps:small-caps}"), policy],
    ["tabular", markup("123", "p{font-variant-numeric:tabular-nums}"), policy],
    ["vendorfeatures", markup("word", 'p{-webkit-font-feature-settings:"ss01" 1}'), policy],
    ["variable", markup("word", "p{font-weight:var(--weight)}"), policy],
    ["conditional", markup("word", "@media screen{p{font-weight:700}}"), policy],
    ["generated", markup("word", 'p::after{content:"words"}'), policy],
    ["import", markup("word", '@import "other.css";'), policy],
    ["script", markup("<script>changeFont()</script>word"), policy],
    ["missingstyle", '<html lang="en"><head><link rel="stylesheet" href="x.css"></head><body>word</body></html>', policy],
    ["malformed", markup("word", "p{font-weight:"), policy],
    ["differentlanguage", '<html lang="tr"><body>word</body></html>', policy],
    ["altglyph", markup('<img alt="\u03b1">'), policy],
  ] as const)("routes %s to full fonts before any core installation", (_name, text, settings) => {
    expect(chooseReaderFontRoute(settings, inspectFontMarkup(text, "en"), { release }).kind).toBe("full");
  });

  it("preserves preference weight and feature declarations on the fallback path", () => {
    const settings = { ...policy, fontWeight: 450 };
    const p = presentationFromPreferences(settings, "https://reader.example");
    expect(p.policy?.fontWeight).toBe(450);
    expect(policyTypographyCss(p)).toContain("font-weight: 450");
    expect(p.fontFamily).toContain("Durtal EB Garamond");
    expect(p.fontFamily).not.toContain(core.family);
  });

  it("keeps default Literata and installs only the selected family", () => {
    const p = presentationFromPreferences(PRESENTATION_DEFAULTS.desktop, "https://reader.example");
    expect(p.fontFamily).toContain("Durtal Literata");
    expect(p.fontFaces.match(/@font-face/g)).toHaveLength(12);
    expect(p.fontFaces).not.toContain("Garamond");
    expect(p.fontFaces).not.toContain("Durtal Inter");
    // Full inventory export remains available for caching and existing callers.
    expect(fontFaceCSS("https://reader.example").match(/@font-face/g)).toHaveLength(36);
  });

  it("installs the initial preselected route and keeps later colour edits out of reflow", () => {
    const initial = presentationFromPreferences(policy, "https://reader.example");
    expect(fontPresentationChangeKind(null, initial)).toBe("layout");
    const colours = presentationFromPreferences({ ...policy, theme: "paper" }, "https://reader.example");
    expect(fontPresentationChangeKind(initial, colours)).toBe("colour");
    expect(fontPresentationChangeKind(initial, { ...initial, fontFaces: "different verified route" })).toBe("layout");
  });

  it("leaves publisher typography and fixed formats without reading-family faces", () => {
    const p = presentationFromPreferences({ ...policy, publisherStyles: true }, "https://reader.example");
    expect(p.fontFamily).toBeNull();
    expect(p.fontFaces).toBe("");
    expect(chooseReaderFontRoute(policy, undefined, { fixed: true, release }).kind).toBe("publisher");
  });

  it("accounts for a later section and pristine linked CSS without loading resources", async () => {
    const calls: string[] = [];
    const facts = await collectBookFontFacts([
      { read: () => markup("word") },
      { read: () => '<html lang="en"><head><link rel="stylesheet" href="book.css"></head><body>other</body></html>',
        readStylesheet: async href => { calls.push(href); return "h1{font-weight:600}"; } },
    ], "en", new AbortController().signal);
    expect(calls).toEqual(["book.css"]);
    expect(chooseReaderFontRoute(policy, facts, { release }).kind).toBe("full");
    const missing = await collectBookFontFacts([{ read: () => markup("word") }, {}], "en", new AbortController().signal);
    expect(missing.complete).toBe(false);
  });

  it("does not accept canceled preflight delivery", async () => {
    const owner = new AbortController();
    await expect(collectBookFontFacts([{ read: async () => { owner.abort(); return markup("word"); } }], "en", owner.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects declared oversized sources before reading them", async () => {
    let reads = 0;
    const facts = await collectBookFontFacts([{ sourceBytes: 2_000_000, read: () => { reads++; return markup("word"); } }], "en", new AbortController().signal);
    expect(facts.complete).toBe(false);
    expect(reads).toBe(0);
  });
});

describe("font resource gate", () => {
  it("awaits the decision before the original resource loader", async () => {
    const calls: string[] = [];
    let releaseDecision!: () => void;
    const decision = new Promise<void>(resolve => { releaseDecision = resolve; });
    const load = guardFontResourceLoad(async () => { calls.push("resource"); return "iframe source"; },
      async () => { calls.push("decision"); await decision; }, new AbortController().signal);
    const result = load();
    expect(calls).toEqual(["decision"]);
    releaseDecision();
    expect(await result).toBe("iframe source");
    expect(calls).toEqual(["decision", "resource"]);
  });

  it("prevents a retired decision from starting resources", async () => {
    const owner = new AbortController();
    let calls = 0;
    const load = guardFontResourceLoad(async () => { calls++; return "source"; }, () => owner.abort(), owner.signal);
    await expect(load()).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("refuses late attachment data after the engine retires", async () => {
    const owner = new AbortController();
    const load = guardFontResourceLoad(async () => { owner.abort(); return "late source"; }, () => {}, owner.signal);
    await expect(load()).rejects.toMatchObject({ name: "AbortError" });
  });
});
