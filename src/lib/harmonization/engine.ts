import { createHash } from "node:crypto";
import { ENTITIES, fieldLabel, type EntityDefinition } from "./registry";
import {
  closeSpelling,
  displayName,
  identityName,
  isBlank,
  normalize,
  numberSignature,
  stableStringify,
  validIsbn,
} from "./normalize";
import type {
  Category,
  Confidence,
  Dataset,
  Finding,
  RecordRef,
  Resolution,
  Row,
} from "./types";

export const RULES = [
  "duplicate-name",
  "duplicate-spelling",
  "duplicate-alias",
  "duplicate-identifier",
  "author-display-name",
  "name-whitespace",
  "placeholder-name",
  "missing-artwork",
  "missing-edition-cover",
  "missing-venue-poster",
  "multiple-active-artwork",
  "missing-author",
  "missing-edition",
  "invalid-isbn",
  "isbn-disagreement",
  "invalid-url",
  "life-dates",
  "publication-chronology",
  "invalid-measurement",
  "legacy-series",
  "unlinked-publisher",
  "hierarchy-cycle",
  "coordinate-pair",
  "invalid-coordinates",
  "copy-location",
  "shelf-location",
  "loan-details",
  "disposition-details",
  "order-chronology",
  "order-total",
  "order-currency",
  "order-relationships",
  "received-copy",
  "series-position",
  "duplicate-series-position",
  "empty-collection",
] as const;

export function recordRef(
  entity: EntityDefinition,
  row: Row,
  data: Dataset,
): RecordRef {
  const workFor = (id: unknown) => data.works?.find((w) => w.id === id);
  let name = String(row[entity.name] || "Untitled record");
  let href = entity.route;
  let context = entity.label;
  if (
    [
      "works",
      "authors",
      "publishers",
      "series",
      "venues",
      "collections",
      "recommenders",
    ].includes(entity.key)
  )
    href += `/${entity.key === "series" ? row.id : row.slug || row.id}`;
  if (
    entity.key === "editions" ||
    entity.key === "instances" ||
    entity.key === "orders"
  ) {
    const edition =
      entity.key === "instances"
        ? data.editions?.find((e) => e.id === row.edition_id)
        : undefined;
    const work = workFor(edition?.work_id || row.work_id);
    if (entity.key !== "editions") name = String(work?.title || name);
    href =
      entity.key === "orders"
        ? `/provenance`
        : `/library/${work?.slug || work?.id || ""}`;
    context =
      entity.key === "editions"
        ? [row.publication_year, row.language, row.isbn_13 || row.isbn_10]
            .filter(Boolean)
            .join(" · ") || "Edition"
        : entity.key === "instances"
          ? `Copy · ${row.format || "format unknown"}`
          : `Order · ${row.status}`;
  }
  if (entity.key === "sub-locations") href = `/locations`;
  if (entity.key === "custom-taxonomy") {
    const family = data.taxonomy_families?.find((f) => f.id === row.family_id);
    href = `/taxonomy/${family?.slug || ""}`;
    context = String(family?.name || "Custom taxonomy");
  }
  if (entity.key === "authors") {
    const titles = (data.work_authors || [])
      .filter((a) => a.author_id === row.id)
      .map((a) => workFor(a.work_id)?.title)
      .filter(Boolean);
    context = titles.length
      ? `${titles.length} book${titles.length === 1 ? "" : "s"} · ${titles.slice(0, 2).join(", ")}`
      : "No books linked";
  }
  return { id: row.id, name, href, context };
}

