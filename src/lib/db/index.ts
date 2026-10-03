import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const url = process.env.PREVIEW_DATABASE_URL;
if (!url || !url.includes("127.0.0.1:55433/sln336_preview")) {
  throw new Error("Preview adapter requires the disposable sln336_preview database");
}
const _db = drizzle(postgres(url, { max: 5 }), { schema });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDb(): any {
  return _db;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = _db as any;
