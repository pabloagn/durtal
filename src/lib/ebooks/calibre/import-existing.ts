import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "@/lib/catalogue/work-store";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { toCSV } from "@/lib/utils/export";
import { isReadableFormat } from "../formats";
import { formatBytes, formatDuration } from "../run-text";
import { mergeMetadata, storable } from "../ingest/metadata";
import { openFileSource } from "../ingest/source";
import { openZip } from "../ingest/zip";
import { epubDrm } from "../ingest/inspect/drm";
import { parseMobiHeader, readRecord0 } from "../ingest/inspect/mobi";
import { indexCatalogue, type MatchCatalogue } from "../match/catalogue";
import { findClashes, oneEbookPerWork, type Clash } from "../match/clashes";
import { dataFingerprint, loadMatchCatalogue, type LoadedMatchCatalogue } from "../match/load";
import { MATCH_MODEL } from "../match/model";
import { planRegisteredMatchingOn } from "../match/command";
import { matchOne } from "../match/tiers";
import type { EditionRule, MatchEbook, MatchFile, MatchResult, MatchTier } from "../match/types";
import { calibreFileMetadata, checkCalibreSource, libraryPath, readSnapshot, type CalibreBook, type CalibreSnapshot } from "./library";
import { SELECTION_VERSION, type CalibreSelection } from "./selection";

/*
 * Import existing (SLN-657), the first of the two modes Joris asked for: of
 * the Calibre books, find the ones already among Durtal's books and give
 * them their e-books, and nothing else. `pnpm ebooks:import-existing` is the
 * dry run. It scores every Calibre book from its snapshot against Durtal's
 * book works with the matching model, before any file is read; then, for the
 * books in scope only, checks each format is on the drive and whether it
 * carries DRM. It writes a report and a selection, and nothing else: the
 * catalogue is read through the read-only planning session, the drive only
 * read. The ingest then plans the selection alone (`--select`), and the
 * matching links what the precision check allows (`--selection`).
 *
 * Import existing never creates a work, an author, a series or a publisher:
 * a Calibre book that is not one of Durtal's books is left for Bulk import.
 */

/** A book is in scope when its best tier against a Durtal work is one of these */
export const IN_SCOPE: readonly MatchTier[] = ["exact", "strong", "likely", "to_choose", "conflict"];
/** In scope: one of those tiers, with at least one of Durtal's books as a candidate */
const proposes = (result: MatchResult) => !!result.tier && IN_SCOPE.includes(result.tier) && result.candidates.length > 0;

export interface ImportExistingFormat {
  format: string;
  /** Calibre's recorded size */
  size: number;
  path: string;
  /** Checked for the books in scope only */
  onDisk: boolean | null;
  drm: string | null;
}

export type Difference = "title" | "authors" | "series";

export interface ImportExistingBook {
  bookId: number;
  uuid: string;
  title: string;
  authors: string[];
  /** Already an e-book in Durtal (its Calibre uuid is known): never selected again */
  stored: boolean;
  tier: MatchTier | null;
  inScope: boolean;
  /** In scope and with a file on the drive */
  selected: boolean;
  /** Links by itself once the labelled precision check passes */
  autoLink: boolean;
  clashes: Clash[];
  workId: string | null;
  workTitle: string | null;
  candidates: string[];
  rule: EditionRule | null;
  instanceId: string | null;
  effect: string | null;
  formats: ImportExistingFormat[];
  /** What Calibre says differently from the book it matches: decided in 9c */
  differences: Difference[];
  rating: number | null;
  /** Durtal rates the book otherwise */
  ratingDiffers: boolean;
  readDate: string | null;
}

