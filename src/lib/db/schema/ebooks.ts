import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  numeric,
  real,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { instances } from "./instances";

/**
 * One e-book: one text, in one or more files (SLN-490, the e-book epic's
 * contract). It is a digital copy of a book once linked: `instance_id` names
 * the copy, and its edition and work come through the copy. A trigger keeps
 * e-books book-only; another sends an e-book back to review when its copy is
 * removed. Its files are never lost with the copy.
 */
export const ebooks = pgTable(
  "ebooks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    /** Normalised for natural sort */
    titleSort: text("title_sort"),
    subtitle: text("subtitle"),
    /** In natural order: "Jorge Luis Borges" */
    authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
    authorSort: text("author_sort"),
    /** ISO 639-1 where one exists, else 639-2/3: the file's declared language */
    language: text("language"),
    /** Valid ISBN-13s only, canonical */
    isbns: text("isbns").array().notNull().default(sql`'{}'::text[]`),
    /** Other ids (asin, goodreads, google, openlibrary, oclc, doi, uuid), each a list of strings */
    identifiers: jsonb("identifiers").$type<Record<string, string[]>>().notNull().default({}),
    series: text("series"),
    seriesIndex: numeric("series_index", { mode: "number" }),
    publisher: text("publisher"),
    /** Null when unknown; a 101 sentinel is stored as null */
    publishedYear: integer("published_year"),
    description: text("description"),
    /** The preferred file's derived cover (an S3 key) */
    coverKey: text("cover_key"),
    /** The file the reader opens first */
    preferredFileId: uuid("preferred_file_id").references((): AnyPgColumn => ebookFiles.id, {
      onDelete: "set null",
    }),
    /** The digital copy this e-book is. Linked means it is set. */
    instanceId: uuid("instance_id")
      .unique()
      .references(() => instances.id, { onDelete: "set null" }),
    /**
     * pending: no decision yet; linked: a copy is set; standalone: kept as an
     * e-book without a book record (readable, not catalogued); excluded: not a
     * book, a duplicate or junk, hidden from the library and never deleted.
     */
    matchState: text("match_state", { enum: ["pending", "linked", "standalone", "excluded"] })
      .notNull()
      .default("pending"),
    /** isbn, identifier, score, manual or accession */
    matchMethod: text("match_method"),
    matchProbability: real("match_probability"),
    matchedAt: timestamp("matched_at", { withTimezone: true }),
    /** folder or upload */
    importSource: text("import_source").notNull(),
    /** The uuid identifier of a sidecar metadata.opf, so the text's other formats join this e-book */
    importRef: text("import_ref"),
    /** normalizeSearchText(title + subtitle + authors + series) */
    searchText: text("search_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "ebooks_match_state_check",
      sql`${t.matchState} in ('pending', 'linked', 'standalone', 'excluded')`,
    ),
    check(
      "ebooks_linked_check",
      sql`(${t.matchState} = 'linked') = (${t.instanceId} is not null)`,
    ),
    uniqueIndex("ebooks_import_ref_unique")
      .on(t.importSource, t.importRef)
      .where(sql`${t.importRef} is not null`),
    index("ebooks_isbns_idx").using("gin", t.isbns),
    index("ebooks_search_text_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
  ],
);

/** One stored file, keyed by its bytes */
export const ebookFiles = pgTable(
  "ebook_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ebookId: uuid("ebook_id")
      .notNull()
      .references((): AnyPgColumn => ebooks.id, { onDelete: "restrict" }),
    /** 64 lowercase hex characters */
    sha256: text("sha256").notNull().unique(),
    format: text("format", {
      enum: [
        "epub",
        "kepub",
        "pdf",
        "mobi",
        "azw",
        "azw3",
        "kfx",
        "fb2",
        "fbz",
        "cbz",
        "cbr",
        "djvu",
        "txt",
        "rtf",
        "docx",
        "lit",
        "chm",
        "other",
      ],
    }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: text("content_type").notNull(),
    originalFilename: text("original_filename"),
    s3Key: text("s3_key").notNull().unique(),
    /**
     * stored: uploaded, its checksum matched; verified: a later run re-read
     * the checksum and size; missing: no object, or it differs; quarantined:
     * unreadable, never served; replaced: superseded by a newer file.
     */
    status: text("status", { enum: ["stored", "verified", "missing", "quarantined", "replaced"] }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** adobe-adept, kindle, readium-lcp, apple-fairplay, pdf-password or unknown: stored, never opened */
    drm: text("drm"),
    /** Where it was found: the master catalogue's "where it is" */
    sourceHost: text("source_host"),
    sourcePath: text("source_path"),
    sourceMtime: timestamp("source_mtime", { withTimezone: true }),
    /** What the file itself says */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    // Text counts, agreed with the book enrichment epic (extractBodyText)
    wordCount: integer("word_count"),
    charCount: integer("char_count"),
    frontBackWordCount: integer("front_back_word_count"),
    pageEstimate: integer("page_estimate"),
    textLanguage: text("text_language"),
    textToolVersion: integer("text_tool_version"),
    /** Derived objects (S3 keys) */
    manifestKey: text("manifest_key"),
    coverKey: text("cover_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ebook_files_ebook_idx").on(t.ebookId),
    check("ebook_files_sha256_check", sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
    check(
      "ebook_files_format_check",
      sql`${t.format} in ('epub', 'kepub', 'pdf', 'mobi', 'azw', 'azw3', 'kfx', 'fb2', 'fbz', 'cbz', 'cbr', 'djvu', 'txt', 'rtf', 'docx', 'lit', 'chm', 'other')`,
    ),
    check(
      "ebook_files_status_check",
      sql`${t.status} in ('stored', 'verified', 'missing', 'quarantined', 'replaced')`,
    ),
  ],
);

export const ebooksRelations = relations(ebooks, ({ one, many }) => ({
  instance: one(instances, {
    fields: [ebooks.instanceId],
    references: [instances.id],
  }),
  preferredFile: one(ebookFiles, {
    fields: [ebooks.preferredFileId],
    references: [ebookFiles.id],
    relationName: "preferredFile",
  }),
  files: many(ebookFiles, { relationName: "ebookFiles" }),
}));

export const ebookFilesRelations = relations(ebookFiles, ({ one }) => ({
  ebook: one(ebooks, {
    fields: [ebookFiles.ebookId],
    references: [ebooks.id],
    relationName: "ebookFiles",
  }),
}));
