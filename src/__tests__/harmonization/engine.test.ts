import { describe, it, expect } from "vitest";
import {
  recordRef,
  scanDataset,
  preferredRecord,
  RULES,
} from "@/lib/harmonization/engine";
import { ENTITIES, entityDefinition } from "@/lib/harmonization/registry";
import {
  displayName,
  identityName,
  normalize,
  validIsbn,
} from "@/lib/harmonization/normalize";
import { mergeBlockers, resolvedValues } from "@/lib/harmonization/merge";
import type { Dataset, Row } from "@/lib/harmonization/types";
const row = (id: string, extra: Record<string, unknown>): Row => ({
  id,
  ...extra,
});
const duplicates = (data: Dataset) =>
  scanDataset(data).filter((f) => f.category === "duplicates");
const rules = (data: Dataset) => scanDataset(data).map((f) => f.rule);

describe("catalogue identity heuristics", () => {
  it("prefers natural author order, regardless of metadata completeness", () => {
    const authors = [
      row("a", {
        name: "Balle, Solvej",
        bio: "More complete",
        birth_year: 1959,
      }),
      row("b", { name: "Solvej Balle" }),
    ];
    expect(duplicates({ authors })[0]).toMatchObject({
      recommendedId: "b",
      confidence: "high",
      resolution: { kind: "merge" },
    });
    expect(preferredRecord(entityDefinition("authors"), authors).id).toBe("b");
  });
  it.each([
    ["José Donoso", "Jose Donoso"],
    ["M. R. James", "M.R. James"],
    ["Ursula K. Le Guin", "Le Guin, Ursula K."],
    ["Mircea Cărtărescu", "Mircea Cartarescu"],
    ["Søren Kierkegaard", "Soren Kierkegaard"],
  ])("finds generalized name variants: %s / %s", (a, b) => {
    expect(
      duplicates({ authors: [row("a", { name: a }), row("b", { name: b })] }),
    ).toHaveLength(1);
  });
  it("flags close spellings without asserting they are the same person", () => {
    const found = duplicates({
      authors: [
        row("a", { name: "Gabriel Garcia Marquez" }),
        row("b", { name: "Gabriel Garcia Marques" }),
      ],
    });
    expect(found[0]).toMatchObject({
      rule: "duplicate-spelling",
      confidence: "medium",
    });
  });
  it("does not fuzz short names or omit given names", () => {
    expect(
      duplicates({
        authors: [
          row("a", { name: "Li Bo" }),
          row("b", { name: "Li Po" }),
          row("c", { name: "John Smith" }),
          row("d", { name: "Jane Smith" }),
          row("e", { name: "Smith" }),
        ],
      }),
    ).toHaveLength(0);
  });
  it("does not turn suffixes or ambiguous comma strings into automatic renames", () => {
    for (const name of [
      "Martin Luther King, Jr.",
      "Smith, John, PhD",
      "Balle, ",
      "Charles-Louis de Secondat, Baron de Montesquieu",
    ])
      expect(displayName(name)).toBe(name);
  });
  it("treats conflicting author dates as weak evidence", () => {
    expect(
      duplicates({
        authors: [
          row("a", { name: "John Smith", birth_year: 1900 }),
          row("b", { name: "John Smith", birth_year: 1980 }),
        ],
      })[0].confidence,
    ).toBe("low");
  });
  it("does not merge homonymous books by different people", () => {
    expect(
      duplicates({
        works: [
          row("w1", { title: "The Gift" }),
          row("w2", { title: "The Gift" }),
        ],
        authors: [
          row("a1", { name: "Vladimir Nabokov" }),
          row("a2", { name: "Lewis Hyde" }),
        ],
        work_authors: [
          row("j1", { work_id: "w1", author_id: "a1" }),
          row("j2", { work_id: "w2", author_id: "a2" }),
        ],
      }),
    ).toHaveLength(0);
  });
  it("finds accent-variant works even when their authors are split", () => {
    const found = duplicates({
      works: [
        row("w1", { title: "Agua Viva" }),
        row("w2", { title: "Água Viva" }),
      ],
      authors: [
        row("a1", { name: "Lispector, Clarice" }),
        row("a2", { name: "Clarice Lispector" }),
      ],
      work_authors: [
        row("j1", { work_id: "w1", author_id: "a1" }),
        row("j2", { work_id: "w2", author_id: "a2" }),
      ],
    });
    expect(found.find((f) => f.entity === "works")?.confidence).toBe("high");
  });
  it.each([
    [
      "places",
      { type: "city", country_id: "us" },
      { type: "city", country_id: "fr" },
    ],
    [
      "publishing_houses",
      { kind: "imprint", parent_id: "one" },
      { kind: "imprint", parent_id: "two" },
    ],
    ["custom_taxonomy_items", { family_id: "one" }, { family_id: "two" }],
    ["locations", { type: "physical" }, { type: "digital" }],
    ["sub_locations", { location_id: "one" }, { location_id: "two" }],
    ["venues", { formatted_address: "London" }, { formatted_address: "Paris" }],
  ])("respects identity context in %s", (table, a, b) => {
    expect(
      duplicates({
        [table]: [
          row("a", { name: "Same name", ...a }),
          row("b", { name: "Same name", ...b }),
        ],
      }),
    ).toHaveLength(0);
  });
  it("never proposes merging publications with distinct ISBNs or editions across works", () => {
    expect(
      duplicates({
        editions: [
          row("a", { title: "Book", work_id: "w", isbn_13: "9780140449136" }),
          row("b", { title: "Book", work_id: "w", isbn_13: "9780140449181" }),
          row("c", { title: "Book", work_id: "other" }),
        ],
      }),
    ).toHaveLength(0);
  });
  it("supports duplicates in all configured name-bearing families", () => {
    for (const entity of ENTITIES.filter(
      (e) => e.duplicate && e.key !== "editions",
    )) {
      expect(
        duplicates({
          [entity.table]: [
            row("a", { [entity.name]: "Café Noir" }),
            row("b", { [entity.name]: "Cafe Noir" }),
          ],
        }).length,
        entity.key,
      ).toBe(1);
    }
  });
  it("emits one finding per pair even when deletion neighborhoods overlap", () => {
    expect(
      duplicates({
        authors: [
          row("a", { name: "Krasznahorkai, László" }),
          row("b", { name: "Laszlo Krasznahorkai" }),
        ],
      }),
    ).toHaveLength(1);
  });
});