export interface ImportExistingPlan {
  createdAt: string;
  snapshot: { file: string; sha256: string; libraryId: string; libraryPath: string; books: number };
  catalogueFingerprint: string;
  modelVersion: number;
  books: ImportExistingBook[];
  coverage: {
    works: number;
    auto: number;
    review: number;
    /** Works that already have an e-book and no Calibre book proposes */
    hasEbook: number;
    /** Works no Calibre book proposes */
    none: { id: string; title: string; authors: string[] }[];
    /** Durtal's digital copies without a file */
    copiesWaiting: number;
    copiesAuto: number;
    copiesReview: number;
  };
  uploadSpeed: number | null;
  selection: CalibreSelection;
}

/** A Calibre book's fields as the ingest will give its e-book: the snapshot alone, no file read */
function calibreEbook(book: CalibreBook, files: MatchFile[], at: string): MatchEbook {
  const name = book.formats[0]?.path.split("/").pop() ?? book.title;
  const merged = mergeMetadata([{ source: "calibre", metadata: storable(calibreFileMetadata(book)) }], name);
  return {
    id: `calibre:${book.uuid}`,
    title: merged.title,
    subtitle: merged.subtitle,
    authors: merged.authors,
    language: merged.language,
    isbns: merged.isbns,
    identifiers: merged.identifiers,
    series: merged.series,
    seriesIndex: merged.seriesIndex,
    publisher: merged.publisher,
    publishedYear: merged.publishedYear,
    files,
    createdAt: book.added ?? at,
    updatedAt: book.lastModified ?? at,
    instanceId: null,
    matchState: "pending",
    matchFingerprint: null,
    exclusionReason: null,
  };
}

/** A format as the matcher sees it: until it is checked on the drive, as if it were there and readable */
function matchFile(book: CalibreBook, format: ImportExistingFormat): MatchFile {
  const there = format.onDisk !== false;
  return {
    id: `calibre:${book.uuid}:${format.format}`,
    sha256: `calibre:${book.uuid}:${format.format}`,
    format: format.format,
    sizeBytes: format.size,
    status: there ? "verified" : "missing",
    drm: format.drm,
    availability: !there ? "blocked" : isReadableFormat(format.format) ? "native" : "download",
  };
}

/**
 * DRM, by a quick look that never reads the whole file: an EPUB's
 * encryption.xml, a Kindle file's MOBI header or KFX wrapper. A PDF's is
 * found when the selection is planned; a damaged file there too.
 */
export async function quickDrm(file: string, format: string): Promise<string | null> {
  const source = await openFileSource(file);
  try {
    if (format === "epub" || format === "kepub") {
      const zip = await openZip(source);
      try {
        const encryption = zip.names.find((n) => n.toLowerCase() === "meta-inf/encryption.xml");
        return epubDrm(zip.names, encryption ? await zip.text(encryption) : null);
      } finally {
        await zip.close();
      }
    }
    if (format === "mobi" || format === "azw" || format === "azw3") {
      const record0 = await readRecord0(source);
      return record0 && parseMobiHeader(record0).encryption !== 0 ? "kindle" : null;
    }
    if (format === "kfx") return String.fromCharCode(...(await source.read(0, 8))) === "\xEADRMION" ? "kindle" : null;
    return null;
  } catch {
    return null;
  } finally {
    await source.close();
  }
}

/** Each format of the book on the drive, read only inside the library */
async function checkFormats(root: string, book: CalibreBook): Promise<ImportExistingFormat[]> {
  const folder = libraryPath(root, book.path);
  return Promise.all(
    book.formats.map(async ({ format, size, path: relative }) => {
      const file = libraryPath(root, relative);
      const onDisk = !!folder && !!file && path.dirname(file) === folder && existsSync(file) && statSync(file).isFile();
      return { format, size, path: relative, onDisk, drm: onDisk ? await quickDrm(file!, format) : null };
    }),
  );
}

/** Custom date columns that hold when a book was read */
const readDateColumns = (snapshot: CalibreSnapshot) =>
  snapshot.columns.filter((c) => c.type === "datetime" && /read/i.test(`${c.label} ${c.name}`)).map((c) => c.label);

