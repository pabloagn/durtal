/**
 * Every author image is shown in monochrome (SLN-422). New images already
 * are; this script brings the older ones in colour to the same state.
 *
 * It reads every author image row and every legacy portrait
 * (`authors.photo_s3_key`, shown when an author has no poster image),
 * checks the files the app shows, and reports what is still in colour.
 *
 * Dry run by default: nothing is written, the report goes to --report.
 * `--apply` needs `--backup FILE`, a pg_dump of the database made just
 * before (`~/personal/durtal-backups/`). It re-renders each colour image in
 * monochrome from its colour original, keeping its crop and tuning (a colour
 * copy becomes the original when there was none), points each legacy colour
 * portrait at a monochrome copy (and makes it a poster image when the author
 * has none), writes every change to --undo-file, and checks again.
 * `--undo FILE` puts the colour back.
 *
 *   pnpm exec tsx --tsconfig tsconfig.json scripts/authors/monochrome.ts \
 *     [--apply --backup FILE] [--undo FILE] [--report FILE] [--undo-file FILE]
 *     [--env-dir DIR]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import dotenv from "dotenv";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    backup: { type: "string" },
    undo: { type: "string" },
    report: { type: "string", default: "author-monochrome.md" },
    "undo-file": { type: "string", default: "author-monochrome-undo.json" },
    "env-dir": { type: "string", default: process.cwd() },
  },
});
dotenv.config({
  path: [resolve(values["env-dir"]!, ".env.local"), resolve(values["env-dir"]!, ".env")],
  quiet: true,
});
if (values.apply && (!values.backup || !existsSync(values.backup)))
  throw new Error("--apply needs --backup FILE: a pg_dump made just before this run");

// After the environment is loaded: the database and storage clients read it
const { db } = await import("@/lib/db");
const { media } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");
const monochrome = await import("@/lib/media/author-monochrome");

interface UndoFile {
  appliedAt: string;
  backup: string;
  rerendered: import("@/lib/media/author-monochrome").AuthorMonochromeChange[];
  /** Legacy portraits: the colour key, its monochrome copy, and the poster image made from it */
  imported: { authorId: string; photoS3Key: string; monochromeS3Key: string | null; mediaId: string | null }[];
}

async function counts() {
  const rows = await monochrome.scanAuthorMedia();
  const legacy = await monochrome.scanLegacyAuthorPhotos();
  const byType: Record<string, { total: number; colour: number }> = {};
  for (const { row, colour } of rows) {
    const t = (byType[row.type] ??= { total: 0, colour: 0 });
    t.total++;
    if (colour) t.colour++;
  }
  return { rows, legacy, byType, colour: rows.filter((r) => r.colour).length + legacy.filter((l) => l.colour).length };
}

function table(c: Awaited<ReturnType<typeof counts>>) {
  const lines = ["| Image | Total | In colour |", "|---|---|---|"];
  for (const [type, t] of Object.entries(c.byType)) lines.push(`| ${type} | ${t.total} | ${t.colour} |`);
  lines.push(`| legacy portrait | ${c.legacy.length} | ${c.legacy.filter((l) => l.colour).length} |`);
  return lines.join("\n");
}

if (values.undo) {
  const saved: UndoFile = JSON.parse(readFileSync(values.undo, "utf8"));
  let restored = 0;
  for (const change of saved.rerendered) {
    const row = await db.query.media.findFirst({ where: eq(media.id, change.id) });
    if (!row || row.s3Key !== change.after.s3Key) {
      console.warn(`Skipped ${change.id}: the image changed after the run`);
      continue;
    }
    if (await monochrome.restoreAuthorMediaColour(row, change)) restored++;
  }
  let portraits = 0;
  for (const item of saved.imported) {
    if (item.monochromeS3Key) {
      if (await monochrome.restoreLegacyAuthorPhoto(item.authorId, item.photoS3Key, item.monochromeS3Key)) portraits++;
      else console.warn(`Skipped the legacy portrait of ${item.authorId}: it changed after the run`);
    }
    if (item.mediaId) await monochrome.removeImportedAuthorPhoto(item.mediaId);
  }
  console.log(
    `Restored ${restored} of ${saved.rerendered.length} images and ${portraits} legacy portraits; removed ${saved.imported.filter((i) => i.mediaId).length} poster images made from them.`,
  );
  process.exit(0);
}

const before = await counts();
const report = [
  `# Author images in monochrome: ${values.apply ? "applied" : "dry run (nothing written)"}`,
  "",
  `Run on ${new Date().toISOString()}.`,
  "",
  "## Before",
  "",
  table(before),
];

if (values.apply) {
  const undo: UndoFile = { appliedAt: new Date().toISOString(), backup: values.backup!, rerendered: [], imported: [] };
  const failures: string[] = [];
  const save = () => writeFileSync(values["undo-file"]!, JSON.stringify(undo, null, 2));
  for (const { row, colour } of before.rows) {
    if (!colour) continue;
    try {
      const change = await monochrome.renderAuthorMediaMonochrome(row);
      if (change) undo.rerendered.push(change);
      else failures.push(`${row.id}: the image changed during the run`);
    } catch (error) {
      failures.push(`${row.id}: ${(error as Error).message}`);
    }
    save();
  }
  for (const legacy of before.legacy) {
    if (!legacy.colour) continue;
    const item: UndoFile["imported"][number] = { authorId: legacy.authorId, photoS3Key: legacy.photoS3Key, monochromeS3Key: null, mediaId: null };
    undo.imported.push(item);
    try {
      if (!legacy.hasPoster) {
        item.mediaId = await monochrome.importLegacyAuthorPhoto(legacy.authorId, legacy.photoS3Key);
        save();
      }
      // Nothing falls back to the colour file, also when the poster image goes later
      item.monochromeS3Key = await monochrome.replaceLegacyAuthorPhoto(legacy.authorId, legacy.photoS3Key);
      if (!item.monochromeS3Key) failures.push(`${legacy.authorId} (legacy portrait): it changed during the run`);
    } catch (error) {
      failures.push(`${legacy.authorId} (legacy portrait): ${(error as Error).message}`);
    }
    save();
  }
  const after = await counts();
  report.push(
    "",
    "## After",
    "",
    table(after),
    "",
    `Re-rendered ${undo.rerendered.length} images and replaced ${undo.imported.filter((i) => i.monochromeS3Key).length} legacy portraits (${undo.imported.filter((i) => i.mediaId).length} became poster images). Undo: \`--undo ${values["undo-file"]}\`.`,
    ...(failures.length ? ["", "## Not changed", "", ...failures.map((f) => `- ${f}`)] : []),
  );
} else {
  report.push("", "## Would change", "");
  for (const { row, colour } of before.rows)
    if (colour)
      report.push(`- ${row.type} \`${row.id}\` of author \`${row.authorId}\`${row.originalS3Key ? "" : " (no original yet: a colour copy becomes it)"}`);
  for (const legacy of before.legacy)
    if (legacy.colour)
      report.push(`- legacy portrait of author \`${legacy.authorId}\`: a monochrome copy replaces it${legacy.hasPoster ? "" : ", and becomes a poster image"}`);
}

writeFileSync(values.report!, report.join("\n") + "\n");
console.log(`${before.colour} author images in colour. Report: ${values.report}`);
process.exit(0);
