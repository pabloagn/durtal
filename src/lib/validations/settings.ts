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
  })
  .partial();

export type AppSettingsInput = z.input<typeof appSettingsInputSchema>;
