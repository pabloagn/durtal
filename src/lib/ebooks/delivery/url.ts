import { serverEnv } from "@/lib/env";
import { coverKeySha256, derivedKeyForWidth, ebookDerivedKey, isEbookCoverWidth, parseStageKey, type EbookCoverWidth } from "../keys";
import { isDeliverable, type CatalogueCover, type CatalogueFile } from "./files";
import { signedDerivedUrlBase, signedGoldCoverBase, signedFileUrl, UndeliverableFileError, type SignedDerivedBase } from "./sign";

/*
 * Where the browser reads a file or a cover from (SLN-491): a signed
 * CloudFront URL when EBOOK_DELIVERY=cloudfront (serverEnv refuses that mode
 * without the three CDN variables), else the app's own routes, which stream
 * the same bytes with Range support.
 */

export function ebookDelivery(): "cloudfront" | "app" {
  return serverEnv().EBOOK_DELIVERY;
}

export interface FileUrl {
  url: string;
  /** When a signed URL stops working; null for the app's own route, which does not expire */
  expiresAt: Date | null;
}

/** The URL of one stored file. Throws UndeliverableFileError for a file that must not be served. */
export function fileUrlFor(file: CatalogueFile, now = Date.now()): FileUrl {
  if (!isDeliverable(file)) throw new UndeliverableFileError(file);
  if (ebookDelivery() === "cloudfront") return signedFileUrl(file, now);
  return { url: `/api/ebooks/files/${file.id}`, expiresAt: null };
}

/**
 * The URL of an e-book's cover at one width, or null when it has none. A
 * page of covers passes one `derived` base so it signs once.
 */
export function coverUrlFor(
  cover: CatalogueCover,
  width: EbookCoverWidth,
  derived?: SignedDerivedBase): FileUrl | null {
  if (!cover.sha256 || !isEbookCoverWidth(width)) return null;
  const storedKey = cover.key ?? ebookDerivedKey(cover.sha256, "cover-800.webp");
  const stage = parseStageKey(storedKey);
  if (stage) {
    if (stage.stage !== "gold" || stage.kind !== "derived" ||
        !stage.name?.startsWith("cover-") || stage.sha256 !== cover.sha256 ||
        !cover.widths?.includes(width)) return null;
  } else if (coverKeySha256(storedKey) !== cover.sha256) return null;
  const key = derivedKeyForWidth(storedKey, width);
  if (!key) return null;
  if (ebookDelivery() !== "cloudfront") return { url: `/api/reader/${cover.ebookId}/cover?w=${width}`, expiresAt: null };
  const base = stage ? signedGoldCoverBase() : (derived ?? signedDerivedUrlBase());
  const suffix = stage ? key : `${cover.sha256}/cover-${width}.webp`;
  return {
    url: `${base.base}${suffix}?${base.query}`, expiresAt: base.expiresAt,
  };
}
