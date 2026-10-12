import { lookupSettingsSchema, type LookupSettings } from "@/lib/validations/reader-lookup";
import { defaultLookupSettings } from "./sources";
export const LOOKUP_SETTINGS_KEY = "durtal-lookup-settings";
export const LOOKUP_SETTINGS_CHANGED = "durtal:lookup-settings";
export function readLocalLookupSettings(): LookupSettings {
  try {
    const raw = localStorage.getItem(LOOKUP_SETTINGS_KEY);
    if (!raw || raw.length > 170000) return defaultLookupSettings();
    const parsed = lookupSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultLookupSettings();
  } catch { return defaultLookupSettings(); }
}
export function writeLocalLookupSettings(input: unknown): void {
  const parsed = lookupSettingsSchema.safeParse(input);
  if (!parsed.success) return;
  try { localStorage.setItem(LOOKUP_SETTINGS_KEY, JSON.stringify(parsed.data)); } catch {}
  window.dispatchEvent(new CustomEvent(LOOKUP_SETTINGS_CHANGED, { detail: parsed.data }));
}
/** Wait for a displayed frame before starting a settings-only server action. */
export function afterLookupFirstPaint(callback: () => void): () => void {
  let second: number | null = null;
  const first = requestAnimationFrame(() => { second = requestAnimationFrame(callback); });
  return () => { cancelAnimationFrame(first); if (second !== null) cancelAnimationFrame(second); };
}