/** A conservative identity boundary: different families, places or publication contexts never mix. */
export function sameScope(entity: EntityDefinition, a: Row, b: Row) {
  return (entity.scope || []).every(
    (key) => normalize(a[key]) === normalize(b[key]),
  );
}
export function preferredRecord(entity: EntityDefinition, rows: Row[]) {
  return [...rows].sort((a, b) => {
    if (entity.person) {
      const comma =
        Number(String(a[entity.name]).includes(",")) -
        Number(String(b[entity.name]).includes(","));
      if (comma) return comma;
    }
    // Preserve diacritics when choosing a suggestion, then favor fuller metadata.
    const accents = (r: Row) =>
      (String(r[entity.name]).normalize("NFD").match(/\p{M}/gu) || []).length;
    return (
      accents(b) - accents(a) ||
      Object.values(b).filter((v) => !isBlank(v)).length -
        Object.values(a).filter((v) => !isBlank(v)).length ||
      a.id.localeCompare(b.id)
    );
  })[0];
}

export function scanDataset(data: Dataset): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const authors = new Map((data.authors || []).map((a) => [a.id, a]));
  const workAuthorNames = new Map<string, string[]>();
  for (const link of data.work_authors || []) {
    const list = workAuthorNames.get(String(link.work_id)) || [];
    const author = authors.get(String(link.author_id));
    if (author) list.push(identityName(author.name, true));
    workAuthorNames.set(String(link.work_id), list);
  }
  function add(
    entity: EntityDefinition,
    rows: Row[],
    rule: string,
    category: Category,
    title: string,
    explanation: string,
    evidence: string[],
    resolution: Resolution = { kind: "review" },
    confidence: Confidence = "high",
    priority = 50,
    suffix = "",
  ) {
    const key = `${entity.key}:${rule}:${rows
      .map((r) => r.id)
      .sort()
      .join(":")}${suffix ? `:${suffix}` : ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (resolution.kind === "update" && rows.some((r) => r.metadata_locked)) {
      resolution = { kind: "review" };
      evidence = [
        ...evidence,
        "Metadata is locked; review this record in its editor.",
      ];
    }
    const records = rows.map((r) => recordRef(entity, r, data));
    const fingerprint = createHash("sha256")
      .update(stableStringify({ rule, evidence, records, resolution }))
      .digest("hex");
    findings.push({
      key,
      rule,
      entity: entity.key,
      entityLabel: entity.label,
      category,
      confidence,
      priority,
      title,
      explanation,
      evidence,
      records,
      resolution,
      fingerprint,
      ...(rows.length > 1
        ? { recommendedId: preferredRecord(entity, rows).id }
        : {}),
    });
  }
  for (const entity of ENTITIES) {
    const rows = data[entity.table] || [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (entity.duplicate) {
      const names = new Map(
        rows.map((r) => [r.id, identityName(r[entity.name], entity.person)]),
      );
      const nameForms = new Map(
        rows.map((r) => [
          r.id,
          [
            ...new Set(
              [
                r[entity.name],
                ...(entity.person
                  ? [
                      r.sort_name,
                      r.real_name,
                      r.first_name && r.last_name
                        ? `${r.first_name} ${r.last_name}`
                        : null,
                    ]
                  : []),
              ]
                .filter((v) => !isBlank(v))
                .map((v) => identityName(v, entity.person)),
            ),
          ],
        ]),
      );
      const identifiers = (r: Row) => {
        const keys = entity.person
          ? ["open_library_key", "goodreads_id"]
          : entity.key === "venues"
            ? ["google_place_id"]
            : entity.key === "places"
              ? ["geoname_id", "wikidata_id"]
              : entity.key === "editions"
                ? ["google_books_id", "open_library_key", "asin"]
                : [];
        return [
          ...keys
            .filter((key) => !isBlank(r[key]))
            .map((key) => `external:${key}:${String(r[key]).trim()}`),
          ...(r.metadata_source && r.metadata_source_id
            ? [`external:${r.metadata_source}:${r.metadata_source_id}`]
            : []),
        ];
      };
      const buckets = new Map<string, Row[]>();
      // Deletion neighborhoods find single-character insertions, deletions and substitutions.
      // This avoids comparing every record to every other record in the catalogue.
      for (const row of rows) {
        const name = names.get(row.id)!;
        if (!name) continue;
        const keys = new Set([...nameForms.get(row.id)!, ...identifiers(row)]);
        for (const form of nameForms.get(row.id)!)
          if (entity.fuzzy && form.length >= 7)
            for (let i = 0; i < form.length; i++)
              keys.add(form.slice(0, i) + form.slice(i + 1));
        for (const key of keys) {
          const bucket = buckets.get(key) || [];
          bucket.push(row);
          buckets.set(key, bucket);
        }
      }
      const pairs = new Set<string>();
      for (const bucket of buckets.values()) {
        for (let i = 0; i < bucket.length; i++)
          for (let j = i + 1; j < bucket.length; j++) {
            const a = bucket[i],
              b = bucket[j];
            const pair = [a.id, b.id].sort().join(":");
            if (pairs.has(pair)) continue;
            pairs.add(pair);
            const na = names.get(a.id)!,
              nb = names.get(b.id)!;
            const sharedIdentifier = identifiers(a).some((id) =>
              identifiers(b).includes(id),
            );
            const nonIdentifying = (name: string) =>
              /^(?:various|unknown|anonymous|uncredited|multiple)(?: (?:authors|members|contributors|artists|editors))?$/.test(
                name,
              );
            const sharedAlias =
              !nonIdentifying(na) &&
              !nonIdentifying(nb) &&
              (nameForms.get(a.id)!.includes(nb) ||
                nameForms.get(b.id)!.includes(na));
            if (
              nonIdentifying(na) ||
              nonIdentifying(nb) ||
              !sameScope(entity, a, b) ||
              numberSignature(na) !== numberSignature(nb) ||
              (!sharedIdentifier &&
                !sharedAlias &&
                (!entity.fuzzy || !closeSpelling(na, nb)))
            )
              continue;
            if (
              entity.key === "works" &&
              a.series_id &&
              a.series_id === b.series_id &&
              a.series_position &&
              b.series_position &&
              Number(a.series_position) !== Number(b.series_position)
            )
              continue;
            const rule = sharedIdentifier
              ? "duplicate-identifier"
              : na === nb
                ? "duplicate-name"
                : sharedAlias
                  ? "duplicate-alias"
                  : "duplicate-spelling";
            let confidence: Confidence =
              sharedIdentifier || sharedAlias ? "high" : "medium";
            const evidence = [
              sharedIdentifier
                ? "Both records share an external catalogue identifier."
                : na === nb
                  ? "Names match after normalizing accents, punctuation, spacing and name order."
                  : sharedAlias
                    ? "A recorded alternative, real or sort name matches the other record."
                    : "Names differ by a single character; this is a suggestion, not an identity match.",
            ];
            if (entity.person) {
              if (
                a.birth_year &&
                b.birth_year &&
                a.birth_year !== b.birth_year
              ) {
                confidence = "low";
                evidence.push(
                  `Birth years conflict: ${a.birth_year} / ${b.birth_year}. Verify the person.`,
                );
              }
              if (
                a.open_library_key &&
                b.open_library_key &&
                a.open_library_key !== b.open_library_key
              ) {
                confidence = "low";
                evidence.push("External author identifiers differ.");
              }
              if (String(a.name).includes(",") !== String(b.name).includes(","))
                evidence.push(
                  "The name without a comma is the canonical name to retain.",
                );
            }
            if (entity.key === "works") {
              const aa = workAuthorNames.get(a.id) || [],
                ba = workAuthorNames.get(b.id) || [];
              if (
                aa.length &&
                ba.length &&
                !aa.some((name) => ba.includes(name))
              ) {
                if (!sharedIdentifier) continue;
                confidence = "low";
                evidence.push(
                  "The shared external identifier conflicts with different credited authors. Verify identity carefully.",
                );
              }
              if (!aa.length || !ba.length) {
                confidence = "low";
                evidence.push(
                  "One or both books have no author; title alone cannot establish identity.",
                );
              } else if (aa.some((name) => ba.includes(name)))
                evidence.push(
                  "At least one author matches, including normalized author-name variants.",
                );
              if (
                a.original_year &&
                b.original_year &&
                a.original_year !== b.original_year
              ) {
                if (confidence === "high") confidence = "medium";
                evidence.push(
                  `Original years differ: ${a.original_year} / ${b.original_year}.`,
                );
              }
              evidence.push(
                "All editions and physical or digital copies remain separate after a book merge.",
              );
            }
            if (entity.key === "editions") {
              if (
                a.isbn_13 &&
                b.isbn_13 &&
                normalize(a.isbn_13) !== normalize(b.isbn_13)
              )
                continue;
              if (
                a.isbn_10 &&
                b.isbn_10 &&
                normalize(a.isbn_10) !== normalize(b.isbn_10)
              )
                continue;
              confidence = "low";
              evidence.push(
                "Same work, language, binding and year. Printings can still be distinct; review both editions on the book page.",
              );
            }
            add(
              entity,
              [a, b],
              rule,
              "duplicates",
              "Possible duplicate",
              "Review the evidence, choose the record to keep, and reconcile any differing values before merging.",
              evidence,
              entity.merge ? { kind: "merge" } : { kind: "review" },
              confidence,
              confidence === "high"
                ? rule === "duplicate-name"
                  ? 97
                  : rule === "duplicate-identifier"
                    ? 95
                    : 80
                : 70,
            );
          }
      }
    }
    for (const row of rows) {
      const name = String(row[entity.name] || "");
      if (name && name !== name.trim().replace(/\s+/g, " "))
        add(
          entity,
          [row],
          "name-whitespace",
          "metadata",
          "Unnecessary spacing",
          "Trim surrounding whitespace and collapse repeated spaces.",
          [
            `Current: “${name}”`,
            `Proposed: “${name.trim().replace(/\s+/g, " ")}”`,
          ],
          {
            kind: "update",
            changes: { [entity.name]: name.trim().replace(/\s+/g, " ") },
            label: "Normalize spacing",
          },
          "high",
          35,
        );
      if (/^(unknown|untitled|n\/a|none|null|undefined|\?)$/i.test(name.trim()))
        add(
          entity,
          [row],
          "placeholder-name",
          "metadata",
          "Placeholder name",
          "This may be an import placeholder. Review before changing: some works really are called Untitled.",
          [`Recorded name: ${name}`],
          { kind: "review" },
          "low",
          30,
        );
      if (
        entity.person &&
        displayName(name) !== name &&
        !findings.some(
          (f) =>
            f.category === "duplicates" &&
            f.records.some((r) => r.id === row.id),
        )
      )
        add(
          entity,
          [row],
          "author-display-name",
          "metadata",
          "Name is in catalogue order",
          "Use natural name order for display. Keep the original sort name for reference.",
          [`${name} → ${displayName(name)}`],
          {
            kind: "update",
            changes: {
              name: displayName(name),
              ...(isBlank(row.sort_name) ? { sort_name: name } : {}),
            },
            label: "Use natural name order",
          },
          "high",
          65,
        );
      for (const field of [
        "website",
        "url",
        "goodreads_url",
        "storygraph_url",
        "order_url",
        "tracking_url",
      ]) {
        if (isBlank(row[field])) continue;
        let valid = false;
        try {
          valid = ["http:", "https:"].includes(
            new URL(String(row[field])).protocol,
          );
        } catch {
          /* surfaced below */
        }
        if (!valid)
          add(
            entity,
            [row],
            "invalid-url",
            "metadata",
            "Invalid web address",
            "A web link should be a complete HTTP or HTTPS address.",
            [`${fieldLabel(field)}: ${row[field]}`],
            { kind: "review" },
            "high",
            50,
            field,
          );
      }
      if (entity.mediaOwner)
        for (const type of entity.artwork || []) {
          const assets = (data.media || []).filter(
            (m) =>
              m[entity.mediaOwner!] === row.id &&
              m.type === type &&
              m.is_active &&
              !isBlank(m.s3_key),
          );
          if (assets.length > 1)
            add(
              entity,
              [row],
              "multiple-active-artwork",
              "integrity",
              `Multiple active ${type}s`,
              "Only one image should be active in this role. Choose the intended image in the record’s media manager.",
              [`${assets.length} images are active as ${type}.`],
              { kind: "review" },
              "high",
              80,
              type,
            );
          if (!assets.length) {
            const editions = (data.editions || []).filter(
              (e) => e.work_id === row.id && !isBlank(e.cover_s3_key),
            );
            const reusable =
              type === "poster"
                ? entity.key === "authors" && row.photo_s3_key
                  ? { s3_key: row.photo_s3_key, thumbnail_s3_key: null }
                  : editions.length
                    ? {
                        s3_key: editions[0].cover_s3_key,
                        thumbnail_s3_key: editions[0].thumbnail_s3_key,
                      }
                    : (data.media || []).find(
                        (m) =>
                          m[entity.mediaOwner!] === row.id &&
                          m.type === type &&
                          !isBlank(m.s3_key),
                      )
                : undefined;
            add(
              entity,
              [row],
              "missing-artwork",
              "artwork",
              `Missing ${type}`,
              type === "background"
                ? "The detail page has no active background image. Add one if this record should have a visual header."
                : "This record has no active poster for its catalogue card.",
              [
                reusable
                  ? "An existing image can be reused without downloading or uploading anything."
                  : `No active ${type} is assigned.`,
              ],
              reusable
                ? {
                    kind: "poster",
                    s3Key: String(reusable.s3_key),
                    thumbnailS3Key: reusable.thumbnail_s3_key
                      ? String(reusable.thumbnail_s3_key)
                      : null,
                    label: "Use existing image as poster",
                  }
                : { kind: "review" },
              "high",
              type === "poster" ? 45 : 10,
              type,
            );
          }
        }
      if (row.parent_id) {
        const visited = new Set([row.id]);
        let cursor: Row | undefined = row;
        while (cursor?.parent_id) {
          const parent = String(cursor.parent_id);
          if (visited.has(parent)) {
            add(
              entity,
              [row],
              "hierarchy-cycle",
              "integrity",
              "Circular hierarchy",
              "Following this record’s parents leads back to a record already visited. Review its parent assignment.",
              [
                `Parent chain repeats at ${byId.get(parent)?.[entity.name] || parent}.`,
              ],
              { kind: "review" },
              "high",
              100,
            );
            break;
          }
          visited.add(parent);
          cursor = byId.get(parent);
        }
      }
      if ("latitude" in row || "longitude" in row) {
        if (isBlank(row.latitude) !== isBlank(row.longitude))
          add(
            entity,
            [row],
            "coordinate-pair",
            "integrity",
            "Incomplete coordinates",
            "A map position needs both latitude and longitude.",
            [
              `Latitude: ${row.latitude ?? "missing"}; longitude: ${row.longitude ?? "missing"}`,
            ],
            { kind: "review" },
            "high",
            60,
          );
        if (
          (!isBlank(row.latitude) && Math.abs(Number(row.latitude)) > 90) ||
          (!isBlank(row.longitude) && Math.abs(Number(row.longitude)) > 180)
        )
          add(
            entity,
            [row],
            "invalid-coordinates",
            "integrity",
            "Coordinates outside the map",
            "Latitude must be between −90 and 90, longitude between −180 and 180.",
            [`${row.latitude}, ${row.longitude}`],
            { kind: "review" },
            "high",
            85,
          );
      }
      if (
        entity.key === "authors" &&
        row.birth_year != null &&
        row.death_year != null &&
        Number(row.death_year) < Number(row.birth_year)
      )
        add(
          entity,
          [row],
          "life-dates",
          "integrity",
          "Death precedes birth",
          "The recorded life dates contradict one another.",
          [`Born ${row.birth_year}; died ${row.death_year}.`],
          { kind: "review" },
          "high",
          90,
        );
      if (entity.key === "works") {
        if (!workAuthorNames.get(row.id)?.length && !row.is_anthology)
          add(
            entity,
            [row],
            "missing-author",
            "metadata",
            "No author linked",
            "Attach the creator, or dismiss if this is an anonymous work.",
            ["No work-level author relationship exists."],
            { kind: "review" },
            "high",
            55,
          );
        if (!(data.editions || []).some((e) => e.work_id === row.id))
          add(
            entity,
            [row],
            "missing-edition",
            "metadata",
            "No edition recorded",
            "A tracked book may intentionally have no edition yet. Review if publication details are available.",
            [`Catalogue status: ${row.catalogue_status}`],
            { kind: "review" },
            "low",
            15,
          );
        if (row.series_name && !row.series_id) {
          const matches = (data.series || []).filter(
            (s) => normalize(s.title) === normalize(row.series_name),
          );
          add(
            entity,
            [row],
            "legacy-series",
            "metadata",
            "Series name is not linked",
            "The imported series text is not connected to a series record.",
            [
              `Imported series: ${row.series_name}`,
              `${matches.length} matching series records.`,
            ],
            matches.length === 1
              ? {
                  kind: "update",
                  changes: { series_id: matches[0].id },
                  label: "Link matching series",
                }
              : { kind: "review" },
            "high",
            50,
          );
        }
        if (
          row.series_position &&
          (!row.series_id || !/^\d+(\.\d+)?$/.test(String(row.series_position)))
        )
          add(
            entity,
            [row],
            "series-position",
            "metadata",
            "Series position needs review",
            "A numbered position should have a linked series and a non-negative numeric value.",
            [
              `Position: ${row.series_position}; series: ${row.series_id ? "linked" : "missing"}`,
            ],
            { kind: "review" },
            "medium",
            45,
          );
      }
      if (entity.key === "editions") {
        const work = (data.works || []).find((w) => w.id === row.work_id);
        if (!row.cover_s3_key)
          add(
            entity,
            [row],
            "missing-edition-cover",
            "artwork",
            "Missing edition cover",
            "Add the cover for this specific publication from the book’s editions section.",
            [
              row.cover_source_url
                ? "A source URL is recorded, but no cover has been stored."
                : "No edition cover is stored.",
            ],
            { kind: "review" },
            "high",
            30,
          );
        for (const [field, length] of [
          ["isbn_10", 10],
          ["isbn_13", 13],
        ] as const)
          if (row[field] && !validIsbn(row[field], length))
            add(
              entity,
              [row],
              "invalid-isbn",
              "integrity",
              "ISBN checksum is invalid",
              "This identifier fails its format or check-digit validation. Verify it against the publication.",
              [`${fieldLabel(field)}: ${row[field]}`],
              { kind: "review" },
              "high",
              85,
              field,
            );
        if (
          validIsbn(row.isbn_10, 10) &&
          validIsbn(row.isbn_13, 13) &&
          `978${String(row.isbn_10).replace(/[\s-]/g, "").slice(0, 9)}` !==
            String(row.isbn_13).replace(/[\s-]/g, "").slice(0, 12)
        )
          add(
            entity,
            [row],
            "isbn-disagreement",
            "integrity",
            "ISBNs identify different editions",
            "The ISBN-10 and ISBN-13 are both valid but do not correspond to each other.",
            [`${row.isbn_10} / ${row.isbn_13}`],
            { kind: "review" },
            "high",
            90,
          );
        if (
          work?.original_year &&
          row.publication_year &&
          Number(row.publication_year) < Number(work.original_year)
        )
          add(
            entity,
            [row],
            "publication-chronology",
            "integrity",
            "Edition predates the work",
            "The publication year is earlier than the work’s original year.",
            [`Edition ${row.publication_year}; work ${work.original_year}.`],
            { kind: "review" },
            "high",
            75,
          );
        for (const field of [
          "page_count",
          "height_mm",
          "width_mm",
          "depth_mm",
          "weight_grams",
          "limited_edition_count",
        ])
          if (row[field] != null && Number(row[field]) <= 0)
            add(
              entity,
              [row],
              "invalid-measurement",
              "integrity",
              "Non-positive measurement",
              "A recorded physical measurement or count should be positive.",
              [`${fieldLabel(field)}: ${row[field]}`],
              { kind: "review" },
              "high",
              65,
              field,
            );
        if (
          row.publisher &&
          !(data.edition_publishers || []).some((p) => p.edition_id === row.id)
        )
          add(
            entity,
            [row],
            "unlinked-publisher",
            "metadata",
            "Publisher is only plain text",
            "Connect the imported publisher name to a publishing house to unify its catalogue.",
            [`Imported publisher: ${row.publisher}`],
            { kind: "review" },
            "high",
            40,
          );
      }
      if (entity.key === "venues" && !row.poster_s3_key)
        add(
          entity,
          [row],
          "missing-venue-poster",
          "artwork",
          "Missing place poster",
          "Add an image to make this place recognizable in the catalogue.",
          ["No poster is stored."],
          { kind: "review" },
          "high",
          15,
        );
      if (entity.key === "instances") {
        const location = (data.locations || []).find(
          (l) => l.id === row.location_id,
        );
        const digital = ["ebook", "audiobook", "pdf", "epub"].includes(
          String(row.format),
        );
        const physical = ["hardcover", "paperback"].includes(
          String(row.format),
        );
        if (
          (digital && location?.type === "physical") ||
          (physical && location?.type === "digital")
        )
          add(
            entity,
            [row],
            "copy-location",
            "integrity",
            "Format and location disagree",
            "Check whether the copy’s format or storage location was imported incorrectly.",
            [`${row.format} at ${location?.name} (${location?.type}).`],
            { kind: "review" },
            "medium",
            65,
          );
        if (row.status === "lent_out" && (!row.lent_to || !row.lent_date))
          add(
            entity,
            [row],
            "loan-details",
            "metadata",
            "Loan details are incomplete",
            "This copy is lent out without a borrower or loan date.",
            [
              `Borrower: ${row.lent_to || "missing"}; date: ${row.lent_date || "missing"}`,
            ],
            { kind: "review" },
            "high",
            65,
          );
        if (row.status === "deaccessioned" && !row.disposition_type)
          add(
            entity,
            [row],
            "disposition-details",
            "metadata",
            "Disposition is undocumented",
            "Record how this copy left the library.",
            ["Deaccessioned copy has no disposition type."],
            { kind: "review" },
            "high",
            40,
          );
      }
      if (entity.key === "instances" || entity.key === "orders") {
        const shelfId =
          entity.key === "instances"
            ? row.sub_location_id
            : row.destination_sub_location_id;
        const locationId =
          entity.key === "instances"
            ? row.location_id
            : row.destination_location_id;
        const shelf = (data.sub_locations || []).find((s) => s.id === shelfId);
        if (shelf && shelf.location_id !== locationId)
          add(
            entity,
            [row],
            "shelf-location",
            "integrity",
            "Shelf belongs to another location",
            "The selected shelf and location contradict one another.",
            [`Shelf: ${shelf.name}; parent location does not match.`],
            { kind: "review" },
            "high",
            90,
          );
      }
      if (entity.key === "orders") {
        if (
          (row.shipped_date &&
            String(row.shipped_date) < String(row.order_date)) ||
          (row.actual_delivery_date &&
            String(row.actual_delivery_date) <
              String(row.shipped_date || row.order_date))
        )
          add(
            entity,
            [row],
            "order-chronology",
            "integrity",
            "Acquisition dates are out of order",
            "Shipping should follow ordering, and delivery should follow shipping.",
            [
              `Ordered ${row.order_date}; shipped ${row.shipped_date || "—"}; delivered ${row.actual_delivery_date || "—"}.`,
            ],
            { kind: "review" },
            "high",
            80,
          );
        if (
          row.price != null &&
          row.shipping_cost != null &&
          row.total_cost != null &&
          Math.abs(
            Number(row.price) +
              Number(row.shipping_cost) -
              Number(row.total_cost),
          ) > 0.011
        )
          add(
            entity,
            [row],
            "order-total",
            "metadata",
            "Cost total differs from components",
            "Discounts or fees may explain the difference. Review the acquisition record.",
            [
              `Item ${row.price} + shipping ${row.shipping_cost}; total ${row.total_cost}.`,
            ],
            { kind: "review" },
            "medium",
            55,
          );
        if (
          [row.price, row.shipping_cost, row.total_cost].some(
            (v) => v != null,
          ) &&
          !/^[A-Z]{3}$/.test(String(row.currency || ""))
        )
          add(
            entity,
            [row],
            "order-currency",
            "metadata",
            "Acquisition currency needs review",
            "A monetary amount should have an uppercase three-letter currency code.",
            [`Currency: ${row.currency || "missing"}`],
            { kind: "review" },
            "high",
            55,
          );
        const edition = (data.editions || []).find(
          (e) => e.id === row.edition_id,
        );
        const instance = (data.instances || []).find(
          (i) => i.id === row.instance_id,
        );
        if (
          (edition && edition.work_id !== row.work_id) ||
          (instance && instance.edition_id !== row.edition_id)
        )
          add(
            entity,
            [row],
            "order-relationships",
            "integrity",
            "Acquisition links disagree",
            "The book, edition and received copy must belong to the same publication chain.",
            [
              "At least one linked record belongs to a different book or edition.",
            ],
            { kind: "review" },
            "high",
            100,
          );
        if (
          ["received", "purchased"].includes(String(row.status)) &&
          !row.instance_id
        )
          add(
            entity,
            [row],
            "received-copy",
            "metadata",
            "Received acquisition has no copy",
            "Link the copy that entered the library to complete its provenance.",
            [`Order status: ${row.status}; no copy linked.`],
            { kind: "review" },
            "high",
            60,
          );
      }
      if (
        entity.key === "collections" &&
        !(data.collection_editions || []).some(
          (e) => e.collection_id === row.id,
        )
      )
        add(
          entity,
          [row],
          "empty-collection",
          "metadata",
          "Empty collection",
          "This may be intentional. Add editions or dismiss to keep the empty collection.",
          ["No editions belong to this collection."],
          { kind: "review" },
          "low",
          5,
        );
    }
  }
  const seriesPositions = new Map<string, Row[]>();
  for (const w of data.works || [])
    if (
      w.series_id &&
      w.series_position &&
      /^\d+(\.\d+)?$/.test(String(w.series_position))
    ) {
      const key = `${w.series_id}:${Number(w.series_position)}`;
      const list = seriesPositions.get(key) || [];
      list.push(w);
      seriesPositions.set(key, list);
    }
  for (const rows of seriesPositions.values())
    if (rows.length > 1)
      add(
        ENTITIES[0],
        rows,
        "duplicate-series-position",
        "integrity",
        "Books share a series position",
        "Several works occupy the same numbered place in this series. Check for duplicates or incorrect numbering.",
        [`Series position: ${rows[0].series_position}`],
        { kind: "review" },
        "medium",
        60,
      );
  return findings.sort(
    (a, b) => b.priority - a.priority || a.key.localeCompare(b.key),
  );
}
