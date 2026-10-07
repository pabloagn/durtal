import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import sharp from "sharp";

/*
 * E-book files made in code for the ingestion tests and the timing corpus
 * (SLN-494): small, valid and deterministic, so no binary fixture is
 * committed. Zips are written by hand (stored or deflated entries), MOBI as
 * a PalmDB with PalmDOC records and EXTH, PDFs as plain objects with an
 * xref table, optionally encrypted with the standard security handler.
 */

const enc = new TextEncoder();
const bytesOf = (data: string | Uint8Array) => (typeof data === "string" ? enc.encode(data) : data);

// ── Zip ─────────────────────────────────────────────────────────────────────

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
  /** Stored, not deflated (an EPUB's mimetype) */
  store?: boolean;
}

/** A zip of the entries, in order */
export function makeZip(entries: ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(bytesOf(entry.data));
    const store = entry.store || raw.length === 0;
    const body = store ? raw : deflateRawSync(raw);
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(0x21, 10); // 1980-01-01 00:00:00
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(0x21, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

// ── Images ──────────────────────────────────────────────────────────────────

/** A plain cover image, 300 × 450 by default */
export async function makeImage(format: "png" | "jpeg" = "png", options: { width?: number; height?: number; color?: string } = {}): Promise<Uint8Array> {
  const image = sharp({ create: { width: options.width ?? 300, height: options.height ?? 450, channels: 3, background: options.color ?? "#6b5b4b" } });
  return new Uint8Array(await (format === "png" ? image.png() : image.jpeg()).toBuffer());
}

// ── Text ────────────────────────────────────────────────────────────────────

const ENGLISH = "the reader who walks through the old house of the river finds that every room holds a letter and a lamp".split(" ");

/** `count` words of plain English prose, varied by `seed` */
export function words(count: number, seed = 0, vocabulary: string[] = ENGLISH): string {
  return Array.from({ length: count }, (_, i) => vocabulary[(i * 7 + seed) % vocabulary.length]).join(" ");
}

const xhtml = (title: string, body: string, attributes = "") =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title></head><body${attributes}>${body}</body></html>`;

// ── EPUB ────────────────────────────────────────────────────────────────────

export interface EpubChapter {
  id: string;
  href: string;
  /** The body's inner XHTML */
  body: string;
  bodyAttributes?: string;
  linear?: boolean;
}

export interface EpubOptions {
  version?: "2.0" | "3.0";
  /** The OPF's <metadata> content */
  metadata?: string;
  chapters?: EpubChapter[];
  /** More <manifest> items */
  manifest?: string;
  cover?: Uint8Array;
  /** EPUB 3 nav's landmarks and page-list, as <nav> elements */
  navExtra?: string;
  guide?: string;
  /** More zip entries (META-INF/encryption.xml, rights.xml) */
  entries?: ZipEntry[];
  /** Entries the manifest names but the zip leaves out */
  omit?: string[];
  /** "spine" attributes, such as page-progression-direction="rtl" */
  spineAttributes?: string;
  /** No spine items at all */
  emptySpine?: boolean;
  /** Varies the bytes without changing the book */
  salt?: string;
}

export const DEFAULT_EPUB_METADATA = `
  <dc:title>The House by the River</dc:title>
  <dc:creator opf:role="aut" opf:file-as="Vale, Anna">Anna Vale</dc:creator>
  <dc:language>en</dc:language>
  <dc:identifier id="bookid" opf:scheme="ISBN">9780306406157</dc:identifier>
  <dc:identifier opf:scheme="uuid">urn:uuid:0d6b2f4e-9a1c-4f43-8b0e-2f8f1d2b7c11</dc:identifier>
  <dc:publisher>River Press</dc:publisher>
  <dc:date>2004-05-01</dc:date>
  <dc:description>&lt;p&gt;A house, a river and a &lt;b&gt;letter&lt;/b&gt;.&lt;/p&gt;</dc:description>
  <dc:subject>Fiction</dc:subject>`;

export const defaultChapters = (seed = 0): EpubChapter[] => [
  { id: "copyright", href: "copyright.xhtml", body: `<section epub:type="copyright-page"><p>${words(30, seed)}</p></section>` },
  { id: "c1", href: "c1.xhtml", body: `<h1>One</h1><p>${words(400, seed)}</p>` },
  { id: "c2", href: "c2.xhtml", body: `<h1>Two</h1><p>${words(600, seed + 1)}</p>` },
  { id: "notes", href: "notes.xhtml", body: `<p>${words(50, seed + 2)}</p>`, linear: false },
];

/** An EPUB 2 or 3 with a stored mimetype first, its OPF, a nav or NCX, its chapters and a cover */
export function makeEpub(options: EpubOptions = {}): Uint8Array {
  const version = options.version ?? "3.0";
  const chapters = options.chapters ?? defaultChapters();
  const three = version === "3.0";
  const items = [
    ...chapters.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`),
    three ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>` : "",
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    options.cover ? `<item id="cover-img" href="images/cover.png" media-type="image/png"${three ? ` properties="cover-image"` : ""}/>` : "",
    options.manifest ?? "",
  ].join("\n    ");
  const spine = options.emptySpine ? "" : chapters.map((c) => `<itemref idref="${c.id}"${c.linear === false ? ` linear="no"` : ""}/>`).join("");
  const coverMeta = options.cover && !three ? `<meta name="cover" content="cover-img"/>` : "";
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">${options.metadata ?? DEFAULT_EPUB_METADATA}${coverMeta}${options.salt ? `<meta name="salt" content="${options.salt}"/>` : ""}</metadata>
  <manifest>
    ${items}
  </manifest>
  <spine toc="ncx"${options.spineAttributes ? ` ${options.spineAttributes}` : ""}>${spine}</spine>
  ${options.guide ? `<guide>${options.guide}</guide>` : ""}
</package>`;
  const nav = xhtml("Contents", `<nav epub:type="toc"><ol>${chapters.map((c) => `<li><a href="${c.href}">${c.id}</a></li>`).join("")}</ol></nav>${options.navExtra ?? ""}`);
  const ncx = `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${chapters
    .map((c, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${c.id}</text></navLabel><content src="${c.href}"/></navPoint>`)
    .join("")}</navMap></ncx>`;
  const omit = new Set(options.omit ?? []);
  const entries: ZipEntry[] = [
    { name: "mimetype", data: "application/epub+zip", store: true },
    { name: "META-INF/container.xml", data: `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", data: opf },
    ...(three ? [{ name: "OEBPS/nav.xhtml", data: nav }] : []),
    { name: "OEBPS/toc.ncx", data: ncx },
    ...chapters.map((c) => ({ name: `OEBPS/${c.href}`, data: xhtml(c.id, c.body, c.bodyAttributes) })),
    ...(options.cover ? [{ name: "OEBPS/images/cover.png", data: options.cover, store: true }] : []),
    ...(options.entries ?? []),
  ].filter((e) => !omit.has(e.name));
  return makeZip(entries);
}