/** Scores the snapshot against the catalogue and checks the books in scope on the drive */
export async function planImportExisting(
  loaded: LoadedMatchCatalogue,
  source: { file: string; snapshot: CalibreSnapshot; sha256: string; root: string },
  options: { now?: number; uploadSpeed?: number | null } = {},
): Promise<ImportExistingPlan> {
  const at = new Date(options.now ?? Date.now()).toISOString();
  const { snapshot } = source;
  const storedRefs = new Set(loaded.rows.ebooks.filter((row) => row.import_source === "folder" && row.import_ref).map((row) => String(row.import_ref)));
  const formatsOf = (book: CalibreBook): ImportExistingFormat[] => book.formats.map((f) => ({ format: f.format, size: f.size, path: f.path, onDisk: null, drm: null }));
  const fresh = snapshot.books.filter((book) => !storedRefs.has(book.uuid));
  const ebooks = new Map(fresh.map((book) => [book.uuid, calibreEbook(book, formatsOf(book).map((f) => matchFile(book, f)), at)]));

  // Every Calibre book counts for shared ISBNs and common titles; none is another's duplicate here
  const indexed = indexCatalogue({ ...loaded.catalogue.source, ebooks: [...loaded.catalogue.source.ebooks, ...ebooks.values()] });
  const catalogue: MatchCatalogue = { ...indexed, duplicateGroups: new Map() };
  const firstPass = new Map(fresh.map((book) => [book.uuid, matchOne(ebooks.get(book.uuid)!, catalogue)]));

  // The books in scope only: their formats on the drive, then scored again with what was found
  const formats = new Map<string, ImportExistingFormat[]>();
  const scored = new Map<string, MatchResult>();
  for (const book of fresh) {
    const result = firstPass.get(book.uuid)!;
    if (!proposes(result)) continue;
    const checked = await checkFormats(source.root, book);
    formats.set(book.uuid, checked);
    const ebook = { ...ebooks.get(book.uuid)!, files: checked.map((f) => matchFile(book, f)) };
    scored.set(book.uuid, checked.some((f) => f.onDisk) ? matchOne(ebook, catalogue) : result);
  }
  // One book, one e-book: among the books with a file to give
  const giving = [...scored.entries()].filter(([uuid]) => formats.get(uuid)!.some((f) => f.onDisk)).map(([, result]) => result);
  const clashes = findClashes(giving, catalogue);
  const final = new Map(oneEbookPerWork(giving, catalogue).map((result) => [result.ebookId, result]));

  const readColumns = readDateColumns(snapshot);
  const workRating = new Map(loaded.rows.works.map((row) => [String(row.id), row.rating == null ? null : Number(row.rating)]));
  const books: ImportExistingBook[] = snapshot.books.map((book) => {
    const stored = storedRefs.has(book.uuid);
    const id = `calibre:${book.uuid}`;
    const result = final.get(id) ?? scored.get(book.uuid) ?? firstPass.get(book.uuid) ?? null;
    const inScope = !stored && !!result && proposes(result);
    const bookFormats = formats.get(book.uuid) ?? formatsOf(book);
    const selected = inScope && bookFormats.some((f) => f.onDisk);
    const lead = inScope ? (result?.candidates[0] ?? null) : null;
    const work = lead ? catalogue.byWorkId.get(lead.workId)!.source : null;
    const differences: Difference[] = [];
    if (lead && work) {
      if (!lead.titleExact) differences.push("title");
      if (lead.authorLevel !== "identity") differences.push("authors");
      if (book.series && work.series.length && !work.series.some((s) => normalizeSearchText(s) === normalizeSearchText(book.series!))) differences.push("series");
    }
    const durtalRating = work ? (workRating.get(work.id) ?? null) : null;
    const readDate = readColumns.map((label) => book.custom[label]).find((v): v is string => typeof v === "string") ?? null;
    return {
      bookId: book.id,
      uuid: book.uuid,
      title: book.title,
      authors: book.authors.map((a) => a.name),
      stored,
      tier: stored ? null : (result?.tier ?? null),
      inScope,
      selected,
      autoLink: selected && !!result?.autoLink,
      clashes: clashes.get(id) ?? [],
      workId: work?.id ?? null,
      workTitle: work?.title ?? null,
      candidates: inScope ? (result?.candidates.map((c) => c.workId) ?? []) : [],
      rule: lead?.effect.rule ?? null,
      instanceId: lead?.effect.instanceId ?? null,
      effect: lead?.effect.text ?? null,
      formats: bookFormats,
      differences,
      rating: book.rating,
      ratingDiffers: book.rating !== null && durtalRating !== null && durtalRating !== book.rating,
      readDate,
    };
  });

  const chosen = books.filter((b) => b.selected);
  const autoWorks = new Set(chosen.filter((b) => b.autoLink).map((b) => b.workId!));
  const reviewWorks = new Set(chosen.filter((b) => !b.autoLink).flatMap((b) => b.candidates).filter((id) => !autoWorks.has(id)));
  const withEbook = (work: MatchCatalogue["works"][number]) => work.source.copies.some((copy) => copy.linkedEbookId);
  const digital = new Set(loaded.catalogue.source.digitalLocationIds ?? []);
  const waiting = catalogue.works.flatMap((w) => w.source.copies).filter((c) => digital.has(c.locationId) && c.status !== "deaccessioned" && !c.linkedEbookId);
  const filling = (auto: boolean) => new Set(chosen.filter((b) => b.autoLink === auto && b.instanceId).map((b) => b.instanceId!));
  const copiesAuto = filling(true);
  const copiesReview = filling(false);

  return {
    createdAt: at,
    snapshot: { file: path.resolve(source.file), sha256: source.sha256, libraryId: snapshot.library.id, libraryPath: source.root, books: snapshot.books.length },
    catalogueFingerprint: loaded.catalogueFingerprint,
    modelVersion: MATCH_MODEL.version,
    books,
    coverage: {
      works: catalogue.works.length,
      auto: autoWorks.size,
      review: reviewWorks.size,
      hasEbook: catalogue.works.filter((w) => !autoWorks.has(w.source.id) && !reviewWorks.has(w.source.id) && withEbook(w)).length,
      none: catalogue.works
        .filter((w) => !autoWorks.has(w.source.id) && !reviewWorks.has(w.source.id) && !withEbook(w))
        .map((w) => ({ id: w.source.id, title: w.source.title, authors: w.source.authors.map((a) => a.name) })),
      copiesWaiting: waiting.length,
      copiesAuto: waiting.filter((c) => copiesAuto.has(c.id)).length,
      copiesReview: waiting.filter((c) => copiesReview.has(c.id) && !copiesAuto.has(c.id)).length,
    },
    uploadSpeed: options.uploadSpeed ?? null,
    selection: {
      v: SELECTION_VERSION,
      kind: "calibre_import_existing",
      createdAt: at,
      libraryId: snapshot.library.id,
      snapshotSha256: source.sha256,
      metadataDbSha256: snapshot.metadataDb.sha256,
      catalogueFingerprint: loaded.catalogueFingerprint,
      modelVersion: MATCH_MODEL.version,
      modelFingerprint: dataFingerprint(MATCH_MODEL),
      books: chosen.map((b) => ({ bookId: b.bookId, uuid: b.uuid, review: !b.autoLink })),
    },
  };
}

