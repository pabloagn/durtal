/** SLN-503: prepare local objects and reviewable SQL; never contacts a database or cloud. */
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ebookGoldFileKey } from "@/lib/ebooks/keys";

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
const literal = (text: string) => "'" + text.replace(/'/g, "''") + "'";
for (const file of files) {
  const bytes = await readFile(file.file);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = ebookGoldFileKey(hash, "epub");
  const target = path.join(resolved, "durtal", key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  sql.push(`insert into ebooks(id,title,authors,language,match_state,import_source,import_ref) values (${literal(file.id)},${literal(file.title)},'{"Joris-Karl Huysmans"}','fr','standalone','folder',${literal("fixtures/" + path.basename(file.file))});
insert into ebook_files(id,ebook_id,sha256,s3_key,format,size_bytes,content_type,original_filename,status) values (${literal(file.fileId)},${literal(file.id)},${literal(hash)},${literal(key)},'epub',${bytes.length},'application/epub+zip',${literal(path.basename(file.file))},'stored');
update ebooks set preferred_file_id=${literal(file.fileId)} where id=${literal(file.id)};`);
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
    },
    null,
    2,
  ),
);
