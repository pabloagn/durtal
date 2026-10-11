import { contentTypeFor, type EbookFormat } from "@/lib/ebooks/formats";
import {
  ebookBronzeKey,
  ebookGoldDerivedKey,
  ebookGoldFileKey,
  ebookSilverKey,
} from "@/lib/ebooks/keys";
import { MEDALLION_VERSION } from "@/lib/ebooks/medallion";

export function publicationFixture(
  format: EbookFormat = "epub",
  sha256 = "ab".repeat(32),
) {
  const reportHash = "cd".repeat(32);
  const object = {
    key: ebookGoldFileKey(sha256, format),
    sha256,
    size: 200,
    contentType: contentTypeFor(format),
  };
  const cover = {
    key: ebookGoldDerivedKey(sha256, format, reportHash, "cover-240.webp"),
    sha256: "12".repeat(32),
    size: 250,
    contentType: "image/webp",
  };
  const marker = {
    key: ebookGoldDerivedKey(sha256, format, reportHash, "manifest.json"),
    sha256: "ef".repeat(32),
    size: 400,
    contentType: "application/json",
  };
  const medallion = {
    version: MEDALLION_VERSION,
    bronze: { ...object, key: ebookBronzeKey(sha256, format) },
    silver: {
      key: ebookSilverKey(sha256, format, reportHash),
      sha256: reportHash,
      size: 300,
      contentType: "application/json",
    },
    validation: {
      integrity: "verified",
      drm: "clear",
      downloadable: true,
      nativeReadable: true,
      reason: null,
    },
    gold: [object, cover, marker],
  };
  return {
    sha256,
    s3Key: object.key,
    sizeBytes: object.size,
    manifestKey: marker.key,
    status: "stored",
    drm: null,
    format,
    metadata: { medallion },
  };
}

/** Same hostile JSON cases exercise runtime validation and the PostgreSQL predicate. */
export function malformedPublicationCases() {
  const file = publicationFixture();
  const m = file.metadata.medallion;
  const originals = m.gold;
  const change = (medallion: unknown) => ({ ...file, metadata: { medallion } });
  return [
    ...originals.flatMap((object, index) =>
      ["key", "sha256", "size", "contentType"].flatMap((field) =>
        [null, {}, [], "invalid", 0, false].map((value) =>
          change({
            ...m,
            gold: originals.map((member, at) =>
              at === index ? { ...object, [field]: value } : member,
            ),
          }),
        ),
      ),
    ),
    ...[null, [], "invalid", 0, false].map((metadata) => ({
      ...file,
      metadata,
    })),
    ...[null, [], "invalid", 0, false, {}].map(change),
    ...["bronze", "silver", "validation", "gold"].flatMap((field) =>
      [null, {}, [], "invalid", 0, false].map((value) =>
        change({ ...m, [field]: value }),
      ),
    ),
    change({ ...m, version: "2" }),
    ...[0, -1, 1.5, "200", null, [], {}, 9007199254740992].map((size) =>
      change({ ...m, bronze: { ...m.bronze, size } }),
    ),
    ...["bronze", "silver"].flatMap((field) =>
      ["key", "sha256", "contentType"].flatMap((property) =>
        [null, {}, [], 1, false, "invalid"].map((value) =>
          change({
            ...m,
            [field]: { ...m[field as "bronze" | "silver"], [property]: value },
          }),
        ),
      ),
    ),
    ...["downloadable", "nativeReadable"].flatMap((field) =>
      [null, {}, [], 1, "true"].map((value) =>
        change({ ...m, validation: { ...m.validation, [field]: value } }),
      ),
    ),
    ...[{}, [], 1, false].map((reason) =>
      change({ ...m, validation: { ...m.validation, reason } }),
    ),
    ...[
      [],
      [originals[0]],
      [originals[0], originals[1]],
      [originals[2], originals[0]],
      [originals[0], originals[1], originals[1], originals[2]],
      [originals[0], null, originals[2]],
      [originals[0], { ...originals[1], sha256: "invalid" }, originals[2]],
      [originals[0], { ...originals[1], size: {} }, originals[2]],
      [
        originals[0],
        { ...originals[1], contentType: "application/json" },
        originals[2],
      ],
      [
        originals[0],
        {
          ...originals[1],
          key: originals[1].key.replace("cd".repeat(32), "12".repeat(32)),
        },
        originals[2],
      ],
      [
        originals[0],
        originals[1],
        {
          ...originals[2],
          key: originals[2].key.replace("cd".repeat(32), "12".repeat(32)),
        },
      ],
      [
        originals[0],
        originals[1],
        { ...originals[2], contentType: "image/webp" },
      ],
      [
        { ...originals[0], sha256: "12".repeat(32) },
        originals[1],
        originals[2],
      ],
      [{ ...originals[0], size: 201 }, originals[1], originals[2]],
    ].map((gold) => change({ ...m, gold })),
    change({ ...m, bronze: { ...m.bronze, sha256: "12".repeat(32) } }),
    change({
      ...m,
      bronze: { ...m.bronze, key: m.bronze.key.replace("/epub/", "/pdf/") },
    }),
    change({
      ...m,
      silver: {
        ...m.silver,
        key: m.silver.key.replace("cd".repeat(32), "12".repeat(32)),
      },
    }),
    { ...file, manifestKey: null },
    { ...file, manifestKey: file.manifestKey + "/other" },
    { ...file, sizeBytes: 201 },
  ];
}
