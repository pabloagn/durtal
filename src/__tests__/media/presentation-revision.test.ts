import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/lib/db/schema";
import {
  assertImageRevision,
  imagePresentationLocks,
  imageRevisionExtras,
  imageRevisionSql,
  type ImageSubjectKind,
} from "@/lib/media/presentation-revision";

const dialect = new PgDialect();
const subject = {
  kind: "media",
  id: "00000000-0000-0000-0000-000000000333",
} as const;

describe("precise image revision query contract", () => {
  it("fingerprints database JSON including full adjustment timestamp and absent-row null", () => {
    const query = dialect.sqlToQuery(imageRevisionSql(subject));
    expect(query.sql).toContain("md5(jsonb_build_array(");
    expect(query.sql).toContain("select to_jsonb(a) from image_adjustments a");
    expect(query.sql).toContain('"media"."uncropped_s3_key"');
    expect(query.sql).toContain("select kind from works");
    expect(query.sql).not.toMatch(
      /extract|epoch|date_trunc|to_char|coalesce.*settings/i,
    );
    expect(query.params).toEqual([subject.id]);
  });
  it("locks the missing adjustment identity and actual rows before asserting the baseline", () => {
    const locks = imagePresentationLocks(
      subject,
      "gold/media/fixture/full.webp",
    ).map((query) => dialect.sqlToQuery(query));
    expect(locks[0].sql).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(locks[0].params).toEqual(["gold/media/fixture/full.webp"]);
    expect(locks[1].sql).toContain("for share");
    expect(locks[2].sql).toContain('from "media"');
    expect(locks[2].sql).toContain("for update");
    expect(locks[3].sql).toContain("from image_adjustments");
    expect(locks[3].sql).toContain("for update");
    const guard = dialect.sqlToQuery(
      assertImageRevision(subject, "a".repeat(32)),
    );
    expect(guard.sql).toContain("harmonization_assert(coalesce(");
    expect(guard.params).toContain("a".repeat(32));
    expect(guard.params).toContainEqual(
      expect.stringContaining("Reload and review"),
    );
  });
  it.each<[ImageSubjectKind, keyof typeof db.query]>([
    ["media", "media"],
    ["author", "authors"],
    ["edition", "editions"],
    ["venue", "venues"],
    ["attachment", "commentAttachments"],
  ])(
    "compiles %s extras against actual relational aliases without network",
    (kind, name) => {
      const queries = {
        media: () =>
          db.query.media
            .findFirst({ extras: imageRevisionExtras("media") })
            .toSQL(),
        author: () =>
          db.query.authors
            .findFirst({ extras: imageRevisionExtras("author") })
            .toSQL(),
        edition: () =>
          db.query.editions
            .findFirst({ extras: imageRevisionExtras("edition") })
            .toSQL(),
        venue: () =>
          db.query.venues
            .findFirst({ extras: imageRevisionExtras("venue") })
            .toSQL(),
        attachment: () =>
          db.query.commentAttachments
            .findFirst({ extras: imageRevisionExtras("attachment") })
            .toSQL(),
      };
      const query = queries[kind]();
      expect(query.sql).toContain(`"${name}"`);
      expect(query.sql).toContain('as "revision"');
      expect(query.sql).toContain('as "stored_settings"');
      if (kind === "attachment") {
        expect(query.sql).toContain(
          'a.asset_key = "commentAttachments"."s3_key"',
        );
        expect(query.sql).not.toContain(
          'a.asset_key = "comment_attachments"."s3_key"',
        );
      }
      if (kind === "edition")
        expect(query.sql).toContain(
          'coalesce("editions"."cover_s3_key", "editions"."thumbnail_s3_key")',
        );
    },
  );
});

// Constructing/compiling a query never connects to this deliberately invalid host.
const db = drizzle({
  client: neon("postgresql://test@db.invalid/test"),
  schema,
});
