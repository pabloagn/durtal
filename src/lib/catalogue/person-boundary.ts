import { sql } from "drizzle-orm";
import { authors } from "@/lib/db/schema";
import type { WorkKind } from "./kinds";

export function personDomainCondition(kind: WorkKind) {
  return sql`exists (select 1 from person_domains pd where pd.person_id = ${authors.id} and pd.kind = ${kind})`;
}
export const bookPersonCondition = personDomainCondition("book");
