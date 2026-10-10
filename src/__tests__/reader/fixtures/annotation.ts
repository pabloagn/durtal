import type { ReaderAnnotation } from "@/lib/reader/annotations";
import type { AnnotationUpsert } from "@/lib/validations/annotations";
export const id = (n: number) =>
  `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
export const at = "2026-10-09T12:00:00.000000Z";
export const later = "2026-10-09T12:00:01.000000Z";
export const locator = {
  v: 1 as const,
  fileHash: "a".repeat(64),
  href: "chapter.xhtml",
  sectionIndex: 1,
  progression: 0.2,
  totalProgression: 0.44,
  cfi: "epubcfi(/6/4!/4/2/1:0,/1:0,/1:16)",
  text: { before: "Before. ", highlight: "The quiet glass.", after: " After." },
  pageLabel: "212",
};
export const annotation = (
  patch: Partial<ReaderAnnotation> = {},
): ReaderAnnotation => ({
  id: id(1),
  ebookId: id(2),
  fileId: id(3),
  kind: "highlight",
  style: "highlight",
  color: "ochre",
  locator,
  progression: 0.44,
  chapter: "The Black Mass",
  text: "The quiet glass.",
  note: "My thought",
  anchorState: "exact",
  deviceId: id(4),
  clientUpdatedAt: at,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  ...patch,
});
export const put = (
  patch: Partial<Extract<AnnotationUpsert, { op: "put" }>> = {},
): Extract<AnnotationUpsert, { op: "put" }> => ({
  op: "put",
  id: id(1),
  fileId: id(3),
  kind: "highlight",
  style: "highlight",
  color: "ochre",
  locator,
  text: "The quiet glass.",
  note: "My thought",
  chapter: "The Black Mass",
  clientUpdatedAt: at,
  ...patch,
});