/** The dry run on a read-only planning session: the catalogue and the snapshot's library, both only read */
export async function planImportExistingOn(
  database: Db,
  snapshotFile: string,
  options: { root?: string; now?: number; uploadSpeed?: number | null } = {},
): Promise<ImportExistingPlan> {
  const { snapshot, sha256 } = readSnapshot(snapshotFile);
  const root = path.resolve(options.root ?? snapshot.library.path);
  await checkCalibreSource(
    { snapshot: path.resolve(snapshotFile), snapshotSha256: sha256, libraryId: snapshot.library.id, libraryPath: root, metadataDbSha256: snapshot.metadataDb.sha256 },
    "Nothing read.",
  );
  const loaded = await loadMatchCatalogue(database);
  return planImportExisting(loaded, { file: snapshotFile, snapshot, sha256, root }, options);
}

/** Counts only: what the terminal prints and what Linear and the changelog may carry */
export function importExistingCounts(plan: ImportExistingPlan) {
  const books = plan.books;
  const chosen = books.filter((b) => b.selected);
  const tally = (values: string[]) => values.reduce<Record<string, number>>((all, v) => ((all[v] = (all[v] ?? 0) + 1), all), {});
  const present = chosen.flatMap((b) => b.formats.filter((f) => f.onDisk));
  return {
    books: books.length,
    alreadyStored: books.filter((b) => b.stored).length,
    inScope: books.filter((b) => b.inScope).length,
    selected: chosen.length,
    noFile: books.filter((b) => b.inScope && !b.selected).length,
    auto: chosen.filter((b) => b.autoLink).length,
    review: chosen.filter((b) => !b.autoLink).length,
    byTier: tally(chosen.map((b) => b.tier!)),
    byRule: tally(chosen.map((b) => b.rule ?? "none")),
    clashes: tally(chosen.flatMap((b) => b.clashes)),
    formats: tally(present.map((f) => f.format)),
    bytes: present.reduce((n, f) => n + f.size, 0),
    bytesByFormat: present.reduce<Record<string, number>>((all, f) => ((all[f.format] = (all[f.format] ?? 0) + f.size), all), {}),
    drm: tally(present.filter((f) => f.drm).map((f) => f.drm!)),
    missingFiles: chosen.flatMap((b) => b.formats).filter((f) => f.onDisk === false).length,
    differences: tally(chosen.flatMap((b) => b.differences)),
    rated: chosen.filter((b) => b.rating !== null).length,
    ratingsDiffer: chosen.filter((b) => b.ratingDiffers).length,
    readDates: chosen.filter((b) => b.readDate).length,
    leftForBulk: tally(books.filter((b) => !b.stored && !b.inScope).map((b) => b.tier ?? "none")),
  };
}

