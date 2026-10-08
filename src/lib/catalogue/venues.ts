export const VENUE_TYPES = [
  "bookshop", "online_store", "cafe", "library", "museum", "gallery",
  "auction_house", "market", "fair", "publisher", "individual", "other",
  "perfumery", "cinema",
] as const;
export type VenueType = (typeof VENUE_TYPES)[number];
export const VENUE_TYPE_LABELS: Record<VenueType, string> = {
  bookshop: "Bookshop", online_store: "Online Store", cafe: "Cafe",
  library: "Library", museum: "Museum", gallery: "Gallery",
  auction_house: "Auction House", market: "Market", fair: "Fair",
  publisher: "Publisher", individual: "Individual", other: "Other",
  perfumery: "Perfumery", cinema: "Cinema",
};
export const VENUE_TYPE_BADGE_VARIANTS: Record<VenueType, "accent" | "gold" | "sage" | "blue" | "muted"> = {
  bookshop: "accent", online_store: "blue", cafe: "gold", library: "sage",
  museum: "sage", gallery: "gold", auction_house: "accent", market: "muted",
  fair: "muted", publisher: "blue", individual: "muted", other: "muted",
  perfumery: "gold", cinema: "blue",
};
