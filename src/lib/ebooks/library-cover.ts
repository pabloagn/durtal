import type { LibraryEbook } from "./library-queries";
import { ebookCoverEvidence } from "./cover-evidence";
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
  const evidence = ebookCoverEvidence(ebook);
  if (!evidence) return null;
  const url = (cover: { key: string; width: number }) =>
    base
      ? `${base.base}${cover.key}?${base.query}`
      : `/api/reader/${ebook.id}/cover?w=${cover.width}`;
  if (evidence.covers.length)
    return {
      src: url(evidence.covers.at(-1)!),
      srcSet: evidence.covers
        .map((cover) => `${url(cover)} ${cover.width}w`)
        .join(", "),
    };
  // Legacy covers use the app route; the gold-only policy never signs them.
  const legacy = (width: number) => `/api/reader/${ebook.id}/cover?w=${width}`;
  return {
    src: legacy(400),
    srcSet: [240, 400, 800]
      .map((width) => `${legacy(width)} ${width}w`)
      .join(", "),
  };
}
