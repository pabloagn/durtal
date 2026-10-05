import { WORK_DOMAINS } from "./domains";
import type { WorkKind } from "./kinds";

/** A work's page: a book in the library, a film, perfume or painting in its own collection */
export function workHref(work: { kind?: string | null; slug: string | null; id?: string }) {
  const base = WORK_DOMAINS[work.kind as WorkKind]?.basePath ?? WORK_DOMAINS.book.basePath;
  return `${base}/${work.slug ?? work.id ?? ""}`;
}
