import type { EbookFileEligibility } from "./conditions";
import { isEbookFileDownloadable } from "./conditions";
import { acceptedPublication } from "./publication-evidence";
import { coverKeySha256, parseStageKey } from "./keys";

interface CoverFile extends EbookFileEligibility {
  id: string;
  coverKey: string | null;
}
export interface CoverEvidence {
  id: string;
  sha256: string;
  covers: { key: string; width: number }[];
  legacyKey: string | null;
}
/** Shared by page URL preparation and the app route's fresh catalogue read. */
export function ebookCoverEvidence(ebook: {
  preferredFileId: string | null;
  coverKey: string | null;
  files: readonly CoverFile[];
}): CoverEvidence | null {
  const preferred = ebook.files.find(
    (file) => file.id === ebook.preferredFileId,
  );
  const candidates = [
    ...(preferred ? [preferred] : []),
    ...ebook.files.filter((file) => file !== preferred),
  ];
  for (const file of candidates) {
    if (!isEbookFileDownloadable(file)) continue;
    const publication = acceptedPublication(file.metadata, file);
    const covers =
      publication?.gold
        .flatMap((object) => {
          const parsed = parseStageKey(object.key);
          const match = /^cover-(240|400|800)\.webp$/.exec(parsed?.name ?? "");
          return match ? [{ key: object.key, width: Number(match[1]) }] : [];
        })
        .sort((a, b) => a.width - b.width) ?? [];
    if (covers.length)
      return { id: file.id, sha256: file.sha256, covers, legacyKey: null };
    const legacy = file.coverKey ?? ebook.coverKey;
    if (legacy && coverKeySha256(legacy) === file.sha256)
      return {
        id: file.id,
        sha256: file.sha256,
        covers: [],
        legacyKey: legacy,
      };
  }
  return null;
}
