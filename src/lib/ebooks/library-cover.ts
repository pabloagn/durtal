import type { LibraryEbook } from "./library-queries";
import { isEbookFileDownloadable } from "./conditions";
import { acceptedPublication } from "./publication-evidence";
import { coverKeySha256, parseStageKey } from "./keys";
import { ebookDelivery } from "./delivery/url";
import { signedGoldCoverBase, type SignedDerivedBase } from "./delivery/sign";

export interface EbookCoverImage {
  src: string;
  srcSet: string;
}
/** Build once for the entire library response, including Continue cards. */
export function ebookPageCoverBase(): SignedDerivedBase | undefined {
  return ebookDelivery() === "cloudfront" ? signedGoldCoverBase() : undefined;
}
export function ebookCoverImage(
  ebook: LibraryEbook,
  base?: SignedDerivedBase,
): EbookCoverImage | null {
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
    if (covers.length) {
      const url = (cover: (typeof covers)[number]) =>
        base
          ? `${base.base}${cover.key}?${base.query}`
          : `/api/reader/${ebook.id}/cover?w=${cover.width}`;
      return {
        src: url(covers.at(-1)!),
        srcSet: covers
          .map((cover) => `${url(cover)} ${cover.width}w`)
          .join(", "),
      };
    }
    const legacy = file.coverKey ?? ebook.coverKey;
    if (legacy && coverKeySha256(legacy) === file.sha256) {
      // Legacy covers use the app route; the gold-only policy never signs them.
      const url = (width: number) => `/api/reader/${ebook.id}/cover?w=${width}`;
      return {
        src: url(400),
        srcSet: [240, 400, 800]
          .map((width) => `${url(width)} ${width}w`)
          .join(", "),
      };
    }
  }
  return null;
}
