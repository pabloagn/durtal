import { neon } from "@neondatabase/serverless";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: NeonHttpDatabase<typeof schema> | null = null;

export function getDb(): NeonHttpDatabase<typeof schema> {
  if (!_db) {
    // Pages render per request (src/app/layout.tsx). A query during `next build`
    // means some route is being pre-rendered with build-time data.
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
      throw new Error(
        "Database access during `next build`. A route is being pre-rendered; it must render per request.",
      );
    }
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Ensure the environment variable is configured.",
      );
    }
    const sql = neon(url);
    _db = drizzle({ client: sql, schema });
  }
  return _db;
}

/** Convenience alias — call site reads nicely as `db.query.works.findMany(...)` */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
