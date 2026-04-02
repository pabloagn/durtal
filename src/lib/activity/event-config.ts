import type { ActivityMetadata } from "./types";

export interface EventDisplayConfig {
  icon: string;
  color: string;
  category: "create" | "update" | "delete" | "media" | "relation" | "comment";
}

const MUTED = "var(--color-fg-muted)";
const SECONDARY = "var(--color-fg-secondary)";
const GOLD = "#b8a04a";
const RED = "#8b5c5c";
const SAGE = "var(--color-accent-sage)";

export const EVENT_CONFIG: Record<string, EventDisplayConfig> = {
  // ── Work events ──────────────────────────────────────────────────────────
  "work.created":                    { icon: "Plus",         color: SAGE,      category: "create" },
  "work.deleted":                    { icon: "Trash2",       color: RED,       category: "delete" },
  "work.title_changed":             { icon: "Pencil",       color: SECONDARY, category: "update" },
  "work.year_changed":              { icon: "Settings2",    color: MUTED,     category: "update" },
  "work.language_changed":          { icon: "Settings2",    color: MUTED,     category: "update" },
  "work.catalogue_status_changed":  { icon: "BookMarked",   color: MUTED,     category: "update" },
  "work.acquisition_priority_changed": { icon: "Settings2", color: MUTED,     category: "update" },
  "work.rating_changed":            { icon: "Star",         color: GOLD,      category: "update" },
  "work.series_changed":            { icon: "List",         color: MUTED,     category: "update" },
  "work.author_added":              { icon: "UserPlus",     color: MUTED,     category: "relation" },
  "work.author_removed":            { icon: "UserMinus",    color: RED,       category: "relation" },
  "work.poster_uploaded":           { icon: "ImagePlus",    color: MUTED,     category: "media" },
  "work.poster_deleted":            { icon: "ImageMinus",   color: RED,       category: "media" },
  "work.poster_default_changed":    { icon: "Image",        color: MUTED,     category: "media" },
  "work.background_uploaded":       { icon: "ImagePlus",    color: MUTED,     category: "media" },
  "work.background_deleted":        { icon: "ImageMinus",   color: RED,       category: "media" },
  "work.background_default_changed":{ icon: "Image",        color: MUTED,     category: "media" },
  "work.gallery_image_added":       { icon: "Images",       color: MUTED,     category: "media" },
  "work.gallery_image_removed":     { icon: "Images",       color: RED,       category: "media" },
  "work.rematched":                 { icon: "RefreshCw",    color: MUTED,     category: "update" },
  "work.taxonomy_added":            { icon: "Tag",          color: MUTED,     category: "relation" },
  "work.taxonomy_removed":          { icon: "Tag",          color: RED,       category: "relation" },
  "work.edition_added":             { icon: "BookOpen",     color: MUTED,     category: "relation" },
  "work.edition_updated":           { icon: "BookOpen",     color: MUTED,     category: "update" },
  "work.edition_deleted":           { icon: "BookOpen",     color: RED,       category: "delete" },
  "work.instance_added":            { icon: "Package",      color: MUTED,     category: "relation" },
  "work.instance_updated":          { icon: "Package",      color: MUTED,     category: "update" },
  "work.instance_deleted":          { icon: "Package",      color: RED,       category: "delete" },
  "work.collection_added":          { icon: "FolderPlus",   color: MUTED,     category: "relation" },
  "work.collection_removed":        { icon: "FolderMinus",  color: RED,       category: "relation" },
  "work.order_updated":              { icon: "Truck",        color: MUTED,     category: "update" },
  "work.comment_added":             { icon: "MessageSquare",color: SECONDARY, category: "comment" },

  // ── Author events ────────────────────────────────────────────────────────
  "author.created":                 { icon: "Plus",         color: SAGE,      category: "create" },
  "author.deleted":                 { icon: "Trash2",       color: RED,       category: "delete" },
  "author.name_changed":            { icon: "Pencil",       color: SECONDARY, category: "update" },
  "author.birth_year_changed":      { icon: "Settings2",    color: MUTED,     category: "update" },
  "author.death_year_changed":      { icon: "Settings2",    color: MUTED,     category: "update" },
  "author.gender_changed":          { icon: "Globe",        color: MUTED,     category: "update" },
  "author.nationality_changed":     { icon: "Globe",        color: MUTED,     category: "update" },
  "author.biography_changed":       { icon: "FileText",     color: MUTED,     category: "update" },
  "author.birthplace_changed":      { icon: "MapPin",       color: MUTED,     category: "update" },
  "author.poster_uploaded":         { icon: "ImagePlus",    color: MUTED,     category: "media" },
  "author.poster_deleted":          { icon: "ImageMinus",   color: RED,       category: "media" },
  "author.poster_default_changed":  { icon: "Image",        color: MUTED,     category: "media" },
  "author.background_uploaded":     { icon: "ImagePlus",    color: MUTED,     category: "media" },
  "author.background_deleted":      { icon: "ImageMinus",   color: RED,       category: "media" },
  "author.background_default_changed":{ icon: "Image",      color: MUTED,     category: "media" },
  "author.comment_added":           { icon: "MessageSquare",color: SECONDARY, category: "comment" },
};

// ── Structured description formatting ─────────────────────────────────────

/** A segment of a formatted event description */
export type DescriptionSegment =
  | { type: "text"; value: string }
  | { type: "label"; value: string };

type DescriptionBuilder = (m?: ActivityMetadata | null) => DescriptionSegment[];

