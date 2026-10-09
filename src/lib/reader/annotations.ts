import type { DurtalLocator } from "./engine";
import type {
  AnnotationUpsert,
  AnnotationDelete,
} from "@/lib/validations/annotations";

export const ANNOTATION_COLORS = [
  "ochre",
  "sage",
  "slate",
  "rose",
  "violet",
] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export type AnnotationAnchorState =
  | "exact"
  | "healed"
  | "approximate"
  | "orphaned";
export const ANNOTATION_TEXT_LIMIT = 10_000;
export const ANNOTATION_BATCH_LIMIT = 200;
export const annotationCharacterCount = (text: string) =>
  Array.from(text).length;

export interface ReaderAnnotation {
  id: string;
  ebookId: string;
  fileId: string;
  kind: "highlight" | "bookmark";
  style: "highlight" | "underline" | "quote";
  color: AnnotationColor | null;
  locator: DurtalLocator;
  progression: number;
  chapter: string | null;
  text: string | null;
  note: string | null;
  anchorState: AnnotationAnchorState;
  deviceId: string | null;
  clientUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Kept after the full tombstone is purged. Its id may never be reused. */
export interface RetiredAnnotationId {
  id: string;
  ebookId: string;
  retiredAt: string;
}
export type AnnotationMutation =
  | AnnotationUpsert
  | (AnnotationDelete & { op: "delete" });
