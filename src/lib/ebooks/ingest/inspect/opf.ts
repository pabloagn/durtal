import { attr, childElements, descendants, firstDescendant, parseXml, textOf, type XmlElement } from "./xml";
import type { FileAuthor, FileMetadata } from "./types";

/*
 * An OPF package document (SLN-494): the one inside an EPUB, or a sidecar
 * `metadata.opf` a library manager wrote beside the files. EPUB 2 attributes
 * (opf:role, opf:file-as, opf:scheme) and EPUB 3 refinements (role, file-as,
 * identifier-type, title-type, belongs-to-collection with group-position)
 * are both read. Ratings, read dates and custom columns are only noticed,
 * never read into the metadata.
 */

export interface OpfManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

export interface OpfDocument {
  version: string;
  metadata: FileMetadata;
  /** The uuid identifier (opf:scheme="uuid", the uuid_id identifier or a urn:uuid:), lower case */
  uuid: string | null;
  manifest: OpfManifestItem[];
  spine: { idref: string; linear: boolean; properties: string[] }[];
  spineToc: string | null;
  direction: "ltr" | "rtl" | "default";
  fixedLayout: boolean;
  /** The id the `cover` meta names */
  coverMetaId: string | null;
  guide: { type: string; href: string }[];
  /** A rating, read dates or custom columns: counted by the plan, never imported */
  hasPersonalData: boolean;
}

