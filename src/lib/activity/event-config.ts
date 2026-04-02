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

// ── Description formatting ───────────────────────────────────────────────────

const DESCRIPTION_MAP: Record<string, (m?: ActivityMetadata | null) => string> = {
  "work.created":                    () => "Created this work",
  "work.deleted":                    () => "Deleted this work",
  "work.title_changed":             (m) => m?.oldValue ? `Changed title from "${m.oldValue}" to "${m.newValue}"` : `Set title to "${m?.newValue}"`,
  "work.year_changed":              (m) => m?.oldValue ? `Changed original year from ${m.oldValue} to ${m.newValue}` : `Set original year to ${m?.newValue}`,
  "work.language_changed":          (m) => m?.oldValue ? `Changed original language from "${m.oldValue}" to "${m.newValue}"` : `Set original language to "${m?.newValue}"`,
  "work.catalogue_status_changed":  (m) => m?.oldValue ? `Changed catalogue status from "${m.oldValue}" to "${m.newValue}"` : `Set catalogue status to "${m?.newValue}"`,
  "work.acquisition_priority_changed": (m) => m?.oldValue ? `Changed acquisition priority from "${m.oldValue}" to "${m.newValue}"` : `Set acquisition priority to "${m?.newValue}"`,
  "work.rating_changed":            (m) => m?.oldValue ? `Changed rating from ${m.oldValue} to ${m.newValue}` : `Set rating to ${m?.newValue}`,
  "work.series_changed":            (m) => m?.newValue ? `Added to series "${m.newValue}"` : "Removed from series",
  "work.author_added":              (m) => `Added author ${m?.targetName ?? ""}`,
  "work.author_removed":            (m) => `Removed author ${m?.targetName ?? ""}`,
  "work.poster_uploaded":           () => "Uploaded poster image",
  "work.poster_deleted":            () => "Deleted poster image",
  "work.poster_default_changed":    () => "Changed default poster",
  "work.background_uploaded":       () => "Uploaded background image",
  "work.background_deleted":        () => "Deleted background image",
  "work.background_default_changed":() => "Changed default background",
  "work.gallery_image_added":       () => "Added gallery image",
  "work.gallery_image_removed":     () => "Removed gallery image",
  "work.rematched":                 () => "Rematched with external source",
  "work.taxonomy_added":            (m) => `Added ${m?.taxonomyType ?? "taxonomy"} "${m?.targetName ?? ""}"`,
  "work.taxonomy_removed":          (m) => `Removed ${m?.taxonomyType ?? "taxonomy"} "${m?.targetName ?? ""}"`,
  "work.edition_added":             (m) => m?.editionIsbn ? `Added edition (ISBN: ${m.editionIsbn})` : `Added edition "${m?.targetName ?? ""}"`,
  "work.edition_updated":           (m) => m?.editionIsbn ? `Updated edition (ISBN: ${m.editionIsbn})` : "Updated edition",
  "work.edition_deleted":           (m) => m?.targetName ? `Deleted edition "${m.targetName}"` : "Deleted edition",
  "work.instance_added":            (m) => m?.locationName ? `Added instance at "${m.locationName}"` : "Added instance",
  "work.instance_updated":          () => "Updated instance",
  "work.instance_deleted":          () => "Deleted instance",
  "work.collection_added":          (m) => `Added to collection "${m?.collectionName ?? ""}"`,
  "work.collection_removed":        (m) => `Removed from collection "${m?.collectionName ?? ""}"`,
  "work.comment_added":             () => "Left a comment",

  "author.created":                 () => "Created this author",
  "author.deleted":                 () => "Deleted this author",
  "author.name_changed":            (m) => m?.oldValue ? `Changed name from "${m.oldValue}" to "${m.newValue}"` : `Set name to "${m?.newValue}"`,
  "author.birth_year_changed":      (m) => m?.oldValue ? `Changed birth year from ${m.oldValue} to ${m.newValue}` : `Set birth year to ${m?.newValue}`,
  "author.death_year_changed":      (m) => m?.oldValue ? `Changed death year from ${m.oldValue} to ${m.newValue}` : `Set death year to ${m?.newValue}`,
  "author.gender_changed":          (m) => m?.oldValue ? `Changed gender from "${m.oldValue}" to "${m.newValue}"` : `Set gender to "${m?.newValue}"`,
  "author.nationality_changed":     (m) => m?.oldValue ? `Changed nationality from "${m.oldValue}" to "${m.newValue}"` : `Set nationality to "${m?.newValue}"`,
  "author.biography_changed":       () => "Updated biography",
  "author.birthplace_changed":      (m) => m?.newValue ? `Changed birthplace to "${m.newValue}"` : "Updated birthplace",
  "author.poster_uploaded":         () => "Uploaded portrait",
  "author.poster_deleted":          () => "Deleted portrait",
  "author.poster_default_changed":  () => "Changed default portrait",
  "author.background_uploaded":     () => "Uploaded background image",
  "author.background_deleted":      () => "Deleted background image",
  "author.background_default_changed":() => "Changed default background",
  "author.comment_added":           () => "Left a comment",
};

export function formatEventDescription(
  eventKey: string,
  metadata?: ActivityMetadata | null,
): string {
  const fn = DESCRIPTION_MAP[eventKey];
  if (fn) return fn(metadata);
  // Fallback: humanize the event key
  const parts = eventKey.split(".");
  return parts[parts.length - 1].replace(/_/g, " ");
}
