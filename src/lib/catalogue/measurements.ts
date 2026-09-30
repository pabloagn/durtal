import { z } from "zod";

const value = z.number().finite().positive().max(1_000_000_000);
export const dimensionSchema = z.object({
  value,
  unit: z.enum(["mm", "cm", "m", "in"]),
});
export const volumeSchema = z.object({ value, unit: z.enum(["ml", "l"]) });
export const durationSchema = z.object({
  value,
  unit: z.enum(["s", "min", "h"]),
});
export function normalizeMeasurement(
  kind: "painting" | "perfume" | "film",
  input: unknown,
) {
  if (kind === "painting") {
    const parsed = dimensionSchema.parse(input);
    return {
      value: parsed.value * { mm: 1, cm: 10, m: 1000, in: 25.4 }[parsed.unit],
      unit: "mm" as const,
    };
  }
  if (kind === "perfume") {
    const parsed = volumeSchema.parse(input);
    return {
      value: parsed.value * { ml: 1, l: 1000 }[parsed.unit],
      unit: "ml" as const,
    };
  }
  if (kind === "film") {
    const parsed = durationSchema.parse(input);
    return {
      value: parsed.value * { s: 1, min: 60, h: 3600 }[parsed.unit],
      unit: "s" as const,
    };
  }
  throw new Error("Unsupported measurement domain");
}
