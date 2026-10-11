/** SLN-503: prepare local objects and reviewable SQL; never contacts a database or cloud. */
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { derivedCachePath, prepareFile, sniffSource } from "@/lib/ebooks/ingest/prepare";
import { bytesSource } from "@/lib/ebooks/ingest/source";
import { storable } from "@/lib/ebooks/ingest/metadata";
import { hashBytes, MEDALLION_VERSION, stageFile, type StageObject } from "@/lib/ebooks/medallion";
import { acceptedPublication } from "@/lib/ebooks/publication-evidence";

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
const requested = args.includes("--objects") ? value("--objects") : null;
const objects = requested
  ? path.resolve(requested)
  : await mkdtemp(path.join(tmpdir(), "durtal-reader-content-"));
await mkdir(objects, { recursive: true });
const resolved = await realpath(objects);
const temporary = await realpath(tmpdir());
if (
  ![temporary, "/private/tmp"].some((root) =>
    resolved.startsWith(root + path.sep),
  )
)
  throw new Error(
    "Reader content QA objects must be in a disposable temporary directory.",
  );

const fixtures = path.resolve("src/__tests__/fixtures/ebooks");
const corpus = args.includes("--corpus")
  ? path.resolve(value("--corpus"))
  : null;
const files = [
  {
    id: "00000000-0000-4000-a000-000000000503",
    fileId: "00000000-0000-4000-a000-f00000000503",
    file: path.join(fixtures, "notes-links-media.epub"),
    title: "Là-bas — notes, links and media",
  },
];
if (corpus)
  files.push({
    id: "00000000-0000-4000-a000-000000000553",
    fileId: "00000000-0000-4000-a000-f00000000553",
    file: path.join(corpus, "search-1500k-60-sections.epub"),
    title: "Là-bas — search corpus",
  });
