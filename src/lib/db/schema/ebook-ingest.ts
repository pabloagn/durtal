import { pgTable, uuid, text, integer, bigint, jsonb, timestamp, index, unique, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { ebooks, ebookFiles } from "./ebooks";

/** Item outcomes, in the order a run's page lists them */
export const INGEST_OUTCOMES = [
  "new_ebook",
  "new_format",
  "replaced_file",
  "already_stored",
  "duplicate_in_run",
  "quarantined",
  "ignored",
  "changed_since_plan",
] as const;
export type IngestOutcome = (typeof INGEST_OUTCOMES)[number];

/** What a reconciliation found, stored on the run when it finishes */
export interface IngestReconciliation {
  at: string;
  host: string | null;
  roots: string[];
  onDisk: number;
  inNeon: number;
  inS3: number;
  exact: boolean;
  /**
   * Every exception by name and reason. Blocking ones keep the run from
   * being exact: a file not stored, a row whose object is missing or
   * differs, an object no row names. Ignored, DRM, quarantined and
   * duplicate files are accounted for and listed, never blocking.
   */
  exceptions: { side: "disk" | "neon" | "s3"; kind: string; path: string; reason: string; blocking: boolean }[];
  /** Rows whose source file is gone from this host after its object was verified: never an exception */
  noLongerInInbox: number;
  inFlight: number;
}

/**
 * One apply, one browser upload batch or one verification run (SLN-494).
 * `counts` holds one count per item outcome, kept current while it runs.
 */
export const ebookIngestRuns = pgTable(
  "ebook_ingest_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind", { enum: ["apply", "upload", "verify"] }).notNull(),
    state: text("state", { enum: ["running", "finished", "interrupted", "failed"] })
      .notNull()
      .default("running"),
    /** The machine's name; null for uploads */
    host: text("host"),
    /** The folders given */
    roots: text("roots").array().notNull().default(sql`'{}'::text[]`),
    /** The SHA-256 of the plan file an apply executed */
    planSha256: text("plan_sha256"),
    toolVersion: integer("tool_version").notNull(),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    reconciliation: jsonb("reconciliation").$type<IngestReconciliation>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("ebook_ingest_runs_kind_check", sql`${t.kind} in ('apply', 'upload', 'verify')`),
    check(
      "ebook_ingest_runs_state_check",
      sql`${t.state} in ('running', 'finished', 'interrupted', 'failed')`,
    ),
    index("ebook_ingest_runs_started_idx").on(t.startedAt),
  ],
);

/**
 * One file a run considered. Every path a run saw stays here, so "where is
 * this file" is always answerable. `stored`: the object and its derived
 * objects are in S3 and verified; `registered`: its rows are written;
 * `done`: nothing is left to do.
 */
export const ebookIngestItems = pgTable(
  "ebook_ingest_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ebookIngestRuns.id, { onDelete: "cascade" }),
    sourceHost: text("source_host"),
    sourcePath: text("source_path").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sourceMtime: timestamp("source_mtime", { withTimezone: true }),
    /** Null until hashed */
    sha256: text("sha256"),
    /** From the contract's list; null until sniffed */
    format: text("format"),
    state: text("state", { enum: ["pending", "stored", "registered", "done", "failed"] })
      .notNull()
      .default("pending"),
    outcome: text("outcome", { enum: INGEST_OUTCOMES }),
    /** For ignored, quarantined and failed items: plain words */
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    ebookId: uuid("ebook_id").references(() => ebooks.id, { onDelete: "set null" }),
    fileId: uuid("file_id").references(() => ebookFiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("ebook_ingest_items_run_path_unique").on(t.runId, t.sourcePath),
    index("ebook_ingest_items_run_state_idx").on(t.runId, t.state),
    index("ebook_ingest_items_sha256_idx").on(t.sha256),
    check(
      "ebook_ingest_items_state_check",
      sql`${t.state} in ('pending', 'stored', 'registered', 'done', 'failed')`,
    ),
    check(
      "ebook_ingest_items_outcome_check",
      sql`${t.outcome} is null or ${t.outcome} in ('new_ebook', 'new_format', 'replaced_file', 'already_stored', 'duplicate_in_run', 'quarantined', 'ignored', 'changed_since_plan')`,
    ),
    check(
      "ebook_ingest_items_format_check",
      sql`${t.format} is null or ${t.format} in ('epub', 'kepub', 'pdf', 'mobi', 'azw', 'azw3', 'kfx', 'fb2', 'fbz', 'cbz', 'cbr', 'djvu', 'txt', 'rtf', 'docx', 'lit', 'chm', 'other')`,
    ),
  ],
);

export const ebookIngestRunsRelations = relations(ebookIngestRuns, ({ many }) => ({
  items: many(ebookIngestItems),
}));

export const ebookIngestItemsRelations = relations(ebookIngestItems, ({ one }) => ({
  run: one(ebookIngestRuns, { fields: [ebookIngestItems.runId], references: [ebookIngestRuns.id] }),
  ebook: one(ebooks, { fields: [ebookIngestItems.ebookId], references: [ebooks.id] }),
  file: one(ebookFiles, { fields: [ebookIngestItems.fileId], references: [ebookFiles.id] }),
}));
