import { DOMParser, parseHTML } from "linkedom";
import type { ExtractedPage } from "./evidence-store";
import { extractMainText } from "./extract";
import { sourceProfile, structuredSourceType, type SourceField } from "./source-profiles";
import { openLibraryAuthorKeys } from "./identity";

export interface RelatedAuthor { key: string; name: string }

export interface SourceSection {
  role: SourceField;
  start: number;
  end: number;
  locator: string;
}
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const strings = (value: unknown): string[] => {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return strings(v.name ?? v.value ?? v.key);
  }
  return [];
};

/** All locators refer to fields or sections of the primary record only. */
function record(parts: { field: SourceField; value: string; locator: string }[], url: string): ExtractedPage | null {
  const sections: SourceSection[] = [];
  let text = "";
  for (const p of parts) {
    const value = clean(p.value).normalize("NFC");
    if (!value) continue;
    if (text) text += "\n\n";
    const start = [...text].length;
    text += `${p.field}: ${value}`;
    sections.push({
      role: p.field,
      start,
      end: [...text].length,
      locator: p.locator,
    });
  }
  if (!text) return null;
  const get = (field: SourceField) =>
    parts
      .filter((p) => p.field === field)
      .map((p) => clean(p.value))
      .filter(Boolean)
      .join("; ") || null;
  return {
    text,
    title: get("title"),
    byline: get("contributors"),
    publishedOn: get("publication"),
    language: get("language"),
    canonicalUrl: url,
    fields: [...new Set(parts.filter((p) => clean(p.value)).map((p) => p.field))],
    sections,
    identityText: [get("title"), get("contributors")].filter(Boolean).join("\n"),
  };
}

function openLibrary(raw: string, url: string, authors: RelatedAuthor[] = []): ExtractedPage | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || Array.isArray(obj) || typeof obj !== "object" || typeof obj.title !== "string") return null;
  const key = typeof obj.key === "string" ? obj.key : "";
  // A response for a different work/edition is not the requested record.
  const path = new URL(url).pathname.replace(/\.json$/, "");
  if (!/^\/(works\/OL\d+W|books\/OL\d+M)$/.test(key) || (!path.startsWith("/isbn/") && key !== path)) return null;
  const mapping: [SourceField, string][] = [
    ["title", "title"],
    ["description", "description"],
    ["contributors", "authors"],
    ["identifiers", "isbn_13"],
    ["identifiers", "isbn_10"],
    ["publication", "publish_date"],
    ["publication", "first_publish_date"],
    ["language", "languages"],
    ["extent", "number_of_pages"],
  ];
  const references = openLibraryAuthorKeys(obj);
  const resolved = authors.filter((author) => references.includes(author.key));
  const parts = [
    { field: "record" as const, value: key, locator: "$.key" },
    ...mapping.filter(([, name]) => name !== "authors" || !references.length).map(([field, name]) => ({
      field,
      value: strings(obj[name]).join("; "),
      locator: `$.${name}`,
    })),
    ...resolved.map((author) => ({ field: "contributors" as const, value: author.name, locator: `$.authors -> ${author.key}#name` })),
  ];
  const result = record(parts, url);
  return result ? { ...result, partial: references.length > resolved.length } : null;
}

function bnf(raw: string, url: string): ExtractedPage | null {
  // Reject DTDs/entities; no network/entity expansion is used by the parser.
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) return null;
  const doc = new DOMParser().parseFromString(raw, "text/xml");
  const elements = [...doc.querySelectorAll("*")];
  const local = (el: Element) => el.localName.split(":").at(-1);
  const records = elements.filter((el) => local(el) === "record" && el.hasAttribute("type"));
  if (records.length !== 1 || elements.some((el) => local(el) === "diagnostic")) return null;
  const root = records[0];
  const fields = [...root.querySelectorAll("*")].filter((el) => local(el) === "datafield");
  const parts: { field: SourceField; value: string; locator: string }[] = [];
  let envelope = root.parentElement;
  while (envelope && local(envelope) !== "record") envelope = envelope.parentElement;
  const transportIdentity = envelope ? [...envelope.children].find((el) => local(el) === "recordIdentifier")?.textContent?.trim() : undefined;
  const normalizeArk = (value: string) => /^(?:https?:\/\/catalogue\.bnf\.fr\/|\/)?(ark:\/12148\/cb[0-9a-z]+)\/?$/i.exec(value.trim())?.[1].toLowerCase();
  const identities = [transportIdentity, ...[...root.querySelectorAll("*")].filter((el) => local(el) === "controlfield" && el.getAttribute("tag") === "003").map((el) => el.textContent)].filter((value): value is string => !!value).map(normalizeArk).filter((value): value is string => !!value);
  const query = new URL(url).searchParams.get("query") ?? "";
  const expectedArk = /ark:\/12148\/cb[0-9a-z]+/i.exec(query)?.[0];
  if (expectedArk && (!identities.length || identities.some((id) => id !== expectedArk.toLowerCase()))) return null;
  const identity = identities.find((id) => !!id);
  parts.push({
    field: "record",
    value: identity || expectedArk || "UNIMARC record",
    locator: "recordIdentifier",
  });
  for (const el of fields) {
    const tag = el.getAttribute("tag") ?? "";
    const sub = [...el.querySelectorAll("*")].filter((s) => local(s) === "subfield");
    const selected = (codes: string[]) => codes.flatMap((code) => sub.filter((s) => s.getAttribute("code") === code).map((s) => s.textContent ?? "")).join(" ");
    let field: SourceField | undefined;
    let codes: string[] = [];
    if (tag === "200") {
      field = "title";
      codes = ["a", "e"];
    }
    if (["700", "701", "702"].includes(tag)) {
      field = "contributors";
      codes = ["b", "a"];
    }
    if (tag === "010") {
      field = "identifiers";
      codes = ["a"];
    }
    if (["210", "214"].includes(tag)) {
      field = "publication";
      codes = ["d"];
    }
    if (tag === "101") {
      field = "language";
      codes = ["a"];
    }
    if (tag === "215") {
      field = "extent";
      codes = ["a"];
    }
    if (field)
      parts.push({
        field,
        value: selected(codes),
        locator: `datafield[tag=${tag}]/subfield[code=${codes.join(",")}]`,
      });
  }
  return record(parts, url);
}

