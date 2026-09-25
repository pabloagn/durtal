import { db } from "@/lib/db";
import { authors, countries } from "@/lib/db/schema";
import { gte, lte, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { resolveLegacyNationalityNames } from "@/lib/utils/nationality-param";

/**
 * Resolve an old name-based `nationality` URL param to ISO alpha-2 codes.
 */
export async function resolveLegacyNationalityParam(raw: string): Promise<string[]> {
  const rows = await db
    .select({ code: countries.alpha2, name: countries.name })
    .from(countries);
  return resolveLegacyNationalityNames(raw, rows);
}

/**
 * Build common author filter conditions used across getAuthors, getAuthorsForMap,
 * and getAuthorsForTimeline.
 *
 * `nationalities` holds ISO 3166-1 alpha-2 country codes.
 *
 * Returns `null` when the nationality filter resolves to zero matching countries,
 * signalling the caller to short-circuit with an empty result.
 */
export async function buildAuthorFilterConditions(filters?: {
  nationalities?: string[];
  genders?: string[];
  zodiacSigns?: string[];
  birthYearMin?: number;
  birthYearMax?: number;
  deathYearMin?: number;
  deathYearMax?: number;
  alive?: string | boolean;
}): Promise<SQL[] | null> {
  const conditions: SQL[] = [];

  // Nationality filtering: resolve country codes to IDs
  if (filters?.nationalities?.length) {
    const codes = filters.nationalities.map((c) => c.toUpperCase());
    const countryRows = await db
      .select({ id: countries.id })
      .from(countries)
      .where(inArray(countries.alpha2, codes));
    const countryIds = countryRows.map((c) => c.id);
    if (countryIds.length > 0) {
      conditions.push(inArray(authors.nationalityId, countryIds));
    } else {
      // No matching countries — caller should return empty result
      return null;
    }
  }

  // Gender filtering
  if (filters?.genders?.length) {
    const validGenders = filters.genders.filter(
      (g) => g === "male" || g === "female",
    ) as ("male" | "female")[];
    if (validGenders.length > 0) {
      conditions.push(inArray(authors.gender, validGenders));
    }
  }

  // Zodiac sign filtering (handles "__none__" sentinel for null values)
  if (filters?.zodiacSigns?.length) {
    const hasNone = filters.zodiacSigns.includes("__none__");
    const realSigns = filters.zodiacSigns.filter((z) => z !== "__none__");
    if (hasNone && realSigns.length > 0) {
      // NULL OR one of the listed signs
      conditions.push(
        sql`(${authors.zodiacSign} IS NULL OR ${authors.zodiacSign} = ANY(ARRAY[${sql.join(realSigns.map((s) => sql`${s}`), sql`, `)}]))`,
      );
    } else if (hasNone) {
      conditions.push(isNull(authors.zodiacSign));
    } else {
      conditions.push(inArray(authors.zodiacSign, realSigns));
    }
  }

  // Birth year range
  if (filters?.birthYearMin != null) {
    conditions.push(gte(authors.birthYear, filters.birthYearMin));
  }
  if (filters?.birthYearMax != null) {
    conditions.push(lte(authors.birthYear, filters.birthYearMax));
  }

  // Death year range
  if (filters?.deathYearMin != null) {
    conditions.push(gte(authors.deathYear, filters.deathYearMin));
  }
  if (filters?.deathYearMax != null) {
    conditions.push(lte(authors.deathYear, filters.deathYearMax));
  }

  // Alive / deceased filter (accepts both boolean and string representations)
  const alive = filters?.alive;
  if (alive === true || alive === "true") {
    conditions.push(isNull(authors.deathYear));
  } else if (alive === false || alive === "false") {
    conditions.push(isNotNull(authors.deathYear));
  }

  return conditions;
}
