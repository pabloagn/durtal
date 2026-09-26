import { z } from "zod";

export const imageAdjustmentsSchema = z
  .object({
    exposure: z.number().min(-2).max(2).default(0),
    brightness: z.number().min(0).max(200).default(100),
    contrast: z.number().min(0).max(200).default(100),
    saturation: z.number().min(0).max(200).default(100),
    grayscale: z.number().min(0).max(100).default(0),
    sepia: z.number().min(0).max(100).default(0),
    softness: z.number().min(0).max(8).default(0),
  })
  .strict();
export type ImageAdjustments = z.infer<typeof imageAdjustmentsSchema>;
export const DEFAULT_IMAGE_ADJUSTMENTS = imageAdjustmentsSchema.parse({});

export function enforceImagePolicy(
  settings: ImageAdjustments,
  monochrome: boolean,
): ImageAdjustments {
  return monochrome
    ? { ...settings, saturation: 100, grayscale: 100, sepia: 0 }
    : settings;
}

/** Shared by the editor and every stored-image display; exposure is measured in stops. */
export function imageAdjustmentFilter(
  settings: ImageAdjustments,
  monochrome = false,
): string {
  const s = enforceImagePolicy(settings, monochrome);
  const brightness = Number(
    (s.brightness * Math.pow(2, s.exposure)).toFixed(4),
  );
  return `brightness(${brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%) grayscale(${s.grayscale}%) sepia(${s.sepia}%) blur(${s.softness}px)`;
}

export function s3ImageSource(key: string): string {
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}

/** Only app-owned image routes are editable. Never fetch an arbitrary supplied URL. */
export function imageSourceIdentity(
  source: string,
): { key: string } | { calibreId: number } | null {
  if (!source.startsWith("/") || source.startsWith("//")) return null;
  const url = new URL(source, "https://durtal.invalid");
  if (url.pathname === "/api/s3/read") {
    const key = url.searchParams.get("key");
    return key && key.length <= 1024 ? { key } : null;
  }
  const reader = url.pathname.match(/^\/api\/reader\/(\d+)\/cover$/);
  if (reader && Number.isSafeInteger(Number(reader[1])))
    return { calibreId: Number(reader[1]) };
  return null;
}

export interface StoredImageAdjustments {
  assetKey: string;
  sources: string[];
  settings: ImageAdjustments;
  monochrome: boolean;
}

function selectorFor(source: string): string {
  // encodeURIComponent-generated URLs plus JSON quoting prevent selector injection.
  const quote = (value: string) => JSON.stringify(value).replace(/</g, "\\3c ");
  const direct = `img[src=${quote(source)}]`;
  const retry = `img[src^=${quote(source + (source.includes("?") ? "&" : "?"))}]`;
  const optimized = `img[src^=${quote("/_next/image?url=" + encodeURIComponent(source) + "&")}]`;
  return [direct, retry, optimized]
    .map((s) => `${s}:not([data-adjustment-preview])`)
    .join(",");
}

/** Rules exist only for explicitly edited assets; an empty table changes no images. */
export function imageAdjustmentStyles(rows: StoredImageAdjustments[]): string {
  return rows
    .map((row) => {
      const parsed = imageAdjustmentsSchema.safeParse(row.settings);
      if (!parsed.success) return "";
      const sources = row.sources.filter((source) =>
        imageSourceIdentity(source),
      );
      if (!sources.length) return "";
      return `${sources.map(selectorFor).join(",")} { filter: ${imageAdjustmentFilter(parsed.data, row.monochrome)} !important; }`;
    })
    .join("\n");
}
