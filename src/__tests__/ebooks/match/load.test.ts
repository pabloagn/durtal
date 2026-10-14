import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Global database read forbidden");
      },
    },
  ),
}));
import {
  loadMatchCatalogue,
  MATCH_TABLES,
  type StoredRow,
  type MatchTable,
} from "@/lib/ebooks/match/load";
import { digitalLocationAllowed } from "@/lib/ebooks/match/location-policy";
import { ebookFileKey, ebookDerivedKey } from "@/lib/ebooks/keys";
import {
  publicationFixture,
  malformedPublicationCases,
} from "../publication-fixture";

const at = "2026-10-09T12:00:00+00:00";
function inputs() {
  const rows = Object.fromEntries(
    MATCH_TABLES.map((table) => [table, []]),
  ) as unknown as Record<MatchTable, StoredRow[]>;
  rows.works = [
    {
      id: "work-1",
      kind: "book",
      title: "Nadja",
      original_language: "en",
      catalogue_status: "wanted",
      created_at: at,
      updated_at: at,
    },
  ];
  rows.editions = [
    {
      id: "edition-1",
      work_id: "work-1",
      title: "Nadja",
      language: "en",
      isbn_10: "0306406152",
      metadata_source: "phantom_canon",
      metadata_locked: false,
      created_at: at,
      updated_at: at,
    },
  ];
  rows.authors = [{ id: "author-1", name: "André Breton" }];
  rows.person_aliases = [
    { person_id: "author-1", name: "A. Breton" } as StoredRow,
  ];
  rows.work_authors = [
    {
      id: "credit-1",
      work_id: "work-1",
      author_id: "author-1",
      role: "author",
    },
  ];
  rows.catalogue_identifiers = [
    {
      id: "identifier-1",
      edition_id: "edition-1",
      provider: "google",
      external_id: "id",
    },
  ];
  rows.instances = [
    {
      id: "copy-1",
      edition_id: "edition-1",
      location_id: "location-1",
      status: "available",
      updated_at: at,
    },
  ];
  rows.locations = [{ id: "location-1", type: "digital", is_active: true }];
  rows.app_settings = [
    { id: true, ebook_location_id: "location-1" } as unknown as StoredRow,
  ];
  rows.ebooks = [
    {
      id: "ebook-1",
      title: "Nadja",
      authors: ["André Breton"],
      language: "en",
      isbns: [],
      identifiers: {},
      match_state: "pending",
      created_at: at,
      updated_at: at,
    },
  ];
  const sha256 = "a".repeat(64);
  rows.ebook_files = [
    {
      id: "file-1",
      ebook_id: "ebook-1",
      sha256,
      s3_key: ebookFileKey(sha256, "epub"),
      format: "epub",
      size_bytes: 100,
      content_type: "application/epub+zip",
      status: "stored",
      drm: null,
      metadata: {},
      cover_key: ebookDerivedKey(sha256, "cover-800.webp"),
    },
  ];
  return rows;
}
function connection(rows: Record<MatchTable, StoredRow[]>) {
  const dialect = new PgDialect();
  const seen: string[] = [];
  const conn = {
    execute: vi.fn(async (query: SQL) => {
      const text = dialect.sqlToQuery(query).sql;
      const table = MATCH_TABLES.find((table) =>
        text.includes(`from "${table}" r`),
      );
      if (!table) throw new Error("Unexpected query");
      expect(text).not.toContain("order by r.id"); // aliases have a composite key.
      seen.push(table);
      return rows[table].map((row) => ({ s: JSON.stringify(row) }));
    }),
  } as unknown as Db;
  return { conn, seen };
}
function publicationRows(
  file:
    | ReturnType<typeof publicationFixture>
    | ReturnType<typeof malformedPublicationCases>[number],
) {
  const rows = inputs();
  rows.ebook_files[0] = {
    ...rows.ebook_files[0],
    sha256: file.sha256,
    s3_key: file.s3Key,
    size_bytes: file.sizeBytes,
    format: file.format,
    status: file.status,
    drm: file.drm,
    metadata: file.metadata,
    manifest_key: file.manifestKey,
    cover_key: publicationFixture().metadata.medallion.gold[1].key,
  };
  return rows;
}
describe("explicit protected catalogue loading", () => {
  it("uses only its supplied connection once per table and preserves identifier/alias/seed evidence", async () => {
    const rows = inputs(),
      { conn, seen } = connection(rows);
    const before = JSON.stringify(rows);
    const loaded = await loadMatchCatalogue(conn);
    expect(seen).toEqual(MATCH_TABLES);
    expect(loaded.catalogue.source.ebookLocationId).toBe("location-1");
    expect(loaded.catalogue.source.authors[0].aliases).toEqual(["A. Breton"]);
    expect(
      loaded.catalogue.byWorkId.get("work-1")!.isbns.has("9780306406157"),
    ).toBe(true);
    expect(loaded.catalogue.identifierWorkIds.get("google:id")).toEqual(
      new Set(["work-1"]),
    );
    expect(loaded.catalogue.source.ebooks[0].files[0]).toMatchObject({
      availability: "native",
      coverKey: rows.ebook_files[0].cover_key,
    });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("does not infer a digital location or validated cover from a plausible identifier", async () => {
    const rows = inputs();
    rows.locations[0].type = "physical";
    rows.ebook_files[0].cover_key = ebookDerivedKey(
      "b".repeat(64),
      "cover-800.webp",
    );
    rows.ebook_files[0].status = "quarantined";
    const loaded = await loadMatchCatalogue(connection(rows).conn);
    expect(loaded.catalogue.source.ebookLocationId).toBeNull();
    expect(loaded.catalogue.source.ebooks[0].files[0]).toMatchObject({
      availability: "blocked",
      coverKey: null,
    });
  });
  it("keeps exclusion reason out of bibliographic input fingerprint while retaining full state for stale guards", async () => {
    const rows = inputs();
    const first = await loadMatchCatalogue(connection(rows).conn);
    rows.ebooks[0].match_state = "excluded";
    rows.ebooks[0].exclusion_reason = "other";
    const second = await loadMatchCatalogue(connection(rows).conn);
    expect(second.inputFingerprint).toBe(first.inputFingerprint);
    expect(second.rows.ebooks[0].exclusion_reason).toBe("other");
  });
  it("accepts strict publication lineage and exposes a cover belonging to that publication", async () => {
    const file = publicationFixture();
    const rows = publicationRows(file);
    // Accession uses 800 px; a valid smaller cover is not silently substituted.
    rows.ebook_files[0].cover_key = file.metadata.medallion.gold[1].key.replace(
      "cover-240.webp",
      "cover-800.webp",
    );
    file.metadata.medallion.gold[1].key = String(rows.ebook_files[0].cover_key);
    const loaded = await loadMatchCatalogue(connection(rows).conn);
    expect(loaded.catalogue.source.ebooks[0].files[0]).toMatchObject({
      availability: "native",
      coverKey: rows.ebook_files[0].cover_key,
    });
  });
  it.each(malformedPublicationCases().map((file, index) => ({ file, index })))(
    "refuses malformed publication $index without crashing catalogue loading",
    async ({ file }) => {
      const loaded = await loadMatchCatalogue(
        connection(publicationRows(file)).conn,
      );
      expect(loaded.catalogue.source.ebooks[0].files[0]).toMatchObject({
        availability: "blocked",
        coverKey: null,
      });
      expect(loaded.catalogue.works).toHaveLength(1);
    },
  );
  it.each(["downloadable", "nativeReadable"] as const)(
    "refuses string false in %s and a null gold member",
    async (field) => {
      const file = publicationFixture();
      const metadata = structuredClone(file.metadata) as {
        medallion: { validation: Record<string, unknown>; gold: unknown[] };
      };
      metadata.medallion.validation[field] = "false";
      let loaded = await loadMatchCatalogue(
        connection(publicationRows({ ...file, metadata })).conn,
      );
      expect(loaded.catalogue.source.ebooks[0].files[0].availability).toBe(
        "blocked",
      );
      metadata.medallion.validation[field] = true;
      metadata.medallion.gold = [null];
      loaded = await loadMatchCatalogue(
        connection(publicationRows({ ...file, metadata })).conn,
      );
      expect(loaded.catalogue.source.ebooks[0].files[0]).toMatchObject({
        availability: "blocked",
        coverKey: null,
      });
    },
  );
  it("keeps validated download-only evidence separate from native reading and rejects an unrecorded cover lineage", async () => {
    const file = publicationFixture();
    file.metadata.medallion.validation.nativeReadable = false;
    const rows = publicationRows(file);
    rows.ebook_files[0].cover_key = file.metadata.medallion.gold[1].key.replace(
      "cover-240.webp",
      "cover-800.webp",
    );
    const loaded = await loadMatchCatalogue(connection(rows).conn);
    expect(loaded.catalogue.source.ebooks[0].files[0]).toMatchObject({
      availability: "download",
      coverKey: null,
    });
  });
});
describe("digital location policy", () => {
  it("uses the configured active digital location for creation and any explicit active digital copy", () => {
    const digital = { id: "other", type: "digital", isActive: true };
    expect(digitalLocationAllowed(digital, "configured")).toBe(false);
    expect(digitalLocationAllowed(digital, "configured", true)).toBe(true);
    expect(
      digitalLocationAllowed({ ...digital, type: "physical" }, "other", true),
    ).toBe(false);
    expect(
      digitalLocationAllowed({ ...digital, isActive: false }, "other", true),
    ).toBe(false);
    expect(digitalLocationAllowed(undefined, null, true)).toBe(false);
  });
});