const n = (value: number) => value.toLocaleString("en-US");
const listed = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${n(v)}`)
    .join(", ") || "none";
const line = (text: string) => text.replace(/[\r\n]+/g, " ");

/** The report in reports/ebooks: counts first, then the books it names (the folder is git-ignored) */
export function importExistingReport(plan: ImportExistingPlan, files: { selection: string; csv: string }): string {
  const c = importExistingCounts(plan);
  const chosen = plan.books.filter((b) => b.selected);
  const seconds = plan.uploadSpeed ? c.bytes / plan.uploadSpeed : null;
  const clashing = chosen.filter((b) => b.clashes.length);
  const byWork = new Map<string, ImportExistingBook[]>();
  for (const book of clashing.filter((b) => b.clashes.includes("several_ebooks"))) byWork.set(book.workId!, [...(byWork.get(book.workId!) ?? []), book]);
  return [
    `# Import existing, ${plan.createdAt}`,
    "",
    `Calibre library ${plan.snapshot.libraryId}, from the snapshot ${plan.snapshot.file}, read at ${plan.snapshot.libraryPath}. Dry run: nothing was written to Durtal, the bucket or the drive.`,
    `Matching model ${plan.modelVersion}; catalogue ${plan.catalogueFingerprint}.`,
    "",
    "## Coverage of Durtal",
    "",
    "| | |",
    "|---|---|",
    `| Durtal's books | ${n(plan.coverage.works)} |`,
    `| Would get their e-book by themselves | ${n(plan.coverage.auto)} |`,
    `| Would go to review | ${n(plan.coverage.review)} |`,
    `| Already have an e-book, and no Calibre book for them | ${n(plan.coverage.hasEbook)} |`,
    `| No e-book in Calibre | ${n(plan.coverage.none.length)} |`,
    `| Digital copies without a file | ${n(plan.coverage.copiesWaiting)}: ${n(plan.coverage.copiesAuto)} would get one by themselves, ${n(plan.coverage.copiesReview)} in review |`,
    "",
    "A book that links by itself still waits for the labelled precision check (99% and no wrong book) after the upload.",
    "",
    "## The selection",
    "",
    "| | |",
    "|---|---|",
    `| Calibre books | ${n(c.books)} |`,
    `| Already e-books in Durtal, never selected again | ${n(c.alreadyStored)} |`,
    `| In scope | ${n(c.inScope)}; with no file on the drive: ${n(c.noFile)} |`,
    `| Selected | ${n(c.selected)}: ${n(c.auto)} link by themselves, ${n(c.review)} go to review |`,
    `| By tier | ${listed(c.byTier)} |`,
    `| Edition rule | ${listed(c.byRule)} |`,
    `| Files | ${listed(c.formats)} |`,
    `| Size | ${formatBytes(c.bytes)} (${Object.entries(c.bytesByFormat).sort((a, b) => b[1] - a[1]).map(([f, b]) => `${f} ${formatBytes(b)}`).join(", ") || "none"}) |`,
    `| Upload | ${seconds === null ? "no measured speed yet" : `about ${formatDuration(seconds)} at the last measured speed`} |`,
    `| DRM files | ${listed(c.drm)} (EPUB and Kindle files; a PDF's is found when the selection is planned) |`,
    `| Formats missing on the drive | ${n(c.missingFiles)} |`,
    "",
    "## Clashes",
    "",
    `${n(clashing.length)} selected books go to review for a clash: ${listed(c.clashes)}.`,
    "",
    "### Several e-books for one book",
    "",
    ...(byWork.size
      ? [...byWork.values()].map((group) => `- ${line(group[0].workTitle ?? "")} (${group[0].workId}): ${group.map((b) => `${line(b.title)} (book ${b.bookId})`).join("; ")}`)
      : ["None."]),
    "",
    "### Calibre books that score for several books",
    "",
    ...(clashing.some((b) => b.clashes.includes("several_works"))
      ? clashing.filter((b) => b.clashes.includes("several_works")).map((b) => `- ${line(b.title)} (book ${b.bookId}): ${b.candidates.join(", ")}`)
      : ["None."]),
    "",
    "### Books that already have an e-book",
    "",
    ...(clashing.some((b) => b.clashes.includes("has_ebook"))
      ? clashing.filter((b) => b.clashes.includes("has_ebook")).map((b) => `- ${line(b.title)} (book ${b.bookId}) for ${line(b.workTitle ?? "")}`)
      : ["None."]),
    "",
    "## For the differences step (9c)",
    "",
    `Metadata differences: ${listed(c.differences)}. Rated in Calibre: ${n(c.rated)}, of which ${n(c.ratingsDiffer)} differ from Durtal's rating. Read dates: ${n(c.readDates)}.`,
    "",
    "## Left for Bulk import",
    "",
    `${listed(c.leftForBulk)}.`,
    "",
    "## Durtal's books with no e-book in Calibre",
    "",
    ...(plan.coverage.none.length ? plan.coverage.none.map((w) => `- ${line(w.title)}${w.authors.length ? `, ${line(w.authors.join("; "))}` : ""}`) : ["None."]),
    "",
    "## Next",
    "",
    `1. Plan the selection: \`pnpm ebooks:ingest --calibre ${plan.snapshot.file} --select ${files.selection}\`.`,
    "2. Apply that plan with a backup from the last hour, after Joris's yes.",
    `3. Match: \`pnpm ebooks:import-existing --match ${files.selection}\`, label its sample, then \`pnpm ebooks:match --score\` and \`--apply\`.`,
    "",
    `Every Calibre book, one row each: ${files.csv}`,
    "",
  ].join("\n");
}