describe("data quality beyond duplicates", () => {
  it("distinguishes a work poster, edition cover and author background", () => {
    const findings = scanDataset({
      works: [row("w", { title: "Book" })],
      editions: [
        row("e", {
          title: "Edition",
          work_id: "w",
          cover_s3_key: "cover.webp",
        }),
      ],
      authors: [row("a", { name: "Author", photo_s3_key: "portrait.webp" })],
      media: [
        row("m", {
          author_id: "a",
          type: "poster",
          is_active: true,
          s3_key: "poster.webp",
        }),
      ],
    });
    expect(
      findings.find((f) => f.entity === "works" && f.rule === "missing-artwork")
        ?.resolution,
    ).toMatchObject({ kind: "poster", s3Key: "cover.webp" });
    expect(
      findings
        .filter((f) => f.entity === "authors" && f.rule === "missing-artwork")
        .map((f) => f.title),
    ).toEqual(["Missing background"]);
    expect(findings.some((f) => f.rule === "missing-edition-cover")).toBe(
      false,
    );
  });
  it("ignores inactive media and reports conflicting active images", () => {
    expect(
      rules({
        authors: [row("a", { name: "A" })],
        media: [
          row("m1", {
            author_id: "a",
            type: "poster",
            is_active: false,
            s3_key: "x",
          }),
        ],
      }),
    ).toContain("missing-artwork");
    expect(
      rules({
        authors: [row("a", { name: "A" })],
        media: ["m1", "m2"].map((id) =>
          row(id, {
            author_id: "a",
            type: "poster",
            is_active: true,
            s3_key: id,
          }),
        ),
      }),
    ).toContain("multiple-active-artwork");
  });
  it("checks identifier checksums and allows ISBN-10 X", () => {
    expect(validIsbn("0-8044-2957-X", 10)).toBe(true);
    expect(validIsbn("978-0-306-40615-7", 13)).toBe(true);
    expect(validIsbn("9780306406158", 13)).toBe(false);
    expect(
      rules({
        editions: [
          row("e", { title: "Book", isbn_13: "9780306406158", page_count: -3 }),
        ],
      }),
    ).toEqual(expect.arrayContaining(["invalid-isbn", "invalid-measurement"]));
  });
  it("reports contradictory dates, relationships and provenance", () => {
    const found = rules({
      authors: [row("a", { name: "A", birth_year: 1950, death_year: 1940 })],
      works: [row("w", { title: "B", original_year: 2000 })],
      editions: [
        row("e", { title: "B", work_id: "w", publication_year: 1990 }),
      ],
      orders: [
        row("o", {
          work_id: "wrong",
          edition_id: "e",
          order_date: "2026-02-01",
          shipped_date: "2026-01-01",
          price: "10",
          shipping_cost: "5",
          total_cost: "11",
          status: "received",
        }),
      ],
    });
    expect(found).toEqual(
      expect.arrayContaining([
        "life-dates",
        "publication-chronology",
        "order-chronology",
        "order-total",
        "order-currency",
        "order-relationships",
        "received-copy",
      ]),
    );
  });
  it("detects hierarchy loops without hanging", () => {
    expect(
      rules({
        genres: [
          row("a", { name: "A", parent_id: "b" }),
          row("b", { name: "B", parent_id: "a" }),
        ],
      }).filter((r) => r === "hierarchy-cycle"),
    ).toHaveLength(2);
  });
  it("checks location and shelf identity, and does not assume zero coordinates are absent", () => {
    const found = rules({
      locations: [
        row("l", {
          name: "Digital",
          type: "digital",
          latitude: 0,
          longitude: 0,
        }),
      ],
      sub_locations: [row("s", { name: "Shelf", location_id: "other" })],
      instances: [
        row("i", {
          format: "hardcover",
          location_id: "l",
          sub_location_id: "s",
          status: "lent_out",
        }),
      ],
    });
    expect(found).toEqual(
      expect.arrayContaining([
        "copy-location",
        "shelf-location",
        "loan-details",
      ]),
    );
    expect(found).not.toContain("coordinate-pair");
  });
  it("only links a legacy series when there is exactly one match", () => {
    const data = {
      works: [row("w", { title: "Book", series_name: "Café" })],
      series: [row("s", { title: "Cafe" })],
    };
    expect(
      scanDataset(data).find((f) => f.rule === "legacy-series")?.resolution
        .kind,
    ).toBe("update");
    expect(
      scanDataset({
        ...data,
        series: [...data.series, row("s2", { title: "Café" })],
      }).find((f) => f.rule === "legacy-series")?.resolution.kind,
    ).toBe("review");
  });
  it("dismissal fingerprints change with relevant evidence but not unrelated timestamps", () => {
    const a = scanDataset({
      authors: [row("a", { name: " Balle, Solvej ", updated_at: "2020" })],
    }).find((f) => f.rule === "name-whitespace")!;
    const b = scanDataset({
      authors: [row("a", { name: " Balle, Solvej ", updated_at: "2021" })],
    }).find((f) => f.rule === "name-whitespace")!;
    const c = scanDataset({
      authors: [row("a", { name: " Balle, Solvej  ", updated_at: "2021" })],
    }).find((f) => f.rule === "name-whitespace")!;
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
  it("builds links only to existing route structures", () => {
    for (const key of ["locations", "sub-locations", "orders"])
      expect(
        recordRef(entityDefinition(key), row("id", { name: "Name" }), {}).href,
      ).not.toContain("/id");
    expect(
      recordRef(
        entityDefinition("series"),
        row("id", { title: "Name", slug: "slug" }),
        {},
      ).href,
    ).toBe("/series/id");
  });
  it("registers every emitted rule", () => {
    for (const f of scanDataset({
      authors: [row("a", { name: " Unknown ", website: "ftp://x" })],
    }))
      expect(RULES).toContain(f.rule);
  });
});

describe("merge planning", () => {
  it("requires choices for conflicting personal data, including false versus true", () => {
    const a = row("a", { name: "Name", rating: 5, notes: "A", is_rare: true });
    const b = row("b", {
      name: "Name",
      rating: 1,
      notes: null,
      is_rare: false,
    });
    expect(() => resolvedValues(a, b, {})).toThrow("rating");
    expect(
      resolvedValues(a, b, { rating: "target", is_rare: "source" }),
    ).toEqual({ notes: "A", is_rare: true });
  });
  it("forbids identity, generated and timestamp overrides", () => {
    expect(() =>
      resolvedValues(row("a", { slug: "a" }), row("b", { slug: "b" }), {
        id: "source",
      }),
    ).toThrow("unknown");
  });
  it("blocks the comma-form survivor and parent/child merges", () => {
    const source = row("a", { name: "Solvej Balle" }),
      target = row("b", { name: "Balle, Solvej" });
    expect(
      mergeBlockers("authors", source, target, {
        records: [source, target],
        references: {},
      }).join(),
    ).toContain("without a comma");
    expect(
      mergeBlockers("genres", row("a", { parent_id: "b" }), row("b", {}), {
        records: [],
        references: {},
      }).length,
    ).toBeGreaterThan(0);
  });
  it("blocks colliding collecting targets rather than losing fulfilment history", () => {
    expect(
      mergeBlockers("works", row("a", {}), row("b", {}), {
        records: [],
        references: {
          acquisition_targets: [
            row("x", { work_id: "a" }),
            row("y", { work_id: "b" }),
          ],
        },
      })[0],
    ).toContain("same active acquisition target");
  });
  it("normalizes Unicode deterministically", () => {
    expect(normalize("  CĂRTĂRESCU—Søren  ")).toBe("cartarescu soren");
    expect(identityName("James, M.R.", true)).toBe("m r james");
  });
});

describe("identity boundaries from real catalogue patterns", () => {
  it.each([
    ["Book Volume 1", "Book Volume 2"],
    ["The Story II", "The Story III"],
    ["Import 2024", "Import 2025"],
  ])("keeps numbered identities separate: %s / %s", (a, b) => {
    expect(
      duplicates({ works: [row("a", { title: a }), row("b", { title: b })] }),
    ).toHaveLength(0);
  });
  it("does not fuzzy-match semantically distinct taxonomy", () => {
    expect(
      duplicates({
        subjects: [
          row("a", { name: "Microeconomics" }),
          row("b", { name: "Macroeconomics" }),
        ],
      }),
    ).toHaveLength(0);
  });
  it("recognizes recorded aliases and external identities", () => {
    expect(
      duplicates({
        authors: [
          row("a", { name: "George Eliot", real_name: "Mary Ann Evans" }),
          row("b", { name: "Mary Ann Evans" }),
        ],
      })[0].rule,
    ).toBe("duplicate-alias");
    expect(
      duplicates({
        authors: [
          row("a", { name: "George Eliot", open_library_key: "OL123A" }),
          row("b", { name: "Mary Ann Evans", open_library_key: "OL123A" }),
        ],
      })[0].rule,
    ).toBe("duplicate-identifier");
  });
  it("requires manual review for locked metadata", () => {
    const found = scanDataset({
      works: [row("a", { title: " Book ", metadata_locked: true })],
    });
    expect(
      found.find((f) => f.rule === "name-whitespace")?.resolution.kind,
    ).toBe("review");
  });
  it("keeps coupled metadata and assessment values together", () => {
    const a = row("a", {
      metadata_source: "open_library",
      metadata_source_id: "OL1W",
      is_rare: true,
      hunt_assessed_on: "2026-01-01",
    });
    const b = row("b", {
      metadata_source: "google_books",
      metadata_source_id: "gb1",
      is_rare: false,
      hunt_assessed_on: null,
    });
    expect(
      resolvedValues(a, b, {
        $metadata_provenance: "source",
        $availability_assessment: "target",
      }),
    ).toEqual({ metadata_source: "open_library", metadata_source_id: "OL1W" });
  });
});

it("does not confuse shared collective placeholders with personal aliases", () => {
  expect(
    duplicates({
      authors: [
        row("a", { name: "First Collective", real_name: "Various Members" }),
        row("b", { name: "Second Collective", real_name: "Various Members" }),
        row("c", { name: "Various" }),
        row("d", { name: "Art Collective", real_name: "Various" }),
      ],
    }),
  ).toHaveLength(0);
});
