"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { findTaxonomyNameTwin, type TaxonomyNameTwin } from "@/lib/actions/taxonomy-families";

/**
 * The sibling a name would repeat, accents and case aside (SLN-1016,
 * SLN-1159), looked up as the name is typed. Stale lookups describe nothing;
 * an unchecked name is left to the server, which refuses a twin all the same.
 */
export function useTaxonomyNameTwin(
  familySlug: string,
  name: string,
  place: { parentId?: string | null; exceptId?: string },
  enabled = true,
) {
  const query = name.trim();
  const parentId = place.parentId ?? null;
  const { exceptId } = place;
  const key = `${query}\u0000${parentId ?? ""}`;
  const [found, setFound] = useState<{ key: string; twin: TaxonomyNameTwin | null }>({ key: "", twin: null });
  useEffect(() => {
    if (!enabled || !query) return;
    let live = true;
    const timer = setTimeout(() => {
      findTaxonomyNameTwin(familySlug, query, { parentId, ...(exceptId ? { exceptId } : {}) }).then(
        (twin) => live && setFound({ key, twin }),
        () => live && setFound({ key, twin: null }),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, familySlug, query, parentId, exceptId, key]);
  return enabled && query && found.key === key ? found.twin : null;
}

/** Names the sibling and links it; the dialog's own button saves anyway */
export function NameTwinNotice({
  familySlug,
  twin,
  hierarchical,
}: {
  familySlug: string;
  twin: TaxonomyNameTwin;
  hierarchical: boolean;
}) {
  const where = twin.parentName ? ` under ${twin.parentName}` : hierarchical ? " at the top level" : "";
  return (
    <p role="status" className="text-xs text-fg-secondary">
      This family already has &ldquo;{twin.name}&rdquo;{where}.{" "}
      {twin.saveAnyway ? "You can still use this name. " : "Choose another name. "}
      <Link href={`/taxonomy/${familySlug}/${twin.slug}`} className="text-command touch-hit break-words">
        Open {twin.name}
      </Link>
    </p>
  );
}
