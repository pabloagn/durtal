import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const imports = pgTable("imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(),
  status: text("status").notNull().default("pending"),
  s3BronzeKey: text("s3_bronze_key"),
  s3SilverKey: text("s3_silver_key"),
  totalRecords: integer("total_records"),
  processedRecords: integer("processed_records").notNull().default(0),
  skippedRecords: integer("skipped_records").notNull().default(0),
  errorRecords: integer("error_records").notNull().default(0),
  errorLog: jsonb("error_log"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
