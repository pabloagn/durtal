import type { ByteSource } from "../source";
import { MAX_ENTRY_BYTES, openZip } from "../zip";
import { attr, childElements, descendants, firstChild, firstDescendant, parseXml, textOf, type XmlElement } from "./xml";
import { emptyInspection, type FileAuthor, type Inspection } from "./types";

/*
 * FictionBook 2 (SLN-494), plain or zipped (FBZ): title-info (title,
 * authors, language, series, date, annotation), publish-info (publisher,
 * year, ISBN), the cover page's image, and the text of every body that is
 * not the notes.
 */

/** Elements after which the text breaks */
const BLOCKS = new Set(["p", "v", "title", "subtitle", "section", "stanza", "epigraph", "cite", "empty-line", "text-author", "poem", "table", "tr"]);

/** The declared encoding of an XML document ("windows-1251"), else UTF-8 */
export function decodeXml(bytes: Uint8Array): string {
  const prolog = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const declared = /encoding\s*=\s*["']([^"']+)["']/i.exec(prolog)?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function bodyText(body: XmlElement): string {
  const out: string[] = [];
  const walk = (node: XmlElement) => {
    for (const child of node.children) {
      if (typeof child === "string") out.push(child);
      else if (child.local !== "binary" && child.local !== "image") {
        walk(child);
        if (BLOCKS.has(child.local)) out.push("\n");
      }
    }
  };
  walk(body);
  return out.join("").replace(/[ \t]+/g, " ").replace(/ *\n\s*/g, "\n").trim();
}

function authorName(author: XmlElement): FileAuthor | null {
  const part = (local: string) => textOf(firstChild(author, local));
  const name = [part("first-name"), part("middle-name"), part("last-name")].filter(Boolean).join(" ") || part("nickname");
  if (!name) return null;
  const last = part("last-name");
  const first = [part("first-name"), part("middle-name")].filter(Boolean).join(" ");
  return { name, fileAs: last && first ? `${last}, ${first}` : null, role: "aut" };
}

/** A FictionBook document's inspection */
export function inspectFictionBook(xml: string, format: "fb2" | "fbz"): Inspection {
  let doc: XmlElement;
  try {
    doc = parseXml(xml);
  } catch {
    return emptyInspection(format, { problem: "Damaged FB2: the document cannot be read" });
  }
  const book = firstDescendant(doc, "fictionbook");
  if (!book) return emptyInspection(format, { problem: "Damaged FB2: no FictionBook element" });
  const description = firstChild(book, "description");
  const title = description ? firstChild(description, "title-info") : null;
  const publish = description ? firstChild(description, "publish-info") : null;
  const sequence = title ? firstChild(title, "sequence") : null;
  const date = title ? firstChild(title, "date") : null;
  const number = attr(sequence, "number");

  const coverPage = firstDescendant(title ?? book, "coverpage");
  const coverHref = attr(coverPage ? firstDescendant(coverPage, "image") : null, "href");
  const binary = coverHref?.startsWith("#") ? descendants(book, "binary").find((b) => attr(b, "id") === coverHref.slice(1)) : undefined;
  const cover = binary
    ? { kind: "bytes" as const, mediaType: attr(binary, "content-type"), load: async () => Uint8Array.from(Buffer.from(textOf(binary).replace(/\s+/g, ""), "base64")) }
    : null;

  const bodies = childElements(book, "body").filter((b) => (attr(b, "name") ?? "").toLowerCase() !== "notes");
  const text = bodies.map(bodyText).join("\n\n").trim();

  return emptyInspection(format, {
    metadata: {
      title: textOf(title ? firstChild(title, "book-title") : null) || null,
      authors: (title ? childElements(title, "author") : []).map(authorName).filter((a): a is FileAuthor => !!a),
      language: textOf(title ? firstChild(title, "lang") : null) || null,
      series: attr(sequence, "name"),
      seriesIndex: number && Number.isFinite(Number(number)) ? Number(number) : null,
      date: attr(date, "value") ?? (textOf(date) || textOf(publish ? firstChild(publish, "year") : null) || null),
      description: title && firstChild(title, "annotation") ? bodyText(firstChild(title, "annotation")!).split("\n").join("\n\n") : null,
      subjects: (title ? childElements(title, "genre") : []).map((g) => textOf(g)).filter(Boolean),
      publisher: textOf(publish ? firstChild(publish, "publisher") : null) || null,
      identifiers: textOf(publish ? firstChild(publish, "isbn") : null) ? [{ scheme: "isbn", value: textOf(firstChild(publish!, "isbn")) }] : [],
    },
    cover,
    text: text ? { kind: "plain", text } : { kind: "none", reason: "No text in the file" },
  });
}

export async function inspectFb2(source: ByteSource, format: "fb2" | "fbz"): Promise<Inspection> {
  if (format === "fb2") {
    if (source.size > MAX_ENTRY_BYTES) return emptyInspection(format, { problem: "FB2 larger than 64 MB: not read" });
    return inspectFictionBook(decodeXml(await source.read(0, source.size)), format);
  }
  try {
    const zip = await openZip(source);
    const name = zip.names.find((n) => n.toLowerCase().endsWith(".fb2"));
    if (!name) return emptyInspection(format, { problem: "Damaged FBZ: no .fb2 inside" });
    const inspection = inspectFictionBook(decodeXml(await zip.bytes(name)), format);
    const facts = zip.directory;
    return facts ? { ...inspection, manifest: { zip: { ...facts, opfPath: null } } } : inspection;
  } catch (error) {
    return emptyInspection(format, { problem: (error as Error).message });
  }
}