/** ONIX code list 5: 15 ISBN-13, 02 ISBN-10, 03 GTIN-13 */
const ONIX_ISBN = new Set(["02", "03", "15"]);
const UUID = /^(?:urn:uuid:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const split = (value: string | null) => (value ?? "").split(/\s+/).filter(Boolean);

function refinements(metadata: XmlElement) {
  const byId = new Map<string, { property: string; value: string }[]>();
  for (const meta of childElements(metadata, "meta")) {
    const refines = attr(meta, "refines");
    const property = attr(meta, "property");
    if (!refines || !property) continue;
    const id = refines.replace(/^#/, "");
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id)!.push({ property: property.replace(/^.*:/, "").toLowerCase(), value: textOf(meta) });
  }
  return (id: string | null, property: string) =>
    id ? (byId.get(id) ?? []).find((r) => r.property === property)?.value ?? null : null;
}

/** An identifier's scheme and value: ISBN from opf:scheme, urn:isbn:, isbn: or an identifier-type refinement */
function identifier(element: XmlElement, refined: (id: string | null, p: string) => string | null) {
  const raw = textOf(element);
  if (!raw) return null;
  const scheme = attr(element, "scheme")?.toLowerCase() ?? null;
  const type = refined(attr(element, "id"), "identifier-type");
  const urn = /^urn:([a-z0-9-]+):(.+)$/i.exec(raw) ?? /^(isbn|asin|doi|uuid|google|goodreads|amazon|oclc):(.+)$/i.exec(raw);
  if (urn) return { scheme: urn[1].toLowerCase(), value: urn[2].trim() };
  if (type && ONIX_ISBN.has(type)) return { scheme: "isbn", value: raw };
  if (scheme) return { scheme, value: raw };
  if (UUID.test(raw)) return { scheme: "uuid", value: raw };
  return { scheme: "unknown", value: raw };
}

export function parseOpf(xml: string): OpfDocument {
  const doc = parseXml(xml);
  const pkg = firstDescendant(doc, "package");
  if (!pkg) throw new Error("No package element");
  const metadata = firstDescendant(pkg, "metadata") ?? { name: "metadata", local: "metadata", attrs: {}, children: [] };
  const refined = refinements(metadata);
  const metas = childElements(metadata, "meta");
  const named = (name: string) => metas.find((m) => attr(m, "name")?.toLowerCase() === name)?.attrs.content ?? null;
  const property = (name: string) => metas.find((m) => attr(m, "property")?.toLowerCase() === name && !attr(m, "refines"));
  const dc = (local: string) => childElements(metadata, local);

  // Titles: the main one first; a subtitle by EPUB 3's title-type
  let title: string | null = null;
  let subtitle: string | null = null;
  for (const element of dc("title")) {
    const type = refined(attr(element, "id"), "title-type");
    if (type === "subtitle") subtitle ??= textOf(element) || null;
    else if (!title || type === "main") title = textOf(element) || title;
  }

  const authors: FileAuthor[] = dc("creator").map((element) => {
    const id = attr(element, "id");
    return {
      name: textOf(element),
      fileAs: attr(element, "file-as") ?? refined(id, "file-as"),
      role: (attr(element, "role") ?? refined(id, "role"))?.toLowerCase() ?? null,
    };
  });

  const identifiers = dc("identifier")
    .map((element) => identifier(element, refined))
    .filter((id): id is { scheme: string; value: string } => !!id);
  const uuidElement =
    dc("identifier").find((e) => attr(e, "scheme")?.toLowerCase() === "uuid") ??
    dc("identifier").find((e) => attr(e, "id") === "uuid_id") ??
    dc("identifier").find((e) => UUID.test(textOf(e)));
  const uuid = uuidElement ? (UUID.exec(textOf(uuidElement))?.[1] ?? textOf(uuidElement)).toLowerCase() || null : null;

  // The publication date: not a modification date
  const dates = dc("date").filter((e) => !/modification/i.test(attr(e, "event") ?? ""));

  // Series: the calibre:series and calibre:series_index metas, else an EPUB 3 collection
  let series = named("calibre:series");
  let seriesIndex = named("calibre:series_index") ? Number(named("calibre:series_index")) : null;
  if (!series) {
    const collection = metas.find(
      (m) => attr(m, "property") === "belongs-to-collection" && (refined(attr(m, "id"), "collection-type") ?? "series") === "series",
    );
    if (collection) {
      series = textOf(collection) || null;
      const position = refined(attr(collection, "id"), "group-position");
      seriesIndex = position ? Number(position) : null;
    }
  }

  const manifestElement = firstDescendant(pkg, "manifest");
  const manifest = (manifestElement ? childElements(manifestElement, "item") : []).map((item) => ({
    id: attr(item, "id") ?? "",
    href: attr(item, "href") ?? "",
    mediaType: (attr(item, "media-type") ?? "").toLowerCase(),
    properties: split(attr(item, "properties")),
  }));
  const spineElement = firstDescendant(pkg, "spine");
  const spine = (spineElement ? childElements(spineElement, "itemref") : []).map((ref) => ({
    idref: attr(ref, "idref") ?? "",
    linear: (attr(ref, "linear") ?? "yes").toLowerCase() !== "no",
    properties: split(attr(ref, "properties")),
  }));
  const direction = (attr(spineElement, "page-progression-direction") ?? "default").toLowerCase();
  const layout = textOf(property("rendition:layout")) || null;
  const guideElement = firstDescendant(pkg, "guide");

  return {
    version: attr(pkg, "version") ?? "2.0",
    metadata: {
      title,
      subtitle,
      authors,
      language: textOf(dc("language")[0]) || null,
      identifiers,
      publisher: textOf(dc("publisher")[0]) || null,
      date: textOf(dates[0]) || null,
      // Usually escaped HTML, kept as written for metadata.ts to clean; markup as elements is read as text
      description: dc("description").map((d) => (d.children.every((c) => typeof c === "string") ? d.children.join("") : textOf(d)))[0] ?? null,
      subjects: dc("subject").map((s) => textOf(s)).filter(Boolean),
      series,
      seriesIndex: Number.isFinite(seriesIndex) ? seriesIndex : null,
    },
    uuid,
    manifest,
    spine,
    spineToc: attr(spineElement, "toc"),
    direction: direction === "rtl" || direction === "ltr" ? direction : "default",
    fixedLayout: layout === "pre-paginated" || named("fixed-layout") === "true",
    coverMetaId: named("cover"),
    guide: (guideElement ? descendants(guideElement, "reference") : []).map((r) => ({
      type: (attr(r, "type") ?? "").toLowerCase(),
      href: attr(r, "href") ?? "",
    })),
    hasPersonalData: metas.some((m) => {
      const name = attr(m, "name")?.toLowerCase() ?? "";
      return name === "calibre:rating" || name.startsWith("calibre:user_metadata");
    }),
  };
}
