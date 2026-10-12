import { LOOKUP_LIMITS } from "./policy";

const ALLOWED = new Set(
  "p br b strong i em u small sup sub span ol ul li dl dt dd a".split(" "),
);
const encoder = new TextEncoder();
const escapeText = (text: string) =>
  text.replace(
    /[&<>]/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!,
  );
const escapeAttribute = (text: string) =>
  escapeText(text).replaceAll('"', "&quot;");

/** Parse inside a template: rejected images/styles cannot load resources while being cleaned. */
export function lookupHtmlDocument(html: string): HTMLTemplateElement {
  if (
    html.length > LOOKUP_LIMITS.parseResponseBytes ||
    encoder.encode(html).byteLength > LOOKUP_LIMITS.parseResponseBytes
  )
    throw new Error("The lookup response is too large");
  const doc = new DOMParser().parseFromString(
    "<!doctype html><body></body>",
    "text/html",
  );
  const template = doc.createElement("template");
  template.innerHTML = html;
  return template;
}

/** A tag-only fragment is not a definition or a Wikipedia extract. */
export function hasLookupText(html: string): boolean {
  return !!lookupHtmlDocument(html).content.textContent?.trim();
}

/** No provider or pack styling, image, executable attribute or non-HTTPS link survives. */
export function sanitizeLookupHtml(
  html: string,
  options: { base: string; maxBytes?: number },
): string {
  const limit = options.maxBytes ?? LOOKUP_LIMITS.sectionBytes;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > LOOKUP_LIMITS.sectionBytes
  )
    throw new Error("Invalid lookup output limit");
  const base = new URL(options.base);
  if (base.protocol !== "https:" || base.username || base.password)
    throw new Error("Invalid lookup link base");
  const template = lookupHtmlDocument(html);
  const output: string[] = [];
  let remaining = limit;
  let visited = 0;
  function text(value: string) {
    let part = "";
    for (const char of value) {
      const escaped = escapeText(char);
      const size = encoder.encode(escaped).byteLength;
      if (size > remaining) break;
      remaining -= size;
      part += escaped;
    }
    output.push(part);
  }
  function walk(node: Node, depth: number) {
    if (remaining === 0 || ++visited > 4096 || depth > 64) return;
    if (node.nodeType === 3) {
      text(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    let opening = "",
      closing = "";
    if (ALLOWED.has(tag)) {
      opening = `<${tag}>`;
      closing = tag === "br" ? "" : `</${tag}>`;
      if (tag === "a") {
        try {
          const link = new URL(element.getAttribute("href") ?? "", base);
          if (
            !element.hasAttribute("href") ||
            link.protocol !== "https:" ||
            link.username ||
            link.password ||
            link.href.length > 2048
          )
            throw new Error("Invalid link");
          opening = `<a href="${escapeAttribute(link.href)}" target="_blank" rel="noopener noreferrer">`;
        } catch {
          opening = "";
          closing = "";
        }
      }
    }
    const openBytes = encoder.encode(opening).byteLength;
    const closeBytes = encoder.encode(closing).byteLength;
    if (openBytes + closeBytes <= remaining) {
      remaining -= openBytes + closeBytes;
      output.push(opening);
    } else {
      opening = "";
      closing = "";
    }
    for (const child of element.childNodes) {
      if (remaining === 0 || visited >= 4096) break;
      walk(child, depth + 1);
    }
    output.push(closing);
  }
  for (const node of template.content.childNodes) {
    if (remaining === 0 || visited >= 4096) break;
    walk(node, 0);
  }
  return output.join("");
}

/** XDXF tags become presentation only. In particular, kref never becomes a link. */
export function sanitizeXdxf(
  xml: string,
  options: { base: string; maxBytes?: number },
): string {
  if (
    xml.length > LOOKUP_LIMITS.responseBytes ||
    encoder.encode(xml).byteLength > LOOKUP_LIMITS.responseBytes
  )
    throw new Error("The dictionary entry is too large");
  // DTDs/entities are unnecessary for dictionary presentation; refuse rather than expand them.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported dictionary XML declaration");
  const doc = new DOMParser().parseFromString(
    `<xdxf>${xml}</xdxf>`,
    "application/xml",
  );
  if (doc.querySelector("parsererror"))
    throw new Error("Invalid dictionary XML");
  const tags: Record<string, string> = {
    k: "b",
    tr: "i",
    ex: "i",
    abr: "small",
    co: "small",
    dtrn: "span",
    kref: "span",
  };
  let visited = 0;
  function walk(node: Node, depth: number): string {
    if (++visited > 4096 || depth > 64) return "";
    if (node.nodeType === 3) return escapeText(node.textContent ?? "");
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const text = [...element.childNodes]
      .map((child) => walk(child, depth + 1))
      .join("");
    const tag = tags[element.localName];
    return tag ? `<${tag}>${text}</${tag}>` : text;
  }
  return sanitizeLookupHtml(walk(doc.documentElement, 0), options);
}
