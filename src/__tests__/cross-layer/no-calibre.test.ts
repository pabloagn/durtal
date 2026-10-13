import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/*
 * Durtal does not depend on Calibre for anything (SLN-490). No screen, code
 * path, setting, script or document names it. History is left as it was:
 * migrations and changelogs are not scanned.
 *
 * Two things are allowed, as the e-book epic (SLN-489) agreed:
 * - OPF metadata names of the form `calibre:<name>` (calibre:series,
 *   calibre:series_index...), which many tools write into OPF files, under
 *   src/lib/ebooks/ingest/ and src/__tests__/, for the e-book metadata reader;
 * - text files under src/__tests__/fixtures/ebooks/ (sidecar OPF fixtures as
 *   tools write them);
 * - the reader's engine, foliate-js, vendored as published under
 *   src/vendor/foliate-js/ (SLN-492): third-party code that reads the
 *   metadata names and bookmarks other tools write, which Durtal never edits
 *   beyond its recorded patches.
 *
 * And the few files that read the schema or files from before SLN-490, as a
 * migration does: the interchange version 1 reader, and the tests that build
 * the old tables to prove they are dropped only when empty.
 *
 * Since SLN-656, a Calibre library is one source the e-book ingestion reads,
 * once and read-only, from a copy of its metadata.db, so that Joris can leave
 * Calibre for good: Durtal still never runs, needs or writes to Calibre. Its
 * name is allowed where that source is read and documented: the ingestion
 * library and commands, their tests, the ingestion pipeline document and the
 * package script that runs the snapshot. Import existing (SLN-657) reads the
 * same source through its own command. Never in a screen, a setting or
 * anything else.
 */

const ROOT = path.resolve(__dirname, "../../..");
const SCANNED = ["src", "scripts", "public", "docs", ".env.example", "HANDOVER.md", "README.md", "pyproject.toml", "package.json"];
const SKIPPED_FOLDERS = ["src/lib/db/migrations", "changelog", "node_modules", "__pycache__", ".venv"];
const FIXTURES = "src/__tests__/fixtures/ebooks/";
const VENDORED = "src/vendor/foliate-js/";
const OPF_NAME_FOLDERS = ["src/lib/ebooks/ingest/", "src/__tests__/"];
/** Where the Calibre library source is read, tested and documented (SLN-656) */
const CALIBRE_SOURCE = [
  "src/lib/ebooks/calibre/",
  "src/lib/ebooks/ingest/",
  "scripts/ebooks/calibre-snapshot.ts",
  "scripts/ebooks/ingest.ts",
  "scripts/ebooks/import-existing.ts",
  "src/__tests__/ebooks/calibre/",
  "src/__tests__/ebooks/ingest/",
  "src/__tests__/fixtures/calibre-library.ts",
  "src/__tests__/integration/ebook-ingest.test.ts",
  "src/__tests__/integration/ebook-import-existing.test.ts",
  "docs/09_INGESTION_PIPELINE.md",
];
/** The package script that takes a snapshot; package.json may name Calibre nowhere else */
const CALIBRE_SCRIPT = /^\s*"ebooks:calibre-snapshot": "tsx --tsconfig tsconfig\.json scripts\/ebooks\/calibre-snapshot\.ts",$/;
/** Files that read what came before SLN-490 */
const HISTORY_READERS = new Set([
  "src/lib/interchange/version-1.ts",
  "src/__tests__/cross-layer/no-calibre.test.ts",
  "src/__tests__/integration/ebook-catalogue.test.ts",
  "src/__tests__/integration/work-kind-migration.test.ts",
  "src/__tests__/integration/interchange.test.ts",
  "src/__tests__/interchange/format.test.ts",
]);
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|otf|ttf|eot|pdf|epub|mobi|azw3?|zip|gz|parquet|xlsx|dump)$/i;

function files(entry: string): string[] {
  const full = path.join(ROOT, entry);
  if (!existsSync(full)) return [];
  if (SKIPPED_FOLDERS.some((folder) => entry === folder || entry.startsWith(`${folder}/`))) return [];
  if (statSync(full).isDirectory())
    return readdirSync(full).flatMap((name) => files(path.posix.join(entry, name)));
  return BINARY.test(entry) ? [] : [entry];
}

/** Every line that names Calibre where the rule does not allow it */
function mentions(file: string): string[] {
  if (file.startsWith(FIXTURES) || file.startsWith(VENDORED) || HISTORY_READERS.has(file)) return [];
  if (CALIBRE_SOURCE.some((allowed) => file === allowed || (allowed.endsWith("/") && file.startsWith(allowed)))) return [];
  const opfNames = OPF_NAME_FOLDERS.some((folder) => file.startsWith(folder));
  return readFileSync(path.join(ROOT, file), "utf8")
    .split("\n")
    .flatMap((line, i) => {
      if (file === "package.json" && CALIBRE_SCRIPT.test(line)) return [];
      const rest = opfNames ? line.replace(/calibre:[\w:-]+/gi, "") : line;
      return /calibre/i.test(rest) ? [`${file}:${i + 1}: ${line.trim().slice(0, 120)}`] : [];
    });
}

describe("no Calibre", () => {
  it("names Calibre nowhere in Durtal outside history and OPF metadata names", () => {
    const scanned = SCANNED.flatMap(files);
    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.flatMap(mentions)).toEqual([]);
  });

  it("allows the Calibre library source only where it is read, tested and documented", () => {
    expect(CALIBRE_SCRIPT.test(`    "ebooks:calibre-snapshot": "tsx --tsconfig tsconfig.json scripts/ebooks/calibre-snapshot.ts",`)).toBe(true);
    expect(CALIBRE_SCRIPT.test(`    "calibre": "calibredb list",`)).toBe(false);
    expect(CALIBRE_SOURCE.some((allowed) => "src/app/(catalogue)/settings/page.tsx".startsWith(allowed))).toBe(false);
  });

  it("allows an OPF metadata name only where the metadata reader and its tests live", () => {
    expect("calibre:series_index".replace(/calibre:[\w:-]+/gi, "")).toBe("");
    expect(/calibre/i.test("the Calibre library".replace(/calibre:[\w:-]+/gi, ""))).toBe(true);
  });
});