function text(value: string): DescriptionSegment {
  return { type: "text", value };
}

function label(value: string): DescriptionSegment {
  return { type: "label", value };
}

/** Build a "Changed X from A to B" description with styled labels */
function fieldChanged(
  fieldName: string,
  m?: ActivityMetadata | null,
): DescriptionSegment[] {
  if (m?.oldValue) {
    return [
      text(`Changed ${fieldName} from `),
      label(String(m.oldValue)),
      text(" to "),
      label(String(m.newValue)),
    ];
  }
  return [text(`Set ${fieldName} to `), label(String(m?.newValue))];
}

const DESCRIPTION_MAP: Record<string, DescriptionBuilder> = {
  "work.created":                    () => [text("Created this work")],
  "work.deleted":                    () => [text("Deleted this work")],
  "work.title_changed":             (m) => fieldChanged("title", m),
  "work.year_changed":              (m) => fieldChanged("original year", m),
  "work.language_changed":          (m) => fieldChanged("original language", m),
  "work.catalogue_status_changed":  (m) => fieldChanged("catalogue status", m),
  "work.acquisition_priority_changed": (m) => fieldChanged("acquisition priority", m),
  "work.rating_changed":            (m) => fieldChanged("rating", m),
  "work.series_changed":            (m) => m?.newValue
    ? [text("Added to series "), label(String(m.newValue))]
    : [text("Removed from series")],
  "work.author_added":              (m) => [text("Added author "), label(m?.targetName ?? "")],
  "work.author_removed":            (m) => [text("Removed author "), label(m?.targetName ?? "")],
  "work.poster_uploaded":           () => [text("Uploaded poster image")],
  "work.poster_deleted":            () => [text("Deleted poster image")],
  "work.poster_default_changed":    () => [text("Changed default poster")],
  "work.background_uploaded":       () => [text("Uploaded background image")],
  "work.background_deleted":        () => [text("Deleted background image")],
  "work.background_default_changed":() => [text("Changed default background")],
  "work.gallery_image_added":       () => [text("Added gallery image")],
  "work.gallery_image_removed":     () => [text("Removed gallery image")],
  "work.rematched":                 () => [text("Rematched with external source")],
  "work.taxonomy_added":            (m) => [text(`Added ${m?.taxonomyType ?? "taxonomy"} `), label(m?.targetName ?? "")],
  "work.taxonomy_removed":          (m) => [text(`Removed ${m?.taxonomyType ?? "taxonomy"} `), label(m?.targetName ?? "")],
  "work.edition_added":             (m) => m?.editionIsbn
    ? [text("Added edition "), label(`ISBN: ${m.editionIsbn}`)]
    : [text("Added edition "), label(m?.targetName ?? "")],
  "work.edition_updated":           (m) => m?.editionIsbn
    ? [text("Updated edition "), label(`ISBN: ${m.editionIsbn}`)]
    : [text("Updated edition")],
  "work.edition_deleted":           (m) => m?.targetName
    ? [text("Deleted edition "), label(m.targetName)]
    : [text("Deleted edition")],
  "work.instance_added":            (m) => m?.locationName
    ? [text("Added instance at "), label(m.locationName)]
    : [text("Added instance")],
  "work.instance_updated":          () => [text("Updated instance")],
  "work.instance_deleted":          () => [text("Deleted instance")],
  "work.collection_added":          (m) => [text("Added to collection "), label(m?.collectionName ?? "")],
  "work.collection_removed":        (m) => [text("Removed from collection "), label(m?.collectionName ?? "")],
  "work.order_updated":              () => [text("Updated order details")],
  "work.comment_added":             () => [text("Left a comment")],

  "author.created":                 () => [text("Created this author")],
  "author.deleted":                 () => [text("Deleted this author")],
  "author.name_changed":            (m) => fieldChanged("name", m),
  "author.birth_year_changed":      (m) => fieldChanged("birth year", m),
  "author.death_year_changed":      (m) => fieldChanged("death year", m),
  "author.gender_changed":          (m) => fieldChanged("gender", m),
  "author.nationality_changed":     (m) => fieldChanged("nationality", m),
  "author.biography_changed":       () => [text("Updated biography")],
  "author.birthplace_changed":      (m) => m?.newValue
    ? [text("Changed birthplace to "), label(String(m.newValue))]
    : [text("Updated birthplace")],
  "author.poster_uploaded":         () => [text("Uploaded portrait")],
  "author.poster_deleted":          () => [text("Deleted portrait")],
  "author.poster_default_changed":  () => [text("Changed default portrait")],
  "author.background_uploaded":     () => [text("Uploaded background image")],
  "author.background_deleted":      () => [text("Deleted background image")],
  "author.background_default_changed":() => [text("Changed default background")],
  "author.comment_added":           () => [text("Left a comment")],
};

export function formatEventDescription(
  eventKey: string,
  metadata?: ActivityMetadata | null,
): string {
  const fn = DESCRIPTION_MAP[eventKey];
  if (fn) {
    return fn(metadata)
      .map((s) => s.value)
      .join("");
  }
  const parts = eventKey.split(".");
  return parts[parts.length - 1].replace(/_/g, " ");
}

export function formatEventDescriptionSegments(
  eventKey: string,
  metadata?: ActivityMetadata | null,
): DescriptionSegment[] {
  const fn = DESCRIPTION_MAP[eventKey];
  if (fn) return fn(metadata);
  const parts = eventKey.split(".");
  return [text(parts[parts.length - 1].replace(/_/g, " "))];
}
