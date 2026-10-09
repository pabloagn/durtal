import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import {
  ebookFileDownloadableCondition,
  ebookFileNativeReadableCondition,
  isEbookFileDownloadable,
  isEbookFileNativeReadable,
  type EbookFileEligibility,
} from "@/lib/ebooks/conditions";
import { ebookFileKey } from "@/lib/ebooks/keys";
import {
  malformedPublicationCases,
  publicationFixture,
} from "../ebooks/publication-fixture";

// Added to the local harness manifest automatically. Never connect outside its disposable database.
const url = process.env.DURTAL_EBOOK_LIBRARY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln497_ebook_library"
  )
    throw new Error(
      "E-book library tests require disposable local sln497_ebook_library",
    );
}
const client = url ? postgres(url, { max: 1, onnotice: () => {} }) : null;
const database = client ? drizzle(client) : null;
const columns = {
  status: sql`f.status`,
  drm: sql`f.drm`,
  s3Key: sql`f.s3_key`,
  sha256: sql`f.sha256`,
  sizeBytes: sql`f.size_bytes`,
  manifestKey: sql`f.manifest_key`,
  format: sql`f.format`,
  metadata: sql`f.metadata`,
};

describe.skipIf(!url)(
  "e-book library SQL/TypeScript eligibility parity",
  () => {
    afterAll(async () => {
      await client?.end();
    });
    afterEach(() => vi.unstubAllEnvs());

    async function parity(file: EbookFileEligibility) {
      const [row] = await database!.execute(sql`select
      ${ebookFileDownloadableCondition(columns)} as downloadable,
      ${ebookFileNativeReadableCondition(columns)} as readable
      from (select ${file.status}::text as status, ${file.drm}::text as drm,
        ${file.s3Key}::text as s3_key, ${file.sha256}::text as sha256, ${file.format}::text as format,
        ${file.sizeBytes}::numeric as size_bytes, ${file.manifestKey ?? null}::text as manifest_key,
        ${JSON.stringify(file.metadata === undefined ? {} : file.metadata)}::jsonb as metadata) f`);
      expect(row.downloadable, JSON.stringify(file)).toBe(
        isEbookFileDownloadable(file),
      );
      expect(row.readable, JSON.stringify(file)).toBe(
        isEbookFileNativeReadable(file),
      );
    }

    it("compares valid, rejected, legacy and malformed publication cases in real PostgreSQL", async () => {
      const base = publicationFixture();
      const sha = base.sha256;
      const m = base.metadata.medallion;
      const cases: EbookFileEligibility[] = [
        base,
        ...malformedPublicationCases(),
        { ...base, status: "verified" },
        ...["missing", "quarantined", "replaced", "pending"].map((status) => ({
          ...base,
          status,
        })),
        ...["adobe-adept", ""].map((drm) => ({ ...base, drm })),
        { ...base, metadata: {} },
        { ...base, metadata: undefined },
        {
          ...base,
          metadata: {
            medallion: {
              ...m,
              validation: { ...m.validation, nativeReadable: false },
            },
          },
        },
        { ...base, sha256: "invalid" },
        { ...base, format: "pdf" },
        { ...base, s3Key: base.s3Key.replace("gold/", "bronze/") },
        { ...base, s3Key: ebookFileKey(sha, "epub"), metadata: undefined },
        {
          ...base,
          s3Key: ebookFileKey(sha, "epub"),
          metadata: { medallion: null },
        },
        {
          ...base,
          format: "txt",
          s3Key: ebookFileKey(sha, "txt"),
          metadata: {},
        },
      ];
      for (const file of cases) await parity(file);
      vi.stubEnv("EBOOKS_PREFIX", "legacy/");
      await parity({
        ...base,
        s3Key: ebookFileKey(sha, "epub"),
        metadata: undefined,
      });
      await parity(base);
    });
  },
);