/** One row per Calibre book */
export function importExistingCsv(plan: ImportExistingPlan): string {
  const columns = ["book_id", "uuid", "title", "authors", "stored", "tier", "selected", "links_by_itself", "clashes", "work_id", "work_title", "edition_rule", "effect", "formats", "missing", "drm", "differences", "rating", "read_date"];
  return toCSV(
    plan.books.map((b) => ({
      book_id: b.bookId,
      uuid: b.uuid,
      title: b.title,
      authors: b.authors.join("; "),
      stored: b.stored ? "yes" : "",
      tier: b.tier ?? "",
      selected: b.selected ? "yes" : "",
      links_by_itself: b.autoLink ? "yes" : "",
      clashes: b.clashes.join("; "),
      work_id: b.workId ?? "",
      work_title: b.workTitle ?? "",
      edition_rule: b.rule ?? "",
      effect: b.effect ?? "",
      formats: b.formats.map((f) => f.format).join("; "),
      missing: b.formats.filter((f) => f.onDisk === false).map((f) => f.path).join("; "),
      drm: b.formats.filter((f) => f.drm).map((f) => `${f.format}: ${f.drm}`).join("; "),
      differences: b.differences.join("; "),
      rating: b.rating ?? "",
      read_date: b.readDate ?? "",
    })),
    columns,
  );
}