function publisher(html: string, url: string): ExtractedPage | null {
  const { document } = parseHTML(html);
  const root = document.querySelector("main, article") ?? document;
  const h1 = clean(root.querySelector("h1")?.textContent ?? "");
  const books: Record<string, unknown>[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (!v || typeof v !== "object") return;
    const obj = v as Record<string, unknown>;
    if (strings(obj["@type"]).includes("Book")) books.push(obj);
    if (obj["@graph"]) visit(obj["@graph"]);
    if (obj.mainEntity) visit(obj.mainEntity);
  };
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {
      /* Incomplete structured data is not evidence. */
    }
  }
  const same = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase();
  const matching = books.filter((b) =>
    h1
      ? strings(b.name).some((name) => same(name, h1))
      : strings(b.url ?? b["@id"]).some((u) => {
          try {
            return new URL(u, url).pathname === new URL(url).pathname;
          } catch {
            return false;
          }
        }),
  );
  const book = matching.length === 1 ? matching[0] : null;
  const parts: { field: SourceField; value: string; locator: string }[] = [];
  if (book) {
    const mapping: [SourceField, string][] = [
      ["title", "name"],
      ["description", "description"],
      ["contributors", "author"],
      ["identifiers", "isbn"],
      ["publication", "datePublished"],
      ["language", "inLanguage"],
      ["extent", "numberOfPages"],
    ];
    for (const [field, key] of mapping) {
      const value = strings(book[key]).join("; ");
      const plain = field === "description" ? (parseHTML(`<html><body>${value}</body></html>`).document.body.textContent ?? "") : value;
      parts.push({ field, value: plain, locator: `Book.${key}` });
    }
  } else if (h1) parts.push({ field: "title", value: h1, locator: "main h1" });
  // Explicit book fields only; never Readability's concatenation of biography,
  // review blurbs and recommendations on a product page.
  for (const el of root.querySelectorAll(
    'nav, footer, aside, [class*="recommend"], [class*="review"], [class*="author-bio"], [id*="review"], [id*="author-bio"]',
  ))
    el.remove();
  for (const [field, property] of [
    ["description", "description"],
    ["contributors", "author"],
    ["identifiers", "isbn"],
    ["publication", "datePublished"],
    ["language", "inLanguage"],
    ["extent", "numberOfPages"],
  ] as [SourceField, string][]) {
    if (parts.some((p) => p.field === field && clean(p.value))) continue;
    const el = root.querySelector(`[itemprop="${property}"]`);
    const value = el?.getAttribute("content") || el?.textContent;
    if (value) parts.push({ field, value, locator: `[itemprop=${property}]` });
  }
  if (!parts.some((p) => p.field === "description" && clean(p.value))) {
    const headings = [...root.querySelectorAll("h2,h3,h4")].filter((el) =>
      /^(?:about (?:the|this) book|book description|description|synopsis|overview)$/i.test(clean(el.textContent ?? "")),
    );
    if (headings.length === 1) {
      const blocks: string[] = [];
      for (let el = headings[0].nextElementSibling; el && !/^H[1-6]$/.test(el.tagName); el = el.nextElementSibling) {
        if (el.querySelector("h1,h2,h3,h4,h5,h6")) break;
        if (el.textContent) blocks.push(el.textContent);
      }
      parts.push({
        field: "description",
        value: blocks.join("\n"),
        locator: `heading:${clean(headings[0].textContent ?? "")}`,
      });
    }
  }
  return record(parts, url);
}

/** Selects a format-aware extractor; unknown sources retain Readability. */
export function extractSourcePage(body: string, url: string, kind?: string, authors?: RelatedAuthor[]): ExtractedPage | null {
  switch (structuredSourceType(url)) {
    case "json":
      return openLibrary(body, url, authors);
    case "xml":
      return bnf(body, url);
  }
  if (sourceProfile(url, kind).key !== "article") return publisher(body, url);
  const result = extractMainText(body, url);
  if (!result) return null;
  return {
    ...result,
    fields: ["mainText", ...(result.title ? ["title" as const] : []), ...(result.byline ? ["contributors" as const] : [])],
    sections: [
      {
        role: "mainText",
        start: 0,
        end: [...result.text.normalize("NFC")].length,
        locator: "readability",
      },
    ],
  };
}

export const sourcePageExtractor = {
  name: "source-profile",
  version: "sln969.1",
  extract: extractSourcePage,
};
