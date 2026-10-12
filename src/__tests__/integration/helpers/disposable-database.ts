import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/** Validate the complete connection target before postgres can open a connection. */
export function requireDisposableDatabaseUrl(url: string, database: string) {
  const parsed = new URL(url);
  if (
    !/^sln\d+_[a-z_]+$/.test(database) ||
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== `/${database}` ||
    // Reject every libpq override, including encoded aliases, hostaddr and sockets.
    parsed.search !== "" || parsed.hash !== ""
  ) throw new Error(`Reset requires the explicitly owned local ${database} database`);
  return url;
}

export const permanentResetGuards = {
  ebook_annotation_cursor_no_truncate: "O",
  ebook_annotation_retirement_no_truncate: "O",
  reader_sitting_receipt_no_truncate: "O",
  ebook_upload_operation_immutable_guard: "A",
  ebook_upload_operation_no_removal_guard: "A",
  ebook_upload_capacity_immutable_guard: "A",
  ebook_upload_capacity_no_removal_guard: "A",
} as const;

/**
 * Destroy only an explicitly selected, suite-owned disposable schema, then apply
 * the genuine migration chain. Permanent history is never deleted or truncated:
 * each test receives a newly created schema with every production guard enabled.
 * Persistent test pools must use prepare:false across these schema replacements.
 */
export async function resetDisposableDatabase(
  url: string,
  database: string,
  options: { emptyLocations?: boolean; activateKinds?: boolean } = {},
) {
  requireDisposableDatabaseUrl(url, database);
  // Keep migrations away from bare-SQL/Neon bridge clients' JSON serializers.
  const client = postgres(url, {
    max: 1, prepare: false, onnotice: () => {}, connect_timeout: 5,
    connection: { statement_timeout: 30000, lock_timeout: 5000 },
  });
  try {
    const [target] = await client<{ database: string; owned: boolean }[]>`
      select current_database() as database,
        pg_get_userbyid(datdba) = current_user as owned
      from pg_database where datname = current_database()
    `;
    if (target?.database !== database || !target.owned)
      throw new Error(`Refusing reset of a database not owned by this test: ${database}`);
    await client.begin(async (tx) => {
      await tx.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
      await tx.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
      await tx.unsafe("CREATE SCHEMA public");
    });
    await migrate(drizzle(client), { migrationsFolder: "src/lib/db/migrations" });
    const guards = await client<{ name: string; mode: string }[]>`
      select tgname as name, tgenabled::text as mode from pg_trigger
      join pg_class on pg_class.oid = tgrelid
      join pg_namespace on pg_namespace.oid = relnamespace
      where nspname = 'public' and not tgisinternal
        and tgname = any(${Object.keys(permanentResetGuards)}::text[])
    `;
    const installed = new Map(guards.map((guard) => [guard.name, guard.mode]));
    for (const [name, mode] of Object.entries(permanentResetGuards))
      if (installed.get(name) !== mode) throw new Error(`Reset lost production guard ${name}`);
    if (options.emptyLocations) {
      // Legacy location cleanup also emptied its referencing settings row. These
      // are migration-created seeds in a fresh schema, with no reader history.
      await client`delete from app_settings`;
      await client`delete from locations`;
    }
    if (options.activateKinds) {
      // Existing domain suites simulate future activation in their disposable DB.
      await client`alter table works drop constraint works_kind_enabled_check`;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}