const sql: string[] = [];
const publications: { reader: string; manifestKey: string; objects: StageObject[] }[] = [];
const literal = (text: string) => "'" + text.replace(/'/g, "''") + "'";
const objectPath = (key: string) => {
  const target = path.resolve(resolved, "durtal", key);
  if (!target.startsWith(resolved + path.sep)) throw new Error("QA object key escapes its private directory");
  return target;
};
const verifyBytes = (object: StageObject, bytes: Uint8Array) => {
  if (bytes.length !== object.size || hashBytes(bytes) !== object.sha256)
    throw new Error(`QA publication object size or checksum differs: ${object.key}`);
};
const putVerified = async (object: StageObject, bytes: Uint8Array | string) => {
  const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  verifyBytes(object, data);
  const target = objectPath(object.key);
  let directory = resolved;
  for (const segment of path.relative(resolved, path.dirname(target)).split(path.sep)) {
    const next = path.join(directory, segment);
    try { await mkdir(next); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    directory = await realpath(next);
    if (!directory.startsWith(resolved + path.sep))
      throw new Error("QA object directory resolves outside its private root");
  }
  await writeFile(target, data, { flag: "wx" });
  const stored = await readFile(target);
  verifyBytes(object, stored);
  return stored;
};
for (const file of files) {
  const bytes = await readFile(file.file);
  const hash = hashBytes(bytes);
  const source = bytesSource(bytes, path.basename(file.file));
  // Every generation inspects afresh; earlier cached validation is not evidence.
  const cache = await mkdtemp(path.join(resolved, "prepare-"));
  const prepared = await (async () => {
    try {
      const sniffed = await sniffSource(source);
      if (sniffed.kind !== "ebook" || sniffed.format !== "epub")
        throw new Error(`Reader QA fixture is not an EPUB: ${file.file}`);
      return await prepareFile(source, hash, sniffed.format, cache);
    } finally { await source.close(); }
  })();
  if (prepared.sha256 !== hash || prepared.size !== bytes.length ||
      prepared.problem || prepared.drm || !prepared.validation.nativeReadable)
    throw new Error(`Reader QA fixture inspection refused publication: ${file.file}`);
  const manifest = prepared.derived.find((object) => object.name === "manifest.json");
  if (!manifest) throw new Error("Reader QA preparation did not produce a manifest");
  const manifestBytes = await readFile(derivedCachePath(cache, hash, manifest.name));
  verifyBytes({ ...manifest, key: manifest.name }, manifestBytes);
  const embedded: Record<string, unknown> = JSON.parse(JSON.stringify(storable({
    ...prepared.metadata, details: prepared.details,
    ...(prepared.text.reason ? { textReason: prepared.text.reason } : {}),
    ...(prepared.coverReason ? { coverReason: prepared.coverReason } : {}),
  })));
  const staged = stageFile(prepared, embedded, manifestBytes);
  const { medallion } = staged;
  const metadata = { ...embedded, medallion };
  const marker = staged.derived.find((object) => object.name === "manifest.json");
  if (!marker) throw new Error("Reader QA staging did not produce a gold publication marker");

  await putVerified(medallion.bronze, bytes);
  const silverBytes = await putVerified(medallion.silver, staged.report);
  await putVerified(medallion.gold[0], bytes);
  for (const object of staged.derived) {
    const data = object.name === "manifest.json" ? staged.publication :
      await readFile(derivedCachePath(cache, hash, object.name));
    await putVerified(object, data);
  }
  // Re-read lineage JSON from the materialized objects, rather than trusting SQL fields.
  const report = JSON.parse(silverBytes.toString("utf8"));
  const publicationBytes = await readFile(objectPath(marker.key));
  verifyBytes(marker, publicationBytes);
  const publication = JSON.parse(publicationBytes.toString("utf8"));
  if (report.version !== MEDALLION_VERSION ||
      !isDeepStrictEqual(report.source, medallion.bronze) ||
      !isDeepStrictEqual(report.validation, prepared.validation) ||
      !isDeepStrictEqual(report.metadata, embedded) ||
      !isDeepStrictEqual(report.artifacts, prepared.derived) ||
      !isDeepStrictEqual(publication, { ...JSON.parse(manifestBytes.toString("utf8")),
        medallion: { version: MEDALLION_VERSION, bronze: medallion.bronze,
          silver: medallion.silver, validation: prepared.validation,
          artifacts: medallion.gold.slice(0, -1) } }))
    throw new Error("Reader QA bronze/silver/gold publication lineage differs");
  const accepted = acceptedPublication(metadata, { sha256: hash, format: prepared.format,
    sizeBytes: bytes.length, s3Key: staged.key, manifestKey: marker.key });
  if (!accepted?.validation.nativeReadable)
    throw new Error("Reader QA publication is not accepted by the canonical reader rules");

  const coverKey = staged.derived.find((object) => object.name === "cover-800.webp")?.key;
  sql.push(`insert into ebooks(id,title,authors,language,match_state,import_source,import_ref) values (${literal(file.id)},${literal(file.title)},'{"Joris-Karl Huysmans"}','fr','standalone','folder',${literal("fixtures/" + path.basename(file.file))});
insert into ebook_files(id,ebook_id,sha256,s3_key,format,size_bytes,content_type,original_filename,status,metadata,manifest_key,cover_key) values (${literal(file.fileId)},${literal(file.id)},${literal(hash)},${literal(staged.key)},${literal(prepared.format)},${bytes.length},${literal(prepared.contentType)},${literal(path.basename(file.file))},'stored',${literal(JSON.stringify(metadata))}::jsonb,${literal(marker.key)},${coverKey ? literal(coverKey) : "null"});
update ebooks set preferred_file_id=${literal(file.fileId)} where id=${literal(file.id)};`);
  publications.push({ reader: `/reader/${file.id}`, manifestKey: marker.key,
    objects: [medallion.bronze, medallion.silver, ...medallion.gold] });
}
const output = path.join(resolved, "reader-content.sql");
await writeFile(output, "begin;\n" + sql.join("\n") + "\ncommit;\n", {
  flag: "wx",
});
console.log(
  JSON.stringify(
    {
      objects: resolved,
      sql: output,
      readers: files.map((file) => `/reader/${file.id}`),
      publications,
    },
    null,
    2,
  ),
);
