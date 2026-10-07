import type { ByteSource } from "../source";
import { openZip, resolveHref, type OpenZip } from "../zip";
import { epubDrm } from "./drm";
import { parseOpf, type OpfDocument } from "./opf";
import { attr, descendants, firstDescendant, parseXml } from "./xml";
import { emptyInspection, type CoverRef, type Inspection } from "./types";

/*
 * EPUB 2 and 3, and Kobo's KEPUB (SLN-494): container.xml to the package
 * document, its metadata, the spine (which must be non-empty with every item
 * present), the nav, NCX and page list, the cover and the text by spine
 * order, split into body and front or back matter.
 */

/** Landmark and epub:type values that mark front or back matter */
const FRONT_BACK = new Set(["frontmatter", "backmatter", "toc", "copyright-page", "index", "bibliography", "acknowledgments", "acknowledgements", "colophon"]);
const IMAGE = /^image\//;

export interface EpubInspection extends Inspection {
  opf: OpfDocument | null;
}

async function readText(zip: OpenZip, name: string): Promise<string | null> {
  try {
    return await zip.text(name);
  } catch {
    return null;
  }
}

/** The first image a document shows: an img src, or an SVG image's href */
function firstImage(xhtml: string, documentPath: string): string | null {
  const doc = parseXml(xhtml);
  const img = firstDescendant(doc, "img");
  const src = attr(img, "src") ?? attr(firstDescendant(doc, "image"), "href");
  return src ? resolveHref(documentPath, src) : null;
}

/** The nav document's lists: the landmarks (type and target) and the page-list's length */
function readNav(xhtml: string, navPath: string) {
  const doc = parseXml(xhtml);
  const landmarks: { type: string; href: string }[] = [];
  let pages = 0;
  for (const nav of descendants(doc, "nav")) {
    const types = (attr(nav, "type") ?? "").split(/\s+/);
    if (types.includes("page-list")) pages += descendants(nav, "a").length;
    if (types.includes("landmarks"))
      for (const a of descendants(nav, "a")) {
        const href = attr(a, "href");
        for (const type of (attr(a, "type") ?? "").split(/\s+/).filter(Boolean)) if (href) landmarks.push({ type, href: resolveHref(navPath, href) });
      }
  }
  return { landmarks, pages };
}

/** The NCX's page list length */
function ncxPages(xml: string): number {
  const list = firstDescendant(parseXml(xml), "pagelist");
  return list ? descendants(list, "pagetarget").length : 0;
}

/** epub:type on the document's body or first section */
function documentTypes(xhtml: string): string[] {
  const match = /<(?:body|section)\b[^>]*\bepub:type\s*=\s*["']([^"']+)["']/i.exec(xhtml);
  return match ? match[1].split(/\s+/) : [];
}

