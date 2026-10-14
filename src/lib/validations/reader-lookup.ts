import { z } from "zod";

const language = z.string().regex(/^[a-z]{2,3}$/, "Choose a language");

export const lookupSourceSchema = z
  .object({
    language: z.union([language, z.literal("*")]),
    name: z
      .string()
      .trim()
      .min(1, "Give the source a name")
      .max(40, "Use at most 40 characters"),
    url: z
      .string()
      .max(500, "Use at most 500 characters")
      .refine((value) => {
        if (!value.includes("{word}")) return false;
        try {
          const url = new URL(value.replaceAll("{word}", "word"));
          return url.protocol === "https:" && !url.username && !url.password;
        } catch {
          return false;
        }
      }, "Use an https URL containing {word}, without credentials"),
  })
  .strict();

export const lookupSettingsSchema = z
  .object({
    // 2 since SLN-687: a 1 still holding the first defaults gains the English sources
    v: z.union([z.literal(1), z.literal(2)]),
    sources: z.array(lookupSourceSchema).max(50, "Use at most 50 sources"),
    translateTo: language,
  })
  .strict();

export type LookupSource = z.infer<typeof lookupSourceSchema>;
export type LookupSettings = z.infer<typeof lookupSettingsSchema>;
