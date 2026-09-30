/** How a version reached the public; the territory and date live beside it. */
export const FILM_RELEASE_FORMATS = [
  "theatrical",
  "festival",
  "television",
  "home_media",
  "streaming",
  "other",
] as const;
export const FILM_RELEASE_FORMAT_LABELS: Record<
  (typeof FILM_RELEASE_FORMATS)[number],
  string
> = {
  theatrical: "Theatrical",
  festival: "Festival",
  television: "Television",
  home_media: "Home media",
  streaming: "Streaming",
  other: "Other",
};
/** A personal copy is physical (disc, print, tape) or a digital file. */
export const FILM_HOLDING_MEDIA = ["physical", "digital"] as const;
/** Film-level company roles. Distributors are recorded per release. */
export const FILM_ORGANIZATION_ROLES = ["production_company"] as const;
/** 1,000 hours covers the longest published films. */
export const MAX_FILM_RUNTIME_SECONDS = 3_600_000;
