"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { appSettings, locations } from "@/lib/db/schema";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import { databaseErrorCode } from "@/lib/db/errors";
import { DEFAULT_CURRENCY } from "@/lib/constants/currencies";
import {
  appSettingsInputSchema,
  type AppSettingsInput,
  type NewBookStatus,
} from "@/lib/validations/settings";
import type { InstanceCondition, InstanceFormat } from "@/lib/types";

/** The app-wide settings (the app_settings row). */
export interface AppSettings {
  /** Status a new book starts with in the add-book wizard */
  newBookStatus: NewBookStatus;
  /** ISO 639 code: a new book's language when its source gives none */
  newBookLanguage: string;
  /** Where a new copy starts; null: pick a location for each copy */
  newCopyLocationId: string | null;
  /** Format a new copy starts with; null: none */
  newCopyFormat: InstanceFormat | null;
  /** Condition a new copy starts with; null: none */
  newCopyCondition: InstanceCondition | null;
  /** New orders start in it; spending totals list it first */
  homeCurrency: string;
}

/** The values before migration 0052: the same as its seeded row, without a location. */
const DEFAULT_SETTINGS: AppSettings = {
  newBookStatus: "tracked",
  newBookLanguage: "en",
  newCopyLocationId: null,
  newCopyFormat: "paperback",
  newCopyCondition: "mint",
  homeCurrency: DEFAULT_CURRENCY,
};

const SETTINGS_COLUMNS = {
  newBookStatus: appSettings.newBookStatus,
  newBookLanguage: appSettings.newBookLanguage,
  newCopyLocationId: appSettings.newCopyLocationId,
  newCopyFormat: appSettings.newCopyFormat,
  newCopyCondition: appSettings.newCopyCondition,
  homeCurrency: appSettings.homeCurrency,
};

/** A stored row as settings: a value the app no longer offers falls back to its default. */
function toSettings(row: Record<keyof AppSettings, unknown>): AppSettings {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const field = appSettingsInputSchema.shape[key].safeParse(row[key]);
    if (field.success && field.data !== undefined) settings[key] = field.data;
  }
  return settings as unknown as AppSettings;
}

/** PostgreSQL: the table does not exist (migration 0052 has not run). */
const NO_TABLE = "42P01";

const readSettingsRow = cached(
  async () => {
    const [row] = await db.select(SETTINGS_COLUMNS).from(appSettings).limit(1);
    return row ?? null;
  },
  ["app-settings"],
  [CACHE_TAGS.settings],
);

/** The app-wide settings: the defaults until the settings row exists. */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const row = await readSettingsRow();
    return row ? toSettings(row) : DEFAULT_SETTINGS;
  } catch (error) {
    if (databaseErrorCode(error) === NO_TABLE) return DEFAULT_SETTINGS;
    throw error;
  }
}

type Saved = { ok: true; settings: AppSettings } | { ok: false; error: string };

/**
 * Change one or more app-wide settings. Problems come back as
 * `{ ok: false, error }`: thrown messages are hidden in production.
 */
export async function updateAppSettings(input: AppSettingsInput): Promise<Saved> {
  const parsed = appSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the settings" };
  }
  const change = parsed.data;
  const gone = { ok: false, error: "This location no longer exists. Reload the page." } as const;
  if (change.newCopyLocationId) {
    const [location] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.id, change.newCopyLocationId))
      .limit(1);
    if (!location) return gone;
  }
  try {
    const now = new Date();
    const [row] = await db
      .insert(appSettings)
      .values({ id: true, ...change, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.id, set: { ...change, updatedAt: now } })
      .returning(SETTINGS_COLUMNS);
    invalidate(CACHE_TAGS.settings);
    // Every page reads the settings through the root layout
    revalidatePath("/", "layout");
    return { ok: true, settings: toSettings(row) };
  } catch (error) {
    const code = databaseErrorCode(error);
    if (code === "23503") return gone;
    if (code === NO_TABLE) {
      return { ok: false, error: "The database needs migration 0052 before settings can be saved" };
    }
    throw error;
  }
}

/**
 * Drop every cached list (locations, taxonomy, recommenders and the rest),
 * so the next page load reads the database again. Use it after a change
 * made outside the app, such as a script.
 */
export async function refreshCachedData(): Promise<{ ok: true; tags: number }> {
  const tags = Object.values(CACHE_TAGS);
  invalidate(...tags);
  revalidatePath("/", "layout");
  return { ok: true, tags: tags.length };
}