const stampOf = (at: string) => at.replace(/[:.]/g, "-");

/** Writes import-existing-<time>.md, .csv and .selection.json into reportDir */
export function writeImportExisting(plan: ImportExistingPlan, reportDir: string) {
  mkdirSync(reportDir, { recursive: true });
  const base = path.join(reportDir, `import-existing-${stampOf(plan.createdAt)}`);
  const files = { markdown: `${base}.md`, csv: `${base}.csv`, selection: `${base}.selection.json` };
  writeFileSync(files.selection, JSON.stringify(plan.selection, null, 2), { flag: "wx" });
  writeFileSync(files.csv, importExistingCsv(plan), { flag: "wx" });
  writeFileSync(files.markdown, importExistingReport(plan, files), { flag: "wx" });
  return files;
}

/** Shown in the review queue for a book the dry run sent there */
const DRY_RUN_REVIEW = { code: "import_existing_review", text: "Import existing's dry run, which saw the whole library, sent this e-book to review" };

/**
 * The matching of a selection once its ingest is applied: the e-books its
 * books became, known by their Calibre uuid, scored with one book, one
 * e-book. A book the dry run sent to review stays there: the dry run saw
 * the whole library (an ISBN shared by books left out, a second copy not on
 * the drive), this scope sees only the selection. The labels, the precision
 * check and the apply are the matching's own (`pnpm ebooks:match --score`,
 * `--apply`).
 */
export async function planSelectionMatchingOn(database: Db, target: string, selection: CalibreSelection) {
  const loaded = await loadMatchCatalogue(database);
  const books = new Map(selection.books.map((book) => [book.uuid, book]));
  const rows = loaded.rows.ebooks.filter((row) => row.import_source === "folder" && books.has(String(row.import_ref)));
  const ids = rows.map((row) => String(row.id)).sort();
  if (!ids.length) throw new Error("None of the selection's books is an e-book in Durtal yet: apply its ingest plan first. Nothing planned.");
  const held = new Map(rows.filter((row) => books.get(String(row.import_ref))!.review).map((row) => [String(row.id), DRY_RUN_REVIEW]));
  const document = await planRegisteredMatchingOn(database, target, ids, { oneEbookPerWork: true, holdForReview: held });
  return { document, notStored: selection.books.length - ids.length };
}
