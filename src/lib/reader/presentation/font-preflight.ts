import { Parser } from "htmlparser2";
import postcss from "postcss";
import { FONT_PREFLIGHT_LIMITS, UNKNOWN_FONT_FACTS, type FontWindowFacts } from "./font-facts";

/** This first profile admits normal features only; advanced declarations retain full fonts. */
export function inspectFontMarkup(
  markup: string,
  language: string | null,
  stylesheets: Readonly<Record<string, string>> = {},
): FontWindowFacts {
  const reasons = new Set<string>();
  const points = new Set<number>();
  const languages = new Set<string>();
  if (language?.trim()) languages.add(language.trim().toLowerCase());
  if (markup.length > FONT_PREFLIGHT_LIMITS.characters) return {
    ...UNKNOWN_FONT_FACTS, reasons: ["preflight-limit"],
  };
  const stack: { name: string; bold: boolean; style: boolean }[] = [];
  const css: string[] = [];
  let boldMarkup = false;
  let boldDeclaration = false;
  let styleText = "";
  if (/<!doctype[^>]*(?:\[|\b(?:system|public)\b)/i.test(markup)) reasons.add("unresolved-doctype");
  if (markup.includes("<![CDATA[")) reasons.add("unresolved-content");
  const inspectCSS = (text: string) => {
    if (text.length > 65_536) { reasons.add("preflight-limit"); return; }
    try {
      const sheet = postcss.parse(text);
      sheet.walkAtRules(rule => {
        // Scan no conditional branch optimistically. Imported/embedded fonts may also transfer.
        if (rule.name.toLowerCase() !== "namespace") reasons.add("unresolved-css-rule");
      });
      sheet.walkRules(rule => {
        if (/::?|\\/.test(rule.selector)) reasons.add("unresolved-selector");
      });
      sheet.walkDecls(declaration => {
        const name = declaration.prop.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/, "");
        const value = declaration.value.trim().toLowerCase();
        if (declaration.prop.includes("\\")) reasons.add("unresolved-typography");
        if (name.startsWith("--") || /(?:var|env|attr)\s*\(/i.test(value)) reasons.add("dynamic-css");
        if (name === "font-weight") {
          if (!["normal", "bold", "400", "700"].includes(value)) reasons.add("unsupported-weight");
          if (value === "bold" || value === "700") boldDeclaration = true;
        } else if (name === "font-style") {
          if (value !== "normal" && value !== "italic") reasons.add("unsupported-style");
        } else if (name === "font-feature-settings" || name.startsWith("font-variant")) {
          if (value !== "normal") reasons.add("unverified-features");
        } else if (name === "font-kerning") {
          if (value !== "auto") reasons.add("unverified-features");
        } else if (name === "font-size") {
          if (!/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|em|rem|%)$/.test(value)) reasons.add("unresolved-size");
        } else if (name === "font" || name.startsWith("font-") || name === "all") {
          reasons.add("unresolved-typography");
        } else if (name.startsWith("animation") || name.startsWith("transition") || name === "content" || name.startsWith("counter-")) {
          reasons.add("dynamic-typography");
        } else if (name === "writing-mode" && value !== "horizontal-tb") {
          reasons.add("unsupported-writing-mode");
        } else if ((name === "direction" && value !== "ltr") || name === "unicode-bidi") {
          reasons.add("unsupported-direction");
        } else if ((name === "text-rendering" && value !== "auto") || (name === "text-combine-upright" && value !== "none")) {
          reasons.add("unverified-features");
        } else if (name === "text-transform" && value !== "none") {
          reasons.add("transformed-text");
        } else if (name === "list-style" || name === "list-style-type") {
          // A marker's glyphs are not represented by the source's text nodes.
          if (value !== "none") reasons.add("generated-text");
        }
      });
    } catch { reasons.add("malformed-css"); }
  };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (stack.length >= 64) { reasons.add("preflight-limit"); return; }
      const parent = stack.at(-1);
      const bold = ["b", "strong", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name);
      if ((name === "b" || name === "strong") && parent?.bold) reasons.add("relative-bold-weight");
      boldMarkup ||= name === "b" || name === "strong";
      if (["script", "iframe", "object", "embed", "svg", "math", "pre", "code", "kbd", "samp", "tt"].includes(name)) reasons.add("unresolved-content-fonts");
      if (["base", "input", "textarea", "select", "button", "ruby"].includes(name) || name.includes("-") || Object.hasOwn(attributes, "contenteditable") || Object.hasOwn(attributes, "is")) reasons.add("dynamic-content");
      if (["ol", "ul", "li"].includes(name)) reasons.add("generated-text");
      if (name === "link") {
        const rel = (attributes.rel ?? "").toLowerCase().split(/\s+/);
        if (rel.includes("stylesheet")) {
          const sheet = stylesheets[attributes.href ?? ""];
          if (typeof sheet === "string" && !rel.includes("alternate") && !attributes.media && !Object.hasOwn(attributes, "disabled")) css.push(sheet);
          else reasons.add("external-styles-or-preloads");
        }
        if (rel.includes("preload") || rel.includes("modulepreload")) reasons.add("external-styles-or-preloads");
      }
      if (name === "meta" && attributes["http-equiv"]) reasons.add("dynamic-content");
      for (const [key, value] of Object.entries(attributes)) {
        if (key.startsWith("on")) reasons.add("dynamic-content");
        if (key === "lang" || key === "xml:lang") {
          if (value.trim()) languages.add(value.trim().toLowerCase());
          else reasons.add("unresolved-language");
        }
        if (key === "style") css.push(`x{${value}}`);
        if (["alt", "title", "aria-label"].includes(key))
          for (const char of value) points.add(char.codePointAt(0)!);
        if (["face", "size", "color"].includes(key) && name === "font") reasons.add("legacy-font-declaration");
        if (key === "dir" && value.toLowerCase() !== "ltr") reasons.add("unsupported-direction");
      }
      stack.push({ name, bold: bold || !!parent?.bold, style: name === "style" });
      if (name === "style") styleText = "";
    },
    ontext(text) {
      if (stack.at(-1)?.style) styleText += text;
      else if (!stack.some(frame => frame.name === "script")) {
        for (const char of text) {
          // These controls create whitespace, not a font glyph request.
          if (char !== "\n" && char !== "\r" && char !== "\t") points.add(char.codePointAt(0)!);
        }
      }
    },
    onclosetag(name, implied) {
      if (implied && !["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"].includes(name)) reasons.add("malformed-markup");
      if (name === "style") { css.push(styleText); styleText = ""; }
      stack.pop();
    },
    onprocessinginstruction(name) {
      if (name.toLowerCase() !== "?xml" && name.toLowerCase() !== "!doctype") reasons.add("unresolved-processing-instruction");
    },
  }, { decodeEntities: true });
  parser.end(markup);
  for (const text of css) inspectCSS(text);
  if (boldMarkup && boldDeclaration) reasons.add("relative-bold-weight");
  if (!languages.size) reasons.add("unresolved-language");
  return { complete: reasons.size === 0, reasons: [...reasons], codepoints: [...points].sort((a, b) => a - b), languages: [...languages].sort() };
}