/** A sidecar metadata.opf as a library manager exports it */
export function makeSidecarOpf(options: { title: string; author: string; fileAs?: string; uuid: string; isbn?: string; rating?: number; customColumn?: boolean; series?: string; seriesIndex?: number }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier opf:scheme="library" id="library_id">42</dc:identifier>
    <dc:identifier opf:scheme="uuid" id="uuid_id">${options.uuid}</dc:identifier>
    <dc:title>${options.title}</dc:title>
    <dc:creator opf:file-as="${options.fileAs ?? options.author}" opf:role="aut">${options.author}</dc:creator>
    <dc:language>en</dc:language>
    ${options.isbn ? `<dc:identifier opf:scheme="ISBN">${options.isbn}</dc:identifier>` : ""}
    ${options.series ? `<meta name="calibre:series" content="${options.series}"/><meta name="calibre:series_index" content="${options.seriesIndex ?? 1}"/>` : ""}
    ${options.rating !== undefined ? `<meta name="calibre:rating" content="${options.rating}"/>` : ""}
    ${options.customColumn ? `<meta name="calibre:user_metadata:#read" content="{&quot;#value#&quot;: true}"/>` : ""}
  </metadata>
</package>`;
}

/** The encryption.xml of an EPUB whose entries use these algorithms */
export function encryptionXml(entries: { uri: string; algorithm: string }[]): string {
  return `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${entries
    .map((e) => `<enc:EncryptedData><enc:EncryptionMethod Algorithm="${e.algorithm}"/><enc:CipherData><enc:CipherReference URI="${e.uri}"/></enc:CipherData></enc:EncryptedData>`)
    .join("")}</encryption>`;
}

// ── MOBI ────────────────────────────────────────────────────────────────────

/** PalmDOC compression of plain text: literal bytes only (a valid, if lazy, encoding) */
function palmDocLiterals(text: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    if (c === 0 || (c >= 0x09 && c <= 0x7f)) {
      out.push(c);
      i += 1;
    } else {
      const run = text.subarray(i, i + 8);
      out.push(run.length, ...run);
      i += run.length;
    }
  }
  return Uint8Array.from(out);
}

export interface MobiOptions {
  title?: string;
  /** EXTH records by type, as text */
  exth?: [type: number, value: string][];
  text?: string;
  /** 1 none, 2 PalmDOC, 17480 HUFF/CDIC */
  compression?: number;
  /** The header's encryption type: anything but 0 is DRM */
  encryption?: number;
  /** 8 for a KF8 (AZW3) file */
  version?: number;
  cover?: Uint8Array;
  /** Windows language id */
  locale?: number;
}

const u16be = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};

/** A MOBI (or, with version 8, an AZW3) of one or more text records, EXTH and an optional cover */
export function makeMobi(options: MobiOptions = {}): Uint8Array {
  const title = Buffer.from(options.title ?? "The House by the River", "utf8");
  const compression = options.compression ?? 2;
  const raw = enc.encode(options.text ?? `<html><body><p>${words(500)}</p></body></html>`);
  const records: Uint8Array[] = [];
  for (let at = 0; at < raw.length; at += 4096) {
    const chunk = raw.subarray(at, at + 4096);
    records.push(compression === 2 ? palmDocLiterals(chunk) : chunk);
  }
  const exthRecords = [...(options.exth ?? []).map(([type, value]) => [type, Buffer.from(value, "utf8")] as const)];
  if (options.cover) exthRecords.push([201, u32be(0)]);
  const exthBody = Buffer.concat(exthRecords.map(([type, data]) => Buffer.concat([u32be(type), u32be(data.length + 8), data])));
  const exthPad = (4 - (exthBody.length % 4)) % 4;
  const exth = Buffer.concat([Buffer.from("EXTH"), u32be(12 + exthBody.length + exthPad), u32be(exthRecords.length), exthBody, Buffer.alloc(exthPad)]);

  const headerLength = 0xe8;
  const mobi = Buffer.alloc(headerLength);
  mobi.write("MOBI", 0, "latin1");
  mobi.writeUInt32BE(headerLength, 4);
  mobi.writeUInt32BE(2, 8); // a book
  mobi.writeUInt32BE(65001, 12); // UTF-8
  mobi.writeUInt32BE(0x1234, 16);
  mobi.writeUInt32BE(options.version ?? 6, 20);
  const firstImage = 1 + records.length;
  const nameOffset = 16 + headerLength + exth.length;
  mobi.writeUInt32BE(nameOffset, 84 - 16);
  mobi.writeUInt32BE(title.length, 88 - 16);
  mobi.writeUInt32BE(options.locale ?? 9, 92 - 16);
  mobi.writeUInt32BE(options.cover ? firstImage : 0xffffffff, 108 - 16);
  mobi.writeUInt32BE(0x40, 128 - 16); // EXTH present
  mobi.writeUInt16BE(0, 0xf2 - 16); // no trailing entries

  const palmDoc = Buffer.concat([u16be(compression), u16be(0), u32be(raw.length), u16be(records.length), u16be(4096), u16be(options.encryption ?? 0), u16be(0)]);
  const record0 = Buffer.concat([palmDoc, mobi, exth, title, Buffer.alloc(4)]);
  const all = [record0, ...records, ...(options.cover ? [options.cover] : [])];

  const header = Buffer.alloc(78);
  header.write(title.toString("latin1").slice(0, 31).replace(/[^\x20-\x7e]/g, "_"), 0, "latin1");
  header.write("BOOK", 60, "latin1");
  header.write("MOBI", 64, "latin1");
  header.writeUInt16BE(all.length, 76);
  const listLength = all.length * 8 + 2;
  let offset = 78 + listLength;
  const list = Buffer.alloc(listLength);
  all.forEach((record, i) => {
    list.writeUInt32BE(offset, i * 8);
    list.writeUInt32BE(i * 2, i * 8 + 4);
    offset += record.length;
  });
  return new Uint8Array(Buffer.concat([header, list, ...all]));
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const md5 = (...parts: Uint8Array[]) => createHash("md5").update(Buffer.concat(parts)).digest();
const padded = (password: string) => Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);

export interface PdfOptions {
  /** One string of text a page; an empty string is a page with no text (a scan) */
  pages?: string[];
  info?: Record<string, string>;
  /** An XMP packet */
  xmp?: string;
  /** The standard security handler, revision 2 (RC4, 40 bits) */
  encrypt?: { user: string; owner: string };
  /** An /EBX_HANDLER filter: Adobe's DRM */
  adobe?: boolean;
}

const pdfString = (s: string) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** A PDF of one text line a page, wrapped into lines of 12 words */
export function makePdf(options: PdfOptions = {}): Uint8Array {
  const pages = options.pages ?? [words(120), words(120, 3)];
  const id = createHash("md5").update(JSON.stringify(options)).digest();
  const objects: (string | ((n: number) => Buffer))[] = [];
  const add = (body: string | ((n: number) => Buffer)) => objects.push(body) as number; // object numbers start at 1
  let key: Buffer | null = null;
  let encryptBody = "";
  if (options.encrypt) {
    const ownerKey = md5(padded(options.encrypt.owner || options.encrypt.user)).subarray(0, 5);
    const o = Buffer.from(rc4(ownerKey, padded(options.encrypt.user)));
    const p = -44; // print and copy allowed, as owner-password PDFs usually are
    const pBytes = Buffer.alloc(4);
    pBytes.writeInt32LE(p, 0);
    key = md5(padded(options.encrypt.user), o, pBytes, id).subarray(0, 5);
    const u = Buffer.from(rc4(key, PAD));
    encryptBody = `<< /Filter /Standard /V 1 /R 2 /O <${o.toString("hex")}> /U <${u.toString("hex")}> /P ${p} >>`;
  }
  const crypt = (n: number, data: Buffer) => {
    if (!key) return data;
    const objectKey = md5(key, Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, 0, 0])).subarray(0, 10);
    return Buffer.from(rc4(objectKey, data));
  };
  const stream = (dict: string, data: string, encoding: BufferEncoding = "latin1") => (n: number) => {
    const body = crypt(n, Buffer.from(data, encoding));
    return Buffer.concat([Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`, "latin1"), body, Buffer.from("\nendstream", "latin1")]);
  };

  const catalog = add("");
  const pagesObject = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObjects = pages.map((text) => {
    const lines: string[] = [];
    const ws = text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < ws.length; i += 12) lines.push(ws.slice(i, i + 12).join(" "));
    const content = lines.length ? `BT /F1 10 Tf 14 TL 24 560 Td ${lines.map((l) => `${pdfString(l)} Tj T*`).join(" ")} ET` : "0.8 g 40 40 320 520 re f";
    const contents = add(stream("", content));
    return add(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 400 600] /Contents ${contents} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
  });
  const metadata = options.xmp ? add(stream("/Type /Metadata /Subtype /XML", options.xmp, "utf8")) : null;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R${metadata ? ` /Metadata ${metadata} 0 R` : ""} >>`;
  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${pageObjects.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageObjects.length} >>`;
  const info = options.info && !key ? add(`<< ${Object.entries(options.info).map(([k, v]) => `/${k} ${pdfString(v)}`).join(" ")} >>`) : null;
  const encrypt = key ? add(encryptBody) : options.adobe ? add(`<< /Filter /EBX_HANDLER /V 2 /R 3 /Length 128 >>`) : null;

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let at = chunks[0].length;
  objects.forEach((body, i) => {
    const n = i + 1;
    const content = typeof body === "string" ? Buffer.from(body, "latin1") : body(n);
    const object = Buffer.concat([Buffer.from(`${n} 0 obj\n`, "latin1"), content, Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(at);
    chunks.push(object);
    at += object.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ""}${encrypt ? ` /Encrypt ${encrypt} 0 R` : ""} /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${at}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer, "latin1"));
  return new Uint8Array(Buffer.concat(chunks));
}

