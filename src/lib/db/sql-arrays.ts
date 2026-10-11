import { sql, type SQL } from "drizzle-orm";

/** Drizzle expands raw arrays as row expressions; construct typed SQL arrays. */
export function uuidArraySql(values: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}::uuid`), sql`, `)}]::uuid[]`;
}

export function textArraySql(values: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}::text`), sql`, `)}]::text[]`;
}
