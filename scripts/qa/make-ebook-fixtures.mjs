#!/usr/bin/env node
/**
 * The reader's e-book fixtures (eBooks sub-issue 3), made from scratch: no
 * converter, no download. Every text is generated here from fixed word
 * lists with a seeded random generator, so a run makes the same books; the
 * one embedded font is the reader's own EB Garamond (SIL OFL).
 *
 *   node scripts/qa/make-ebook-fixtures.mjs
 *     The small fixtures, committed: src/__tests__/fixtures/ebooks/
 *     (EPUB 2, EPUB 3 with a nav and a page-list, right-to-left, vertical
 *     Japanese, MOBI, AZW3, FB2, CBZ, a text PDF, an obfuscated font, a
 *     scripted EPUB, a corrupt zip and a DRM-flagged EPUB).
 *
 *   node scripts/qa/make-ebook-fixtures.mjs --large [DIR]
 *     The large ones, never committed, into DIR (default: a new temporary
 *     folder, printed): a 2,000-page EPUB, a 50 MB illustrated EPUB with a
 *     10 MB image in its first chapter, a 300 MB scanned PDF and an EPUB
 *     whose one chapter is a 2 MB file.
 */

import { createHash, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, deflateSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SMALL_DIR = path.join(ROOT, "src/__tests__/fixtures/ebooks");

// ── Text ─────────────────────────────────────────────────────────────────────

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENGLISH = `the a of and in to with from under over by night river house window garden lamp road
city morning evening rain wind stone letter book page door stair room table chair candle bell clock
tower bridge field orchard winter summer autumn spring silence voice shadow light dust glass mirror
painter widow doctor sailor priest clerk child stranger brother sister old quiet narrow distant pale
heavy bright long small grey green dark cold warm slow sudden walked waited listened remembered opened
closed carried followed crossed watched wrote read found lost kept turned spoke slept woke`.split(/\s+/);
const ARABIC = `كتاب قلم بيت مدينة ليل نهر شمس قمر طريق باب نافذة حديقة بحر سماء كلمة صوت يوم رجل امرأة طفل
في من على إلى مع عند كان قال رأى كتب قرأ مشى انتظر سمع جميل بعيد قديم صغير كبير هادئ`.split(/\s+/);
const JAPANESE_NOUNS = "本 猫 雨 月 川 山 夜 道 窓 庭 海 空 声 朝 町 駅 橋 花 風 星".split(" ");
const JAPANESE_PARTICLES = ["は", "が", "を", "の", "に", "と"];
const JAPANESE_VERBS = ["見た", "待った", "歩いた", "聞いた", "読んだ", "書いた", "静かだった", "遠かった"];

function sentence(random, words, min = 6, max = 16) {
  const n = min + Math.floor(random() * (max - min));
  const list = Array.from({ length: n }, () => words[Math.floor(random() * words.length)]);
  const text = list.join(" ");
  return text[0].toUpperCase() + text.slice(1) + ".";
}

function paragraph(random, words, sentences = 5) {
  return Array.from({ length: sentences }, () => sentence(random, words)).join(" ");
}

function arabicParagraph(random) {
  return Array.from({ length: 4 }, () => {
    const n = 6 + Math.floor(random() * 8);
    return Array.from({ length: n }, () => ARABIC[Math.floor(random() * ARABIC.length)]).join(" ") + ".";
  }).join(" ");
}

function japaneseParagraph(random) {
  return Array.from({ length: 5 }, () => {
    const pick = (list) => list[Math.floor(random() * list.length)];
    return `${pick(JAPANESE_NOUNS)}${pick(JAPANESE_PARTICLES)}${pick(JAPANESE_NOUNS)}${pick(JAPANESE_PARTICLES)}${pick(JAPANESE_VERBS)}。`;
  }).join("");
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Zip ──────────────────────────────────────────────────────────────────────

/** A zip with fixed timestamps (1 January 1980), so the bytes are the same each run */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const stored = entry.store ?? false;
    const data = stored ? raw : deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// ── EPUB ─────────────────────────────────────────────────────────────────────

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function xhtml({ title, body, lang = "en", dir, css = true, epub3 = true }) {
  const doctype = epub3
    ? "<!DOCTYPE html>"
    : '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
  return `<?xml version="1.0" encoding="UTF-8"?>
${doctype}
<html xmlns="http://www.w3.org/1999/xhtml"${epub3 ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : ""} xml:lang="${lang}" lang="${lang}"${dir ? ` dir="${dir}"` : ""}>
<head><title>${escapeXml(title)}</title>${css ? '<link rel="stylesheet" type="text/css" href="style.css"/>' : ""}</head>
<body>
${body}
</body>
</html>`;
}

/**
 * An EPUB. chapters: [{ id, title, body }]; files: extra [{ href, type, data, properties }].
 * version 2 gets an NCX, version 3 a nav (with a page-list when given).
 */
function epub({
  id,
  title,
  author,
  lang = "en",
  dir,
  version = 3,
  ppd,
  chapters,
  css = "body { margin: 0; } h1 { font-size: 1.4em; } p { margin: 0 0 0.6em; text-indent: 1.2em; }",
  files = [],
  pageList = [],
  extraZip = [],
  scripted = [],
}) {
  const epub3 = version === 3;
  const manifest = [
    ...chapters.map(
      (c) =>
        `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"${scripted.includes(c.id) && epub3 ? ' properties="scripted"' : ""}/>`,
    ),
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...files.map(
      (f) => `<item id="${f.id}" href="${f.href}" media-type="${f.type}"${f.properties ? ` properties="${f.properties}"` : ""}/>`,
    ),
    epub3
      ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      : '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
  ];
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${epub3 ? "3.0" : "2.0"}" unique-identifier="uid"${dir ? ` dir="${dir}"` : ""} xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"${epub3 ? "" : ' xmlns:opf="http://www.idpf.org/2007/opf"'}>
    <dc:identifier id="uid">${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${lang}</dc:language>
    <dc:rights>Public domain (CC0 1.0), generated for Durtal's tests</dc:rights>
    ${epub3 ? '<meta property="dcterms:modified">2026-10-07T00:00:00Z</meta>' : ""}
  </metadata>
  <manifest>
    ${manifest.join("\n    ")}
  </manifest>
  <spine${epub3 ? "" : ' toc="ncx"'}${ppd ? ` page-progression-direction="${ppd}"` : ""}>
    ${chapters.map((c) => `<itemref idref="${c.id}"/>`).join("\n    ")}
  </spine>
</package>`;
  const tocItems = chapters.filter((c) => c.title);
  const nav = xhtml({
    title: "Contents",
    lang,
    dir,
    css: false,
    body: `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${tocItems
  .map(
    (c) =>
      `<li><a href="${c.id}.xhtml">${escapeXml(c.title)}</a>${
        c.sub?.length
          ? `<ol>${c.sub.map((s) => `<li><a href="${c.id}.xhtml#${s.id}">${escapeXml(s.title)}</a></li>`).join("")}</ol>`
          : ""
      }</li>`,
  )
  .join("\n")}
</ol></nav>${
      pageList.length
        ? `\n<nav epub:type="page-list" id="page-list" hidden="hidden"><ol>${pageList
            .map((p) => `<li><a href="${p.href}">${p.label}</a></li>`)
            .join("")}</ol></nav>`
        : ""
    }`,
  });
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${id}"/><meta name="dtb:depth" content="1"/></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${tocItems
  .map(
    (c, i) =>
      `    <navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${escapeXml(c.title)}</text></navLabel><content src="${c.id}.xhtml"/></navPoint>`,
  )
  .join("\n")}
  </navMap>
</ncx>`;
  return zip([
    { name: "mimetype", data: "application/epub+zip", store: true },
    { name: "META-INF/container.xml", data: CONTAINER },
    ...extraZip,
    { name: "OEBPS/content.opf", data: opf },
    epub3 ? { name: "OEBPS/nav.xhtml", data: nav } : { name: "OEBPS/toc.ncx", data: ncx },
    { name: "OEBPS/style.css", data: css },
    ...chapters.map((c) => ({
      name: `OEBPS/${c.id}.xhtml`,
      data: c.raw ?? xhtml({ title: c.title ?? title, body: c.body, lang, dir, epub3 }),
    })),
    ...files.map((f) => ({ name: `OEBPS/${f.href}`, data: f.data, store: f.store })),
  ]);
}

function englishChapters(seed, count, paragraphs, { pageBreaks = false } = {}) {
  const random = rng(seed);
  let page = 1;
  const pages = [];
  const chapters = Array.from({ length: count }, (_, i) => {
    const id = `chapter${i + 1}`;
    const title = `Chapter ${i + 1}`;
    const sub = [];
    const parts = [`<h1 id="${id}-title">${title}</h1>`];
    for (let p = 0; p < paragraphs; p++) {
      if (pageBreaks && p % 6 === 0) {
        const marker = `page${page}`;
        parts.push(`<span epub:type="pagebreak" role="doc-pagebreak" id="${marker}" aria-label="${page}"></span>`);
        pages.push({ href: `${id}.xhtml#${marker}`, label: String(page) });
        page++;
      }
      if (p > 0 && p % 10 === 0) {
        const sid = `${id}-part${p / 10}`;
        sub.push({ id: sid, title: `Part ${p / 10}` });
        parts.push(`<h2 id="${sid}">Part ${p / 10}</h2>`);
      }
      parts.push(`<p>${paragraph(random, ENGLISH)}</p>`);
    }
    return { id, title, sub, body: parts.join("\n") };
  });
  return { chapters, pages };
}

// ── MOBI and AZW3 ────────────────────────────────────────────────────────────

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const NONE = 0xffffffff;

/** A forward variable-width integer: 7 bits a byte, the last byte marked */
function varlen(n) {
  const bytes = [n & 0x7f];
  for (n >>>= 7; n; n >>>= 7) bytes.unshift(n & 0x7f);
  bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
}

const pad4 = (buf) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf);

function exth(records) {
  const body = Buffer.concat(
    records.map(([type, value]) => {
      const data = typeof value === "number" ? u32(value) : Buffer.from(value, "utf8");
      return Buffer.concat([u32(type), u32(8 + data.length), data]);
    }),
  );
  return pad4(Buffer.concat([Buffer.from("EXTH"), u32(12 + body.length), u32(records.length), body]));
}

/** A Palm database: the header, the record list, the records */
function palmDb(name, records) {
  const header = Buffer.alloc(78);
  header.write(name.slice(0, 31).replace(/[^\x20-\x7e]/g, "_"), 0, "latin1");
  header.writeUInt32BE(0x5f2e1b40, 36); // created
  header.writeUInt32BE(0x5f2e1b40, 40); // modified
  header.write("BOOKMOBI", 60, "latin1");
  header.writeUInt32BE(records.length * 2 - 1, 68);
  header.writeUInt16BE(records.length, 76);
  const list = Buffer.alloc(records.length * 8 + 2);
  let offset = 78 + list.length;
  records.forEach((record, i) => {
    list.writeUInt32BE(offset, i * 8);
    list.writeUInt32BE(i * 2, i * 8 + 4);
    offset += record.length;
  });
  return Buffer.concat([header, list, ...records]);
}

const MOBI_LANGUAGES = { en: 9, ar: 1, ja: 17 };

/** Record 0: the PalmDOC header, the MOBI header, EXTH and the full name */
function recordZero({ version, textLength, textRecords, uid, title, author, lang, firstResource, kf8 }) {
  const headerLength = version >= 8 ? 264 : 232;
  const exthBytes = exth([
    [100, author],
    [503, title],
    [524, lang],
    [125, 0],
    ...(kf8?.rtl ? [[527, "rtl"]] : []),
  ]);
  const nameOffset = 16 + headerLength + exthBytes.length;
  const name = Buffer.from(title, "utf8");
  const mobi = Buffer.alloc(headerLength);
  mobi.write("MOBI", 0, "latin1");
  mobi.writeUInt32BE(headerLength, 4);
  mobi.writeUInt32BE(2, 8);
  mobi.writeUInt32BE(65001, 12);
  mobi.writeUInt32BE(uid, 16);
  mobi.writeUInt32BE(version, 20);
  for (let at = 24; at < 64; at += 4) mobi.writeUInt32BE(NONE, at);
  mobi.writeUInt32BE(firstResource, 64); // first non-book record
  mobi.writeUInt32BE(nameOffset, 68);
  mobi.writeUInt32BE(name.length, 72);
  mobi.writeUInt32BE(MOBI_LANGUAGES[lang] ?? 0, 76);
  mobi.writeUInt32BE(version, 88); // minimum reader version
  mobi.writeUInt32BE(firstResource, 92); // first image record
  mobi.writeUInt32BE(0x50, 112); // EXTH present
  mobi.writeUInt32BE(NONE, 148);
  mobi.writeUInt32BE(NONE, 152); // no DRM
  if (kf8) {
    mobi.writeUInt32BE(kf8.fdst, 176);
    mobi.writeUInt32BE(1, 180);
  } else {
    mobi.writeUInt16BE(1, 176); // first content record
    mobi.writeUInt16BE(textRecords, 178); // last content record
    mobi.writeUInt32BE(1, 180);
  }
  mobi.writeUInt32BE(NONE, 184); // FCIS
  mobi.writeUInt32BE(NONE, 192); // FLIS
  mobi.writeUInt32BE(NONE, 208);
  mobi.writeUInt32BE(NONE, 216);
  mobi.writeUInt32BE(NONE, 220);
  mobi.writeUInt32BE(0, 224); // no trailing entries
  mobi.writeUInt32BE(NONE, 228); // no NCX
  if (kf8) {
    mobi.writeUInt32BE(kf8.frag, 232);
    mobi.writeUInt32BE(kf8.skel, 236);
    mobi.writeUInt32BE(NONE, 240); // DATP
    mobi.writeUInt32BE(NONE, 244); // guide
    mobi.writeUInt32BE(NONE, 248);
    mobi.writeUInt32BE(NONE, 256);
    mobi.writeUInt32BE(NONE, 260);
  }
  const palmdoc = Buffer.concat([u16(1), u16(0), u32(textLength), u16(textRecords), u16(4096), u16(0), u16(0)]);
  return pad4(Buffer.concat([palmdoc, mobi, exthBytes, name, Buffer.alloc(2)]));
}

function textRecords(text) {
  const records = [];
  for (let at = 0; at < text.length; at += 4096) records.push(text.subarray(at, at + 4096));
  return records;
}

const EOF_RECORD = Buffer.from([0xe9, 0x8e, 0x0d, 0x0a]);

/** A MOBI 6 book: HTML with page breaks between chapters, a filepos table of contents */
function mobi6({ title, author, lang = "en", chapters, uid }) {
  // The contents page links each chapter by its byte offset: two passes, fixed-width numbers
  const build = (offsets) => {
    const toc = `<div><h1>Contents</h1>${chapters
      .map((c, i) => `<p><a filepos=${String(offsets[i] ?? 0).padStart(10, "0")}>${escapeXml(c.title)}</a></p>`)
      .join("")}</div>`;
    const head = `<html><head><guide><reference type="toc" title="Contents" filepos=${String(offsets.toc ?? 0).padStart(10, "0")} /></guide></head><body>`;
    let html = head;
    const at = { toc: Buffer.byteLength(html) };
    html += `${toc}<mbp:pagebreak/>`;
    chapters.forEach((c, i) => {
      at[i] = Buffer.byteLength(html);
      html += `<h1>${escapeXml(c.title)}</h1>${c.body}${i < chapters.length - 1 ? "<mbp:pagebreak/>" : ""}`;
    });
    return { html: html + "</body></html>", at };
  };
  const first = build({});
  const { html } = build(first.at);
  const text = Buffer.from(html, "utf8");
  const records = textRecords(text);
  const firstResource = records.length + 1;
  const zero = recordZero({
    version: 6,
    textLength: text.length,
    textRecords: records.length,
    uid,
    title,
    author,
    lang,
    firstResource,
  });
  return palmDb(title, [zero, ...records, EOF_RECORD]);
}

/** An INDX index: its header record (with TAGX), one record of entries, and a CNCX record when given */
function indx({ tags, entries, cncx }) {
  const tagx = Buffer.concat([
    Buffer.from("TAGX"),
    u32(12 + (tags.length + 1) * 4),
    u32(1),
    ...tags.map(([tag, count, mask]) => Buffer.from([tag, count, mask, 0])),
    Buffer.from([0, 0, 0, 1]),
  ]);
  const header = Buffer.alloc(192);
  header.write("INDX", 0, "latin1");
  header.writeUInt32BE(192, 4);
  header.writeUInt32BE(1, 24); // records of entries
  header.writeUInt32BE(65001, 28);
  header.writeUInt32BE(NONE, 32);
  header.writeUInt32BE(entries.length, 36);
  header.writeUInt32BE(cncx ? 1 : 0, 52);
  const head = pad4(Buffer.concat([header, tagx]));

  const bodies = entries.map(({ name, control, values }) => {
    const label = Buffer.from(name, "latin1");
    return Buffer.concat([Buffer.from([label.length]), label, Buffer.from([control]), ...values.map(varlen)]);
  });
  const offsets = [];
  let at = 192;
  for (const body of bodies) {
    offsets.push(at);
    at += body.length;
  }
  const entriesBytes = Buffer.concat(bodies);
  const idxtAt = 192 + entriesBytes.length + ((4 - ((192 + entriesBytes.length) % 4)) % 4);
  const data = Buffer.alloc(192);
  data.write("INDX", 0, "latin1");
  data.writeUInt32BE(192, 4);
  data.writeUInt32BE(1, 8);
  data.writeUInt32BE(idxtAt, 20);
  data.writeUInt32BE(entries.length, 24);
  data.writeUInt32BE(NONE, 28);
  const idxt = Buffer.concat([Buffer.from("IDXT"), ...offsets.map(u16)]);
  const record = pad4(Buffer.concat([data, pad4(entriesBytes), idxt]));
  return cncx ? [head, record, pad4(cncx)] : [head, record];
}

/** An AZW3 (KF8) book: one skeleton and one fragment per chapter */
function azw3({ title, author, lang = "en", rtl = false, chapters, uid }) {
  const parts = [];
  const skel = [];
  const frag = [];
  const selectors = [];
  let raw = 0;
  chapters.forEach((c, i) => {
    const open = `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${lang}"${rtl ? ' dir="rtl"' : ""}><head><title>${escapeXml(c.title)}</title></head><body aid="${i * 2}">`;
    const close = "</body></html>";
    const skeleton = Buffer.from(open + close, "utf8");
    const fragment = Buffer.from(
      `<div aid="${i * 2 + 1}"><h1 id="chapter${i + 1}">${escapeXml(c.title)}</h1>${c.body}</div>`,
      "utf8",
    );
    const insertAt = raw + Buffer.byteLength(open);
    skel.push({ offset: raw, length: skeleton.length });
    frag.push({ insertAt, index: i, length: fragment.length });
    selectors.push(`P-//*[@aid='${i * 2}']`);
    parts.push(skeleton, fragment);
    raw += skeleton.length + fragment.length;
  });
  const text = Buffer.concat(parts);
  const records = textRecords(text);

  let cncxAt = 0;
  const cncxParts = [];
  const cncxOffsets = selectors.map((s) => {
    const bytes = Buffer.from(s, "latin1");
    const at = cncxAt;
    const entry = Buffer.concat([varlen(bytes.length), bytes]);
    cncxParts.push(entry);
    cncxAt += entry.length;
    return at;
  });
  const fragIndex = indx({
    tags: [
      [2, 1, 0x01],
      [3, 1, 0x02],
      [4, 1, 0x04],
      [6, 2, 0x08],
    ],
    entries: frag.map((f, i) => ({
      name: String(f.insertAt).padStart(10, "0"),
      control: 0x0f,
      values: [cncxOffsets[i], i, f.index, 0, f.length],
    })),
    cncx: Buffer.concat(cncxParts),
  });
  const skelIndex = indx({
    tags: [
      [1, 1, 0x03],
      [6, 2, 0x0c],
    ],
    entries: skel.map((s, i) => ({
      name: `SKEL${String(i).padStart(10, "0")}`,
      control: 0x05,
      values: [1, s.offset, s.length],
    })),
  });
  const fdst = Buffer.concat([Buffer.from("FDST"), u32(12), u32(1), u32(0), u32(text.length)]);

  const firstResource = records.length + 1;
  const fragAt = firstResource;
  const skelAt = fragAt + fragIndex.length;
  const fdstAt = skelAt + skelIndex.length;
  const zero = recordZero({
    version: 8,
    textLength: text.length,
    textRecords: records.length,
    uid,
    title,
    author,
    lang,
    firstResource,
    kf8: { fdst: fdstAt, frag: fragAt, skel: skelAt, rtl },
  });
  return palmDb(title, [zero, ...records, ...fragIndex, ...skelIndex, fdst, EOF_RECORD]);
}

// ── FB2 ──────────────────────────────────────────────────────────────────────

function fb2({ title, author, lang = "en", chapters }) {
  const [first, ...rest] = author.split(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>prose</genre>
      <author><first-name>${escapeXml(first)}</first-name><last-name>${escapeXml(rest.join(" "))}</last-name></author>
      <book-title>${escapeXml(title)}</book-title>
      <lang>${lang}</lang>
    </title-info>
    <document-info><author><nickname>durtal-fixtures</nickname></author><date>2026-10-07</date><id>durtal-fixture-fb2</id><version>1.0</version></document-info>
  </description>
  <body>
${chapters
  .map(
    (c) =>
      `    <section><title><p>${escapeXml(c.title)}</p></title>\n${c.paragraphs.map((p) => `      <p>${escapeXml(p)}</p>`).join("\n")}\n    </section>`,
  )
  .join("\n")}
  </body>
</FictionBook>
`;
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const pdfString = (s) => `(${s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;

/** A PDF written object by object to a file descriptor (or a buffer), with its xref */
class PdfWriter {
  #parts = [];
  #fd;
  #at = 0;
  #offsets = [];
  constructor(fd = null) {
    this.#fd = fd;
    this.#write("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  }
  #write(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1");
    if (this.#fd !== null) writeSync(this.#fd, buf);
    else this.#parts.push(buf);
    this.#at += buf.length;
  }
  reserve() {
    this.#offsets.push(null);
    return this.#offsets.length;
  }
  object(id, body, stream) {
    this.#offsets[id - 1] = this.#at;
    if (stream) {
      this.#write(`${id} 0 obj\n${body.replace(/>>\s*$/, "")} /Length ${stream.length} >>\nstream\n`);
      this.#write(stream);
      this.#write("\nendstream\nendobj\n");
    } else this.#write(`${id} 0 obj\n${body}\nendobj\n`);
  }
  finish(rootId, infoId) {
    const xrefAt = this.#at;
    const lines = this.#offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
    this.#write(`xref\n0 ${this.#offsets.length + 1}\n0000000000 65535 f \n${lines}`);
    this.#write(`trailer\n<< /Size ${this.#offsets.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
    return this.#fd === null ? Buffer.concat(this.#parts) : null;
  }
}

function textPdf({ title, author, pages }) {
  const pdf = new PdfWriter();
  const catalog = pdf.reserve();
  const pagesId = pdf.reserve();
  const font = pdf.reserve();
  const info = pdf.reserve();
  const kids = pages.map(() => [pdf.reserve(), pdf.reserve()]);
  pdf.object(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pdf.object(pagesId, `<< /Type /Pages /Kids [${kids.map(([p]) => `${p} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  pdf.object(font, "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>");
  pdf.object(info, `<< /Title ${pdfString(title)} /Author ${pdfString(author)} /Producer (Durtal make-ebook-fixtures) >>`);
  pages.forEach((lines, i) => {
    const [pageId, contentId] = kids[i];
    const content = Buffer.from(
      `BT /F1 12 Tf 15 TL 72 740 Td ${lines.map((l) => `${pdfString(l)} Tj T*`).join(" ")} ET\nBT /F1 10 Tf 300 40 Td ${pdfString(String(i + 1))} Tj ET`,
      "latin1",
    );
    pdf.object(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pdf.object(contentId, "<< >>", content);
  });
  return pdf.finish(catalog, info);
}

/** Lines of about 80 characters, for a PDF page */
function wrap(text, width = 80) {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if ((line + " " + word).trim().length > width) {
      lines.push(line.trim());
      line = word;
    } else line += " " + word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// ── PNG ──────────────────────────────────────────────────────────────────────

/** An RGB PNG from raw pixels, written here (no image library) */
function png(width, height, pixel) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      rows[row + 1 + x * 3] = r;
      rows[row + 2 + x * 3] = g;
      rows[row + 3 + x * 3] = b;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
  };
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A comic page: muted panels in a grid, a different layout per page */
function comicPage(n) {
  const random = rng(1000 + n);
  const cols = 1 + (n % 3);
  const rowsCount = 2 + (n % 2);
  const tones = Array.from({ length: cols * rowsCount }, () => [
    60 + Math.floor(random() * 80),
    60 + Math.floor(random() * 80),
    70 + Math.floor(random() * 80),
  ]);
  const width = 480;
  const height = 720;
  return png(width, height, (x, y) => {
    const gutter = 12;
    const col = Math.min(cols - 1, Math.floor((x * cols) / width));
    const row = Math.min(rowsCount - 1, Math.floor((y * rowsCount) / height));
    const inX = x - (col * width) / cols;
    const inY = y - (row * height) / rowsCount;
    if (inX < gutter || inY < gutter || x > width - gutter || y > height - gutter) return [235, 232, 225];
    return tones[row * cols + col];
  });
}

// ── The small fixtures ───────────────────────────────────────────────────────

/** IDPF font obfuscation: the first 1040 bytes XORed with the SHA-1 of the book's identifier */
function obfuscate(font, identifier) {
  const key = createHash("sha1").update(identifier.replace(/[ \u0009\u000d\u000a]/g, "")).digest();
  const out = Buffer.from(font);
  for (let i = 0; i < Math.min(1040, out.length); i++) out[i] ^= key[i % key.length];
  return out;
}

function small() {
  mkdirSync(SMALL_DIR, { recursive: true });
  const write = (name, data) => {
    writeFileSync(path.join(SMALL_DIR, name), data);
    console.log(`${name.padEnd(28)} ${String(data.length).padStart(8)} bytes`);
  };

  const two = englishChapters(2, 3, 12);
  write(
    "epub2.epub",
    epub({ id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000002", title: "The Narrow House", author: "Durtal Fixtures", version: 2, chapters: two.chapters }),
  );

  const three = englishChapters(3, 4, 48, { pageBreaks: true });
  const cover = png(300, 450, (x, y) => [40 + ((x + y) % 40), 50, 70 + (y % 50)]);
  write(
    "epub3.epub",
    epub({
      id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000003",
      title: "The Distant Orchard",
      author: "Durtal Fixtures",
      chapters: [
        ...three.chapters.slice(0, 1).map((c) => ({ ...c, body: `${c.body}\n<p><img src="cover.png" alt="An orchard at dusk"/></p>` })),
        ...three.chapters.slice(1),
      ],
      files: [{ id: "cover", href: "cover.png", type: "image/png", data: cover, properties: "cover-image", store: true }],
      pageList: three.pages,
    }),
  );

  const arabic = rng(5);
  write(
    "rtl.epub",
    epub({
      id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000005",
      title: "كتاب الليل",
      author: "Durtal Fixtures",
      lang: "ar",
      dir: "rtl",
      ppd: "rtl",
      chapters: Array.from({ length: 3 }, (_, i) => ({
        id: `chapter${i + 1}`,
        title: `الفصل ${i + 1}`,
        body: `<h1>الفصل ${i + 1}</h1>\n${Array.from({ length: 24 }, () => `<p>${arabicParagraph(arabic)}</p>`).join("\n")}`,
      })),
    }),
  );

  const japanese = rng(6);
  write(
    "vertical-ja.epub",
    epub({
      id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000006",
      title: "夜の川",
      author: "Durtal Fixtures",
      lang: "ja",
      ppd: "rtl",
      css: "html { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; } p { margin: 0; text-indent: 1em; }",
      chapters: Array.from({ length: 3 }, (_, i) => ({
        id: `chapter${i + 1}`,
        title: `第${i + 1}章`,
        body: `<h1>第${i + 1}章</h1>\n${Array.from({ length: 30 }, () => `<p>${japaneseParagraph(japanese)}</p>`).join("\n")}`,
      })),
    }),
  );

  const kindle = rng(7);
  const kindleChapters = Array.from({ length: 3 }, (_, i) => ({
    title: `Chapter ${i + 1}`,
    body: Array.from({ length: 16 }, () => `<p>${paragraph(kindle, ENGLISH)}</p>`).join(""),
  }));
  write("mobi.mobi", mobi6({ title: "The Grey Bridge", author: "Durtal Fixtures", chapters: kindleChapters, uid: 7 }));
  write("azw3.azw3", azw3({ title: "The Pale Tower", author: "Durtal Fixtures", chapters: kindleChapters, uid: 8 }));

  const fiction = rng(9);
  write(
    "fb2.fb2",
    fb2({
      title: "The Quiet Clerk",
      author: "Durtal Fixtures",
      chapters: Array.from({ length: 3 }, (_, i) => ({
        title: `Chapter ${i + 1}`,
        paragraphs: Array.from({ length: 16 }, () => paragraph(fiction, ENGLISH)),
      })),
    }),
  );

  write(
    "cbz.cbz",
    zip([
      ...Array.from({ length: 6 }, (_, i) => ({ name: `page-${String(i + 1).padStart(2, "0")}.png`, data: comicPage(i), store: true })),
      {
        name: "ComicInfo.xml",
        data: '<?xml version="1.0" encoding="utf-8"?><ComicInfo><Title>The Six Panels</Title><Writer>Durtal Fixtures</Writer><PageCount>6</PageCount></ComicInfo>',
      },
    ]),
  );

  const prose = rng(10);
  write(
    "text.pdf",
    textPdf({
      title: "The Sudden Winter",
      author: "Durtal Fixtures",
      pages: Array.from({ length: 4 }, () => wrap(Array.from({ length: 8 }, () => paragraph(prose, ENGLISH, 4)).join(" ")).slice(0, 44)),
    }),
  );

  const fontId = "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000011";
  const font = readFileSync(path.join(ROOT, "public/fonts/reader/eb-garamond-normal-latin.woff2"));
  const fontText = englishChapters(11, 2, 10);
  write(
    "obfuscated-font.epub",
    epub({
      id: fontId,
      title: "The Hidden Letter",
      author: "Durtal Fixtures",
      css: '@font-face { font-family: "Fixture Garamond"; src: url("fonts/garamond.woff2") format("woff2"); } body { font-family: "Fixture Garamond", serif; } p { margin: 0 0 0.6em; }',
      chapters: fontText.chapters,
      files: [{ id: "font", href: "fonts/garamond.woff2", type: "font/woff2", data: obfuscate(font, fontId), store: true }],
      extraZip: [
        {
          name: "META-INF/encryption.xml",
          data: `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <enc:CipherData><enc:CipherReference URI="OEBPS/fonts/garamond.woff2"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`,
        },
      ],
    }),
  );

  const scriptText = englishChapters(12, 2, 8);
  write(
    "scripted.epub",
    epub({
      id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000012",
      title: "The Open Window",
      author: "Durtal Fixtures",
      scripted: ["chapter1"],
      chapters: [
        {
          ...scriptText.chapters[0],
          body: `${scriptText.chapters[0].body}
<script type="text/javascript">
//<![CDATA[
window.__durtalBookScript = "ran";
try { parent.__durtalBookScript = "ran"; top.__durtalBookScript = "ran"; } catch (e) {}
//]]>
</script>`,
        },
        scriptText.chapters[1],
      ],
    }),
  );

  const two2 = epub({ id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000013", title: "The Broken Seal", author: "Durtal Fixtures", version: 2, chapters: englishChapters(13, 2, 6).chapters });
  // The first 3 KiB of a real EPUB and then noise: no central directory
  write("corrupt.epub", Buffer.concat([two2.subarray(0, 3072), Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37) % 251))]));

  const drmChapters = englishChapters(14, 2, 6).chapters;
  write(
    "drm.epub",
    epub({
      id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000014",
      title: "The Locked Room",
      author: "Durtal Fixtures",
      chapters: drmChapters.map((c, i) => ({ ...c, raw: Buffer.from(Array.from({ length: 4096 }, (_, j) => (j * 131 + i * 17) % 256)) })),
      extraZip: [
        {
          name: "META-INF/encryption.xml",
          data: `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
${drmChapters
  .map(
    (c) => `  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><resource xmlns="http://ns.adobe.com/adept">urn:uuid:00000000-0000-0000-0000-000000000000</resource></KeyInfo>
    <enc:CipherData><enc:CipherReference URI="OEBPS/${c.id}.xhtml"/></enc:CipherData>
  </enc:EncryptedData>`,
  )
  .join("\n")}
</encryption>`,
        },
        { name: "META-INF/rights.xml", data: '<?xml version="1.0"?><adept:rights xmlns:adept="http://ns.adobe.com/adept"/>' },
      ],
    }),
  );
}

// ── The large fixtures ───────────────────────────────────────────────────────

function large(dir) {
  mkdirSync(dir, { recursive: true });
  const write = (name, data) => {
    writeFileSync(path.join(dir, name), data);
    console.log(`${name.padEnd(28)} ${(data.length / 1e6).toFixed(1).padStart(8)} MB`);
  };

  // About 2,000 pages of 300 words: 100 chapters of 20 pages
  const long = englishChapters(21, 100, 120);
  write("long-2000-pages.epub", epub({ id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000021", title: "The Long Road", author: "Durtal Fixtures", chapters: long.chapters }));

  // 50 MB: a 10 MB image in the first chapter and forty 1 MB images after it
  const noise = (width, height, seed) => {
    const random = rng(seed);
    return png(width, height, () => {
      const v = Math.floor(random() * 256);
      return [v, (v * 7) & 255, (v * 13) & 255];
    });
  };
  const illustrated = englishChapters(22, 41, 20).chapters;
  const images = [{ id: "big", href: "images/big.png", type: "image/png", data: noise(1830, 1830, 1), store: true }];
  for (let i = 1; i < 41; i++) images.push({ id: `img${i}`, href: `images/img${i}.png`, type: "image/png", data: noise(580, 580, 100 + i), store: true });
  write(
    "illustrated-50mb.epub",
    epub({
      id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000022",
      title: "The Painted Field",
      author: "Durtal Fixtures",
      chapters: illustrated.map((c, i) => ({
        ...c,
        body: `${c.body.replace("</h1>", `</h1>\n<p><img src="images/${i === 0 ? "big" : `img${i}`}.png" alt="Plate ${i + 1}"/></p>`)}`,
      })),
      files: images,
    }),
  );

  // 2 MB in one chapter file
  const single = englishChapters(23, 1, 6300).chapters;
  write("single-2mb-chapter.epub", epub({ id: "urn:uuid:7d1b0c52-2f0b-4a35-9c1e-000000000023", title: "The One Room", author: "Durtal Fixtures", chapters: single }));

  // 300 MB of scanned pages: one 1 MB greyscale image per page
  const file = path.join(dir, "scanned-300mb.pdf");
  const fd = openSync(file, "w");
  const pdf = new PdfWriter(fd);
  const pagesCount = 300;
  const catalog = pdf.reserve();
  const pagesId = pdf.reserve();
  const info = pdf.reserve();
  const kids = Array.from({ length: pagesCount }, () => [pdf.reserve(), pdf.reserve(), pdf.reserve()]);
  pdf.object(catalog, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  pdf.object(pagesId, `<< /Type /Pages /Kids [${kids.map(([p]) => `${p} 0 R`).join(" ")}] /Count ${pagesCount} >>`);
  pdf.object(info, "<< /Title (The Scanned Ledger) /Author (Durtal Fixtures) >>");
  for (const [pageId, contentId, imageId] of kids) {
    const side = 1024;
    const image = deflateSync(randomBytes(side * side), { level: 1 });
    pdf.object(imageId, `<< /Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode >>`, image);
    pdf.object(contentId, "<< >>", Buffer.from("q 612 0 0 792 0 0 cm /Im0 Do Q", "latin1"));
    pdf.object(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  }
  pdf.finish(catalog, info);
  closeSync(fd);
  console.log(`${"scanned-300mb.pdf".padEnd(28)} written`);
}

const args = process.argv.slice(2);
if (args[0] === "--large") {
  const dir = args[1] ? path.resolve(args[1]) : mkdtempSync(path.join(tmpdir(), "durtal-ebook-fixtures-"));
  large(dir);
  console.log(`Large fixtures in ${dir}`);
} else small();
