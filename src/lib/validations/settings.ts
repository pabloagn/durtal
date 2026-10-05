import { z } from "zod/v4";
import { isSupportedCurrency } from "@/lib/constants/currencies";
import { LANGUAGES } from "@/lib/constants/languages";
import { INSTANCE_CONDITIONS, INSTANCE_FORMATS } from "@/lib/types";

/** The statuses a new book can start with: every status but deaccessioned. */
export const NEW_BOOK_STATUSES = [
  "tracked",
  "shortlisted",
  "wanted",
  "on_order",
  "accessioned",
] as const;
export type NewBookStatus = (typeof NEW_BOOK_STATUSES)[number];

/** A change to the app-wide settings: only the fields that change. */
export const appSettingsInputSchema = z
  .object({
    newBookStatus: z.enum(NEW_BOOK_STATUSES, "Pick a status from the list"),
    newBookLanguage: z
      .string()
      .refine(
        (code) => LANGUAGES.some((language) => language.value === code),
        "Pick a language from the list",
      ),
    newCopyLocationId: z.uuid("Pick a location from the list").nullable(),
    newCopyFormat: z.enum(INSTANCE_FORMATS, "Pick a format from the list").nullable(),
    newCopyCondition: z
      .enum(INSTANCE_CONDITIONS, "Pick a condition from the list")
      .nullable(),
    homeCurrency: z
      .string()
      .refine((code) => isSupportedCurrency(code), "Pick a currency from the list"),
    readingDayStartHour: z.number().int().min(0, "Pick an hour from midnight to 06:00").max(6, "Pick an hour from midnight to 06:00"),
    readingWeekStart: z.union([z.literal(1), z.literal(7)], "A week starts on Monday or Sunday"),
    readingTimerCheckMinutes: z
      .number()
      .int()
      .min(15, "Ask after 15 minutes to 8 hours")
      .max(480, "Ask after 15 minutes to 8 hours"),
    readingRhythmDays: z.number().int().min(1, "Pick 1 to 7 days").max(7, "Pick 1 to 7 days").nullable(),
  })
  .partial();

export type AppSettingsInput = z.input<typeof appSettingsInputSchema>;
