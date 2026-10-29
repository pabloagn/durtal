import { sql } from "drizzle-orm";

/** Distinct non-book works, including object/variant-level attribution. */
export const blockingPersonCredits = (id: string) => sql`
  select distinct kind, work_id from (
    select w.kind, w.id as work_id from work_credits c join works w on w.id=c.work_id
      where c.person_id=${id}::uuid and w.kind <> 'book'
    union all
    select 'painting' as kind, a.work_id from art_object_credits c join art_objects a on a.id=c.object_id
      where c.person_id=${id}::uuid
    union all
    select 'perfume' as kind, p.work_id from perfume_variant_perfumers c join perfume_variants p on p.id=c.variant_id
      where c.person_id=${id}::uuid
  ) credits`;

export const PERSON_CREDIT_REFUSAL = "Remove their film, painting and perfume credits first.";

export function personCreditRefusal(counts: { kind: string; count: number }[]): string | null {
  if (!counts.length) return null;
  const labels: Record<string, string> = { film: "film", painting: "painting", perfume: "perfume" };
  const parts = counts.map(row => `${row.count} ${labels[row.kind] ?? "work"}${row.count === 1 ? "" : "s"}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Credited on ${list}. Remove those credits first.`;
}
