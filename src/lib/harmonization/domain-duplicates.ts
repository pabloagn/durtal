import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { normalize } from "./normalize";
import type { Confidence, Row } from "./types";

/**
 * Possible duplicate films, perfumes and paintings: two works of one kind
 * with the same title by the same maker (a film's director, a perfume's house,
 * a painting's painter). A remake, a second painting of one subject or a
 * flanker is a different work: a different maker, a different year or a
 * recorded link between the two keeps the pair out.
 */
export const DOMAIN_DUPLICATE_KINDS = ["film", "perfume", "painting"] as const;

/** Who makes each kind of work, in a sentence */
const MAKER: Record<(typeof DOMAIN_DUPLICATE_KINDS)[number], { one: string; date: string }> = {
  film: { one: "director", date: "Release years" },
  perfume: { one: "house", date: "Release years" },
  painting: { one: "painter", date: "Creation years" },
};

interface Maker {
  key: string;
  name: string;
}
export interface DomainDuplicate {
  rows: [Row, Row];
  label: string;
  confidence: Confidence;
  evidence: string[];
}

/** Pairs of one kind and one title that may be the same work */
export function domainDuplicates(rows: Row[]): DomainDuplicate[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const title = normalize(row.title);
    if (!title) continue;
    const key = `${row.kind}:${title}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const found: DomainDuplicate[] = [];
  for (const group of groups.values())
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        const kind = a.kind as (typeof DOMAIN_DUPLICATE_KINDS)[number];
        const maker = MAKER[kind];
        if (!maker) continue;
        if ((a.related as string[]).includes(b.id) || (b.related as string[]).includes(a.id)) continue;
        const ya = a.year as number | null;
        const yb = b.year as number | null;
        if (ya != null && yb != null && Math.abs(ya - yb) > 1) continue;
        const am = a.makers as Maker[];
        const bm = b.makers as Maker[];
        const shared = am.filter((m) => bm.some((n) => n.key === m.key));
        if (am.length && bm.length && !shared.length) continue;
        const evidence = [`Same title: “${a.title}”.`];
        let confidence: Confidence = "high";
        if (shared.length)
          evidence.push(
            `Same ${maker.one}: ${shared.map((m) => m.name).join(", ")}.`,
          );
        else {
          confidence = "low";
          evidence.push(
            `One or both have no ${maker.one} recorded; the title alone cannot establish identity.`,
          );
        }
        if (ya == null || yb == null) {
          if (confidence === "high") confidence = "medium";
          evidence.push(`${maker.date} are not both recorded.`);
        } else if (ya !== yb) {
          if (confidence === "high") confidence = "medium";
          evidence.push(`${maker.date} differ by one: ${ya} / ${yb}.`);
        }
        evidence.push(
          "A merge keeps one record and moves every version, copy, formulation, listing and object to it.",
        );
        found.push({
          rows: [a, b],
          label: WORK_DOMAINS[kind as WorkKind].pluralLabel,
          confidence,
          evidence,
        });
      }
  return found;
}
