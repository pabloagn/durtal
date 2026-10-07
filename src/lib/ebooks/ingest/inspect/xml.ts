import { Parser } from "htmlparser2";

/*
 * A small XML tree for OPF, NCX, FB2, ComicInfo and container documents
 * (SLN-494), read with htmlparser2. Elements and attributes are looked up by
 * their local name, whatever prefix the file gave them ("dc:title",
 * "opf:role", "xlink:href").
 */

export interface XmlElement {
  /** The name as written: "dc:title" */
  name: string;
  /** The local name in lower case: "title" */
  local: string;
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

const localName = (name: string) => name.replace(/^.*:/, "").toLowerCase();

export function parseXml(text: string): XmlElement {
  const root: XmlElement = { name: "#document", local: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const element: XmlElement = { name, local: localName(name), attrs, children: [] };
        stack[stack.length - 1].children.push(element);
        stack.push(element);
      },
      ontext(data) {
        stack[stack.length - 1].children.push(data);
      },
      onclosetag() {
        if (stack.length > 1) stack.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.write(text.replace(/^﻿/, ""));
  parser.end();
  return root;
}

const isElement = (node: XmlElement | string): node is XmlElement => typeof node !== "string";

/** The element's child elements, all or those with this local name */
export function childElements(node: XmlElement, local?: string): XmlElement[] {
  const want = local?.toLowerCase();
  return node.children.filter(isElement).filter((c) => !want || c.local === want);
}

export function firstChild(node: XmlElement, local: string): XmlElement | null {
  return childElements(node, local)[0] ?? null;
}

/** Every descendant element with this local name, in document order */
export function descendants(node: XmlElement, local: string): XmlElement[] {
  const want = local.toLowerCase();
  const found: XmlElement[] = [];
  const walk = (n: XmlElement) => {
    for (const c of n.children) {
      if (!isElement(c)) continue;
      if (c.local === want) found.push(c);
      walk(c);
    }
  };
  walk(node);
  return found;
}

export function firstDescendant(node: XmlElement, local: string): XmlElement | null {
  const want = local.toLowerCase();
  for (const c of node.children) {
    if (!isElement(c)) continue;
    if (c.local === want) return c;
    const deeper = firstDescendant(c, want);
    if (deeper) return deeper;
  }
  return null;
}

/** All the text inside, white space collapsed */
export function textOf(node: XmlElement | null | undefined): string {
  if (!node) return "";
  const parts: string[] = [];
  const walk = (n: XmlElement) => n.children.forEach((c) => (isElement(c) ? walk(c) : parts.push(c)));
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** An attribute by its local name ("role" finds "opf:role"); null when absent */
export function attr(node: XmlElement | null | undefined, local: string): string | null {
  if (!node) return null;
  const want = local.toLowerCase();
  if (node.attrs[local] !== undefined) return node.attrs[local];
  for (const [name, value] of Object.entries(node.attrs)) if (localName(name) === want) return value;
  return null;
}