/** An XMP packet with Dublin Core, PRISM and XMP fields */
export function makeXmp(fields: { title?: string; creators?: string[]; isbn?: string; createDate?: string }): string {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
${fields.title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${fields.title}</rdf:li></rdf:Alt></dc:title>` : ""}
${fields.creators ? `<dc:creator><rdf:Seq>${fields.creators.map((c) => `<rdf:li>${c}</rdf:li>`).join("")}</rdf:Seq></dc:creator>` : ""}
${fields.isbn ? `<prism:isbn>${fields.isbn}</prism:isbn>` : ""}
${fields.createDate ? `<xmp:CreateDate>${fields.createDate}</xmp:CreateDate>` : ""}
</rdf:Description></rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`;
}

// ── FB2, CBZ and others ─────────────────────────────────────────────────────

export function makeFb2(options: { title?: string; cover?: Uint8Array; notes?: string; salt?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>prose</genre>
      <author><first-name>Anna</first-name><middle-name>M.</middle-name><last-name>Vale</last-name></author>
      <book-title>${options.title ?? "The Letter and the Lamp"}</book-title>
      <annotation><p>A letter, found.</p><p>A lamp, lit.</p></annotation>
      <date value="1999-01-01">1999</date>
      <lang>en</lang>
      <sequence name="River Books" number="2"/>
      ${options.cover ? `<coverpage><image l:href="#cover.png"/></coverpage>` : ""}
    </title-info>
    <publish-info><publisher>River Press</publisher><year>2001</year><isbn>978-0-306-40615-7</isbn></publish-info>
    ${options.salt ? `<custom-info info-type="salt">${options.salt}</custom-info>` : ""}
  </description>
  <body><section><p>${words(300)}</p><p>${words(200, 5)}</p></section></body>
  <body name="notes"><section><p>${options.notes ?? words(80, 9)}</p></section></body>
  ${options.cover ? `<binary id="cover.png" content-type="image/png">${Buffer.from(options.cover).toString("base64")}</binary>` : ""}
</FictionBook>`;
}

export const COMIC_INFO = `<?xml version="1.0"?><ComicInfo><Title>Night Harbour</Title><Series>Harbour</Series><Number>3</Number><Writer>Anna Vale</Writer><Year>2011</Year><Month>4</Month><LanguageISO>fr</LanguageISO><GTIN>9780306406157</GTIN><Summary>Boats at night.</Summary></ComicInfo>`;

/** A CBZ of pages named so a plain sort gets them wrong ("page10" before "page2") */
export async function makeCbz(options: { comicInfo?: boolean } = {}): Promise<Uint8Array> {
  const pages = await Promise.all([1, 2, 10].map((n, i) => makeImage("jpeg", { color: ["#202830", "#405060", "#607080"][i] })));
  return makeZip([
    ...(options.comicInfo === false ? [] : [{ name: "ComicInfo.xml", data: COMIC_INFO }]),
    { name: "page10.jpg", data: pages[2], store: true },
    { name: "page1.jpg", data: pages[0], store: true },
    { name: "page2.jpg", data: pages[1], store: true },
  ]);
}

/** A Word document's zip: not taken outside a sidecar folder */
export const makeDocx = () =>
  makeZip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
    { name: "word/document.xml", data: `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>` },
  ]);

/** A zip whose central directory was cut off */
export function makeCorruptZip(): Uint8Array {
  const zip = makeEpub();
  return zip.subarray(0, zip.length - 120);
}

/** A KFX container's first bytes */
export const makeKfx = () => new Uint8Array(Buffer.concat([Buffer.from("CONT", "latin1"), Buffer.from([2, 0]), Buffer.alloc(200, 7)]));
/** A Topaz book's first bytes */
export const makeTopaz = () => new Uint8Array(Buffer.concat([Buffer.from("TPZ0", "latin1"), Buffer.alloc(200, 3)]));
