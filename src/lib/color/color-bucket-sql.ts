import { sql, type AnyColumn } from "drizzle-orm";
import { COLOR_BUCKET_KEYS } from "./color-buckets";

/** The check on a stored cover colour: none, or one of the named colours */
export function colorBucketCheck(column: AnyColumn) {
  return sql`${column} is null or ${column} in (${sql.raw(COLOR_BUCKET_KEYS.map((k) => `'${k}'`).join(", "))})`;
}