export async function inspectEpub(source: ByteSource, format: "epub" | "kepub"): Promise<EpubInspection> {
  const fail = (problem: string, extra: Partial<EpubInspection> = {}): EpubInspection => ({ ...emptyInspection(format, extra), problem, opf: extra.opf ?? null });
  let zip: OpenZip;
  try {
    zip = await openZip(source);
  } catch (error) {
    return fail((error as Error).message);
  }
  const zipFacts = zip.directory ? { cdOffset: zip.directory.cdOffset, cdSize: zip.directory.cdSize, entries: zip.directory.entries } : null;

  const encryption = zip.names.find((n) => n.toLowerCase() === "meta-inf/encryption.xml");
  const drm = epubDrm(zip.names, encryption ? await readText(zip, encryption) : null);

  const container = await readText(zip, "META-INF/container.xml");
  if (container === null) return fail("Damaged EPUB: META-INF/container.xml is missing", { drm });
  const opfPath = attr(firstDescendant(parseXml(container), "rootfile"), "full-path");
  if (!opfPath) return fail("Damaged EPUB: container.xml names no package document", { drm });
  const opfText = await readText(zip, opfPath);
  if (opfText === null) return fail(`Damaged EPUB: the package document ${opfPath} is missing`, { drm });
  let opf: OpfDocument;
  try {
    opf = parseOpf(opfText);
  } catch {
    return fail("Damaged EPUB: the package document cannot be read", { drm });
  }

  const manifest = { ...(zipFacts ? { zip: { ...zipFacts, opfPath } } : {}) };
  const byId = new Map(opf.manifest.map((item) => [item.id, { ...item, path: resolveHref(opfPath, item.href) }]));
  const has = (path: string) => zip.entries.has(path);
  const nav = opf.manifest.find((item) => item.properties.includes("nav"));
  const ncx = (opf.spineToc ? byId.get(opf.spineToc) : undefined) ?? [...byId.values()].find((i) => i.mediaType === "application/x-dtbncx+xml");
  const navInfo = nav ? readNav((await readText(zip, resolveHref(opfPath, nav.href))) ?? "", resolveHref(opfPath, nav.href)) : { landmarks: [], pages: 0 };
  const ncxPageCount = ncx ? ncxPages((await readText(zip, ncx.path)) ?? "") : 0;
  const pageCount = navInfo.pages || ncxPageCount;
  const epubFacts = { version: opf.version, fixedLayout: opf.fixedLayout, direction: opf.direction, hasPageList: pageCount > 0 };
  const details = { epubVersion: opf.version, fixedLayout: opf.fixedLayout, direction: opf.direction, hasNav: !!nav, hasNcx: !!ncx, hasPageList: pageCount > 0, printPages: pageCount || null };
  const withFacts = { metadata: opf.metadata, drm, manifest: { ...manifest, epub: epubFacts }, details, opf };
  if (drm) return { ...emptyInspection(format), ...withFacts };

  // The spine: non-empty, every item in the manifest and in the zip
  if (opf.spine.length === 0) return fail("Empty spine: the EPUB lists no chapters", withFacts);
  const spine = opf.spine.map((ref) => ({ ref, item: byId.get(ref.idref) }));
  const missing = spine.find(({ item }) => !item || !has(item.path));
  if (missing) return fail(`Damaged EPUB: the chapter ${missing.item?.href ?? missing.ref.idref} is missing`, withFacts);

  // Front and back matter: landmarks (or the EPUB 2 guide), linear="no" and the document's own epub:type
  const guide = opf.guide.map((g) => ({ type: g.type === "text" ? "bodymatter" : g.type, href: resolveHref(opfPath, g.href) }));
  const marks = navInfo.landmarks.length ? navInfo.landmarks : guide;
  const index = (path: string) => spine.findIndex(({ item }) => item!.path === path);
  const bodyStart = marks.filter((m) => m.type === "bodymatter").map((m) => index(m.href)).find((i) => i >= 0) ?? -1;
  const backStart = marks.filter((m) => m.type === "backmatter").map((m) => index(m.href)).find((i) => i >= 0) ?? -1;
  const marked = new Set(marks.filter((m) => FRONT_BACK.has(m.type)).map((m) => m.href));

  const parts: { html: string; matter: "body" | "front-back" }[] = [];
  for (const [i, { ref, item }] of spine.entries()) {
    if (!/x?html|xml/.test(item!.mediaType)) continue;
    const html = await readText(zip, item!.path);
    if (html === null) return fail(`Damaged EPUB: the chapter ${item!.href} cannot be read`, withFacts);
    const frontBack =
      !ref.linear ||
      marked.has(item!.path) ||
      (bodyStart > 0 && i < bodyStart) ||
      (backStart >= 0 && i >= backStart) ||
      documentTypes(html).some((t) => FRONT_BACK.has(t.replace(/^.*:/, "")));
    parts.push({ html, matter: frontBack ? "front-back" : "body" });
  }

  // The cover: cover-image, the cover meta, the guide's cover page, then the first spine item's first image
  let coverPath: string | null = null;
  const coverImage = [...byId.values()].find((i) => i.properties.includes("cover-image"));
  const coverMeta = opf.coverMetaId ? byId.get(opf.coverMetaId) : undefined;
  if (coverImage && has(coverImage.path)) coverPath = coverImage.path;
  else if (coverMeta && IMAGE.test(coverMeta.mediaType) && has(coverMeta.path)) coverPath = coverMeta.path;
  else {
    const pages = [
      coverMeta && !IMAGE.test(coverMeta.mediaType) ? coverMeta.path : null,
      guide.find((g) => g.type === "cover")?.href ?? null,
      spine[0].item!.path,
    ].filter((p): p is string => !!p && has(p));
    for (const page of pages) {
      const image = firstImage((await readText(zip, page)) ?? "", page);
      if (image && has(image)) {
        coverPath = image;
        break;
      }
    }
  }
  const cover: CoverRef | null = coverPath ? { kind: "bytes", load: () => zip.bytes(coverPath) } : null;

  return {
    ...emptyInspection(format),
    ...withFacts,
    cover,
    text: { kind: "html", parts, printPages: pageCount || null },
  };
}
