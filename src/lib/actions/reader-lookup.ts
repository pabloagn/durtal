"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import { databaseErrorCode } from "@/lib/db/errors";
import {
  lookupSettingsSchema,
  type LookupSettings,
} from "@/lib/validations/reader-lookup";
import {
  defaultLookupSettings,
  lookupSettings,
} from "@/lib/reader/lookup/sources";

const readLookupSettings = cached(
  async () => {
    const [row] = await db
      .select({ lookupSettings: appSettings.lookupSettings })
      .from(appSettings)
      .limit(1);
    return row?.lookupSettings ?? null;
  },
  ["reader-lookup-settings"],
  [CACHE_TAGS.settings],
);

/** Deferred settings-only read: callers must acquire after the reader's first paint. */
export async function getLookupSettings(): Promise<LookupSettings> {
  try {
    return lookupSettings(await readLookupSettings());
  } catch (error) {
    if (["42P01", "42703"].includes(databaseErrorCode(error) ?? ""))
      return defaultLookupSettings();
    throw error;
  }
}

export async function updateLookupSettings(
  input: unknown,
): Promise<
  { ok: true; settings: LookupSettings } | { ok: false; error: string }
> {
  const parsed = lookupSettingsSchema.nullable().safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the lookup settings",
    };
  try {
    const now = new Date();
    const [row] = await db
      .insert(appSettings)
      .values({ id: true, lookupSettings: parsed.data, updatedAt: now })
      .onConflictDoUpdate({
        target: appSettings.id,
        set: { lookupSettings: parsed.data, updatedAt: now },
      })
      .returning({ lookupSettings: appSettings.lookupSettings });
    invalidate(CACHE_TAGS.settings);
    revalidatePath("/settings/reader");
    return { ok: true, settings: lookupSettings(row.lookupSettings) };
  } catch (error) {
    if (["42P01", "42703"].includes(databaseErrorCode(error) ?? ""))
      return {
        ok: false,
        error:
          "The database needs migration 0086 before lookup settings can be saved",
      };
    throw error;
  }
}
