/**
 * A read-only database session for enrichment plans (SLN-466). The session
 * refuses writes, and a probe proves it before anything runs, so a plan that
 * reads through it can never write.
 */
import postgres from "postgres";

export function readOnlySession(url: string) {
  return postgres(url, { max: 1, onnotice: () => {}, connection: { default_transaction_read_only: true } });
}

/** A write must fail with "read-only transaction" (25006); the probe changes no row */
export async function assertReadOnly(session: postgres.Sql) {
  const refused = await session`update works set updated_at = updated_at where false`.then(
    () => false,
    (error: { code?: string }) => error.code === "25006",
  );
  if (!refused) throw new Error("The database accepted a write in the read-only session; nothing ran");
}
