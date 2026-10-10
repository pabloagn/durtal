import { z } from "zod/v4";
import { idSchema } from "@/lib/validations/helpers";
import {
  deviceClassSchema,
  parseStoredPresentation,
  presentationOverrideSchema,
  presentationSchema,
  resetReaderPreferencesSchema,
  updateReaderPreferencesSchema,
  type DeviceClass,
  type PresentationOverride,
} from "@/lib/validations/reader-preferences";
import { PRESENTATION_DEFAULTS, type PresentationRow } from "./defaults";

export type PreferenceScope = Readonly<{ deviceClass: DeviceClass; ebookId: string | null }>;
export type PreferenceUpdate = z.infer<typeof updateReaderPreferencesSchema>;
export type PreferenceReset = z.infer<typeof resetReaderPreferencesSchema>;
export type PreferenceChange = Readonly<{
  scope: PreferenceScope;
  presentation: Readonly<PresentationOverride> | null;
}>;
export type PreferenceReply =
  | { ok: true; deviceClass: DeviceClass; ebookId: string | null; rows: readonly PresentationRow[] }
  | { ok: false; error: string };

const bookId = idSchema.transform((id) => id.toLowerCase());
export const preferenceReadSchema = z.object({ ebookId: bookId.nullable() }).strict();
export const preferenceAdoptionSchema = z.object({
  deviceClass: deviceClassSchema,
  ebookId: bookId.nullable(),
}).strict();
export const preferenceListSchema = z.object({
  deviceClass: deviceClassSchema,
  page: z.number().int().min(1).max(10000).default(1),
}).strict();

/** Wrap existing committed schemas; UUID canonicalisation never changes their fields. */
export function parsePreferenceUpdate(input: unknown): PreferenceUpdate {
  const value = updateReaderPreferencesSchema.parse(input);
  return {
    ...value,
    ebookId: value.ebookId?.toLowerCase() ?? null,
    ...(value.clearBookOverrideId === undefined ? {} : {
      clearBookOverrideId: value.clearBookOverrideId.toLowerCase(),
    }),
    presentation: definedFields(value.presentation),
  };
}

export function parsePreferenceReset(input: unknown): PreferenceReset {
  const value = resetReaderPreferencesSchema.parse(input);
  return { ...value, ebookId: value.ebookId?.toLowerCase() ?? null };
}

function definedFields(value: PresentationOverride): PresentationOverride {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

function rowFor(rows: readonly PresentationRow[], scope: PreferenceScope) {
  return rows.find((row) => row.deviceClass === scope.deviceClass && row.ebookId === scope.ebookId);
}

function change(scope: PreferenceScope, presentation: PresentationOverride | null): PreferenceChange {
  return Object.freeze({
    scope: Object.freeze({ ...scope }),
    presentation: presentation === null ? null : Object.freeze({ ...presentation }),
  });
}

export function planPreferenceUpdate(rows: readonly PresentationRow[], input: unknown): readonly PreferenceChange[] {
  const value = parsePreferenceUpdate(input);
  const scope = { deviceClass: value.deviceClass, ebookId: value.ebookId };
  const current = parseStoredPresentation(rowFor(rows, scope)?.presentation);
  const presentation = value.ebookId === null
    ? presentationSchema.parse({ ...PRESENTATION_DEFAULTS[value.deviceClass], ...current, ...value.presentation })
    : presentationOverrideSchema.parse({ ...current, ...value.presentation });
  const changes = [change(scope, presentation)];
  if (value.clearBookOverrideId !== undefined) {
    const bookScope = { deviceClass: value.deviceClass, ebookId: value.clearBookOverrideId };
    const existing = rowFor(rows, bookScope);
    if (existing) {
      const remaining = { ...parseStoredPresentation(existing.presentation) };
      for (const key of Object.keys(value.presentation)) delete remaining[key as keyof PresentationOverride];
      changes.push(change(bookScope, Object.keys(remaining).length ? remaining : null));
    }
  }
  return Object.freeze(changes);
}

export function planPreferenceReset(input: unknown): readonly PreferenceChange[] {
  const scope = parsePreferenceReset(input);
  return Object.freeze([change(scope, scope.ebookId === null ? { ...PRESENTATION_DEFAULTS[scope.deviceClass] } : null)]);
}

export function applyPreferenceChanges(rows: readonly PresentationRow[], changes: readonly PreferenceChange[]): readonly PresentationRow[] {
  let result = rows.map((row) => Object.freeze({ ...row, presentation: Object.freeze(parseStoredPresentation(row.presentation)) }));
  for (const item of changes) {
    result = result.filter((row) => row.deviceClass !== item.scope.deviceClass || row.ebookId !== item.scope.ebookId);
    if (item.presentation !== null) result.push(Object.freeze({ ...item.scope, presentation: Object.freeze({ ...item.presentation }) }));
  }
  return Object.freeze(result);
}

/** Guard the caller precondition of effectivePresentation: one exact book, never any book. */
export function scopedPreferenceRows(rows: readonly PresentationRow[], ebookId: string | null): readonly PresentationRow[] {
  const id = ebookId?.toLowerCase() ?? null;
  return applyPreferenceChanges(rows.filter((row) => row.ebookId === null || row.ebookId === id), []);
}
