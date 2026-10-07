import { sql } from "drizzle-orm";
import { z } from "zod";
import { resultRows } from "@/lib/harmonization/store";
import type { Db } from "@/lib/catalogue/work-store";
import { IDENTITY_DIMENSIONS } from "./identity";

/*
 * Pablo's switch for the exact-match rules of the identity dimensions
 * (SLN-464, section 7). He turns on only the dimensions whose sample of exact
 * matches he checked, with the link to his approval. Turning rules off writes
 * at once: it only stops writes. Neither ever touches a gated rule
 * (evaluation_gate, SLN-471).
 */

const dimensionsSchema = z.array(z.enum(IDENTITY_DIMENSIONS)).min(1);
const approvalSchema = z.url({ protocol: /^https$/ }).max(2000);

async function rulesOf(conn: Db, dimensions: readonly string[]) {
  const rules = resultRows<{ id: string; key: string; basis: string; enabled: boolean }>(
    await conn.execute(sql`select r.id, d.key, r.basis, r.enabled from enrichment_auto_accept_rules r join enrichment_dimensions d on d.id = r.dimension_id
      where d.retired_in is null and d.key in (${sql.join(dimensions.map((k) => sql`${k}`), sql`, `)}) order by d.key`),
  );
  const gated = rules.filter((r) => r.basis !== "exact_identifier_match");
  if (gated.length) throw new Error(`Refused: ${gated.map((r) => r.key).join(", ")} has a gated rule, which only the evaluation gate turns on`);
  const missing = dimensions.filter((k) => !rules.some((r) => r.key === k));
  return { rules, missing };
}

/** Turns on the named dimensions' exact-match rules (minimum confidence 1), with Pablo's approval link */
export async function enableIdentityRules(conn: Db, input: { dimensions: string[]; approvalUrl: string | undefined; apply: boolean }) {
  if (!input.approvalUrl) throw new Error("--enable-identity-rules needs --approval: the link to Pablo's approval");
  const approvalUrl = approvalSchema.parse(input.approvalUrl);
  const dimensions = dimensionsSchema.parse(input.dimensions);
  const { rules, missing } = await rulesOf(conn, dimensions);
  if (missing.length) throw new Error(`No exact-match rule for ${missing.join(", ")}`);
  if (input.apply)
    await conn.execute(sql`update enrichment_auto_accept_rules set enabled = true, minimum_confidence = 1, approval_url = ${approvalUrl}, enabled_at = now()
      where id in (${sql.join(rules.map((r) => sql`${r.id}::uuid`), sql`, `)}) and basis = 'exact_identifier_match'`);
  return [`${input.apply ? "Turned on" : "Would turn on"} the exact-match rules of ${dimensions.join(", ")} (approval ${approvalUrl})`];
}

/** Turns off the exact-match rules of the named identity dimensions, or of all of them */
export async function disableIdentityRules(conn: Db, input: { dimensions?: string[] }) {
  const dimensions = input.dimensions?.length ? dimensionsSchema.parse(input.dimensions) : IDENTITY_DIMENSIONS;
  const { rules } = await rulesOf(conn, dimensions);
  const on = rules.filter((r) => r.enabled);
  if (on.length)
    await conn.execute(sql`update enrichment_auto_accept_rules set enabled = false
      where id in (${sql.join(on.map((r) => sql`${r.id}::uuid`), sql`, `)}) and basis = 'exact_identifier_match'`);
  return [`Turned off the exact-match rules of ${on.length ? on.map((r) => r.key).join(", ") : "none (all were off)"}`];
}
