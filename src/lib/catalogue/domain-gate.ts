import { notFound } from "next/navigation";
import { WORK_DOMAINS } from "./domains";
import type { WorkKind } from "./kinds";

/**
 * A collection's pages exist only once it opens (WORK_DOMAINS[kind].enabled).
 * Call it in the collection's layout: every page below then answers 404.
 */
export function requireEnabledDomain(kind: WorkKind) {
  if (!WORK_DOMAINS[kind].enabled) notFound();
}
