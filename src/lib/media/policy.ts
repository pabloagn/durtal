import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import type { MediaEntityType } from "@/lib/s3/keys";
import type { MediaType } from "@/lib/types";

/**
 * How an image is shaped on screen. Portrait and landscape slots crop to a
 * focal point; square and native slots show the whole image (contain), so a
 * painting or a perfume bottle is never cut.
 */
export type ImageSlot = "portrait" | "landscape" | "square" | "native";

export interface ImagePolicy {
  slot: ImageSlot;
  fit: "cover" | "contain";
  /** Largest stored size; the aspect ratio is always kept. */
  maxWidth: number;
  maxHeight: number;
  thumbWidth: number;
  thumbHeight: number;
  /** Keep a full-resolution, metadata-free copy beside the display sizes. */
  keepOriginal: boolean;
  /** Every author image (portrait, background, gallery): the shown sizes are
   *  monochrome; a colour copy is kept only for re-tuning. */
  monochrome: boolean;
}

const PORTRAIT: ImagePolicy = {
  slot: "portrait",
  fit: "cover",
  maxWidth: 1600,
  maxHeight: 2400,
  thumbWidth: 800,
  thumbHeight: 1200,
  keepOriginal: false,
  monochrome: false,
};
const SQUARE: ImagePolicy = {
  ...PORTRAIT,
  slot: "square",
  fit: "contain",
  maxWidth: 2000,
  maxHeight: 2000,
  thumbWidth: 1000,
  thumbHeight: 1000,
};
/** Artworks: large, uncropped, with the full-resolution original kept. */
const ARTWORK: ImagePolicy = {
  ...PORTRAIT,
  slot: "native",
  fit: "contain",
  maxWidth: 4096,
  maxHeight: 4096,
  thumbWidth: 1200,
  thumbHeight: 1200,
  keepOriginal: true,
};
const BACKGROUND: ImagePolicy = {
  ...PORTRAIT,
  slot: "landscape",
  maxWidth: 2560,
  maxHeight: 1440,
  thumbWidth: 1280,
  thumbHeight: 720,
};
const GALLERY: ImagePolicy = {
  ...PORTRAIT,
  slot: "native",
  fit: "contain",
  maxWidth: 2400,
  maxHeight: 2400,
  thumbWidth: 800,
  thumbHeight: 800,
};

function workPoster(kind: WorkKind): ImagePolicy {
  const image = WORK_DOMAINS[kind].image;
  if (image.slot === "native") return ARTWORK;
  if (image.slot === "square") return SQUARE;
  return PORTRAIT;
}

/**
 * The processing and presentation policy for one image. A work's domain
 * decides its poster: books and films portrait, perfumes square and
 * contained, paintings large and native. Every image of a person (an
 * author row: writers, translators, directors, perfumers, painters) is
 * monochrome, whatever its type; the slot and sizes follow the type.
 */
export function imagePolicy(
  owner: { type: MediaEntityType; kind?: WorkKind | null },
  mediaType: MediaType,
): ImagePolicy {
  const policy = shapePolicy(owner, mediaType);
  return owner.type === "author" ? { ...policy, monochrome: true } : policy;
}

function shapePolicy(
  owner: { type: MediaEntityType; kind?: WorkKind | null },
  mediaType: MediaType,
): ImagePolicy {
  if (mediaType === "background") return BACKGROUND;
  const artwork =
    owner.type === "art_object" ||
    (owner.type === "work" && owner.kind === "painting");
  if (mediaType === "gallery") return artwork ? ARTWORK : GALLERY;
  switch (owner.type) {
    case "work":
      return workPoster(owner.kind ?? "book");
    case "author":
      return PORTRAIT;
    case "collection":
      return PORTRAIT;
    case "organization":
      return { ...SQUARE, maxWidth: 1600, maxHeight: 1600, thumbWidth: 800, thumbHeight: 800 };
    case "art_object":
      return ARTWORK;
    case "perfume_variant":
      return SQUARE;
  }
}