/** Every section must be accounted for; callers must not substitute a first-page sample. */
export async function collectBookFontFacts(
  sections: readonly {
    sourceBytes?: number;
    read?: () => Promise<string | null> | string | null;
    readStylesheet?: (href: string) => Promise<string | null>;
  }[],
  language: string | null,
  signal: AbortSignal,
): Promise<FontWindowFacts> {
  signal.throwIfAborted();
  if (!sections.length || sections.length > FONT_PREFLIGHT_LIMITS.sections) return {
    ...UNKNOWN_FONT_FACTS, reasons: ["preflight-limit"],
  };
  const declaredBytes = sections.reduce((sum, section) => sum + (section.sourceBytes ?? 0), 0);
  if (sections.some(section => Object.hasOwn(section, "sourceBytes") && (section.sourceBytes === undefined || !Number.isSafeInteger(section.sourceBytes) || section.sourceBytes <= 0)) || declaredBytes > FONT_PREFLIGHT_LIMITS.characters)
    return { ...UNKNOWN_FONT_FACTS, reasons: ["preflight-limit"] };
  const reasons = new Set<string>();
  const points = new Set<number>();
  const languages = new Set<string>();
  let characters = 0;
  for (const section of sections) {
    signal.throwIfAborted();
    if (!section.read) return { ...UNKNOWN_FONT_FACTS, reasons: ["source-facts-unavailable"] };
    let markup: string | null;
    try { markup = await section.read(); }
    catch {
      signal.throwIfAborted();
      return { ...UNKNOWN_FONT_FACTS, reasons: ["source-facts-unavailable"] };
    }
    signal.throwIfAborted();
    if (typeof markup !== "string" || (characters += markup.length) > FONT_PREFLIGHT_LIMITS.characters)
      return { ...UNKNOWN_FONT_FACTS, reasons: ["preflight-limit"] };
    const hrefs = new Set<string>();
    const links = new Parser({ onopentag(name, attributes) {
      if (name === "link" && /(?:^|\s)stylesheet(?:\s|$)/i.test(attributes.rel ?? "")) hrefs.add(attributes.href ?? "");
    } }, { decodeEntities: true });
    links.end(markup);
    const stylesheets: Record<string, string> = Object.create(null);
    if (hrefs.size > 16) return { ...UNKNOWN_FONT_FACTS, reasons: ["preflight-limit"] };
    for (const href of hrefs) {
      signal.throwIfAborted();
      if (!section.readStylesheet) break;
      let text: string | null;
      try { text = await section.readStylesheet(href); }
      catch { signal.throwIfAborted(); break; }
      signal.throwIfAborted();
      if (text === null) break;
      if ((characters += text.length) > FONT_PREFLIGHT_LIMITS.characters) return { ...UNKNOWN_FONT_FACTS, reasons: ["preflight-limit"] };
      stylesheets[href] = text;
    }
    const facts = inspectFontMarkup(markup, language, stylesheets);
    for (const reason of facts.reasons) reasons.add(reason);
    for (const point of facts.codepoints) points.add(point);
    for (const lang of facts.languages) languages.add(lang);
    // Continuing after a full-font decision would add reading cost without changing the route.
    if (!facts.complete) return facts;
  }
  return { complete: reasons.size === 0, reasons: [...reasons], codepoints: [...points].sort((a, b) => a - b), languages: [...languages].sort() };
}
