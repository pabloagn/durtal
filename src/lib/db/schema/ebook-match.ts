import {
  pgTable,
  uuid,
  smallint,
  text,
  real,
  integer,
  jsonb,
  timestamp,
  check,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ebooks } from "./ebooks";
import { works } from "./works";
import { editions } from "./editions";
import { instances } from "./instances";
import type { Reason, MatchFlag, EditionRule } from "@/lib/ebooks/match/types";

/** Review proposals only; book/ref triggers are declared in the reserved 0082 proposal. */
export const ebookMatchCandidates = pgTable(
  "ebook_match_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ebookId: uuid("ebook_id")
      .notNull()
      .references(() => ebooks.id, { onDelete: "cascade" }),
    rank: smallint("rank").notNull(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, {
      onDelete: "set null",
    }),
    instanceId: uuid("instance_id").references(() => instances.id, {
      onDelete: "set null",
    }),
    editionRule: text("edition_rule").$type<EditionRule>().notNull(),
    probability: real("probability").notNull(),
    weightBits: real("weight_bits").notNull(),
    marginBits: real("margin_bits"),
    reasons: jsonb("reasons").$type<readonly Reason[]>().notNull(),
    flags: text("flags")
      .array()
      .$type<MatchFlag[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    modelVersion: integer("model_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("ebook_match_candidates_rank_unique").on(t.ebookId, t.rank),
    index("ebook_match_candidates_work_idx").on(t.workId),
    check("ebook_match_candidates_rank_check", sql`${t.rank} between 1 and 3`),
    check(
      "ebook_match_candidates_rule_check",
      sql`${t.editionRule} in ('isbn_edition','fill_copy','new_isbn_edition','placeholder_copy','new_edition')`,
    ),
    check(
      "ebook_match_candidates_probability_check",
      sql`${t.probability} not in ('NaN'::real, 'Infinity'::real, '-Infinity'::real) and ${t.probability} between 0 and 1`,
    ),
    check(
      "ebook_match_candidates_weight_check",
      sql`${t.weightBits} not in ('NaN'::real, 'Infinity'::real, '-Infinity'::real)`,
    ),
    check(
      "ebook_match_candidates_margin_check",
      sql`${t.marginBits} is null or (${t.rank} = 1 and ${t.marginBits} not in ('NaN'::real, 'Infinity'::real, '-Infinity'::real))`,
    ),
    check(
      "ebook_match_candidates_reasons_check",
      sql`jsonb_typeof(${t.reasons}) = 'array'`,
    ),
    check(
      "ebook_match_candidates_flags_check",
      sql`${t.flags} <@ ARRAY['omnibus','sample','periodical','article','shared_isbn']::text[]`,
    ),
    check("ebook_match_candidates_model_check", sql`${t.modelVersion} > 0`),
    check(
      "ebook_match_candidates_instance_edition_check",
      sql`${t.instanceId} is null or ${t.editionId} is not null`,
    ),
  ],
);
