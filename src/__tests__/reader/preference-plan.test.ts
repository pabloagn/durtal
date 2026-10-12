import { expect, it } from "vitest";
import { PRESENTATION_DEFAULTS, type PresentationRow } from "@/lib/reader/presentation/defaults";
import {
  applyPreferenceChanges, parsePreferenceUpdate, planPreferenceReset, planPreferenceUpdate,
  preferenceAdoptionSchema, preferenceListSchema, scopedPreferenceRows,
} from "@/lib/reader/presentation/preference-plan";

const book = "8d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11";
const other = "0d2b2c8e-1f0a-4f6e-9a51-0c6d3b0b7a11";
const rows: readonly PresentationRow[] = Object.freeze([
  Object.freeze({ deviceClass: "desktop", ebookId: null, presentation: Object.freeze({ fontSizePx: 22, obsolete: true }) }),
  Object.freeze({ deviceClass: "desktop", ebookId: book, presentation: Object.freeze({ fontSizePx: 24, theme: "paper" }) }),
  Object.freeze({ deviceClass: "phone", ebookId: book, presentation: Object.freeze({ fontSizePx: 16 }) }),
]);

it("normalises uppercase UUIDs before merging an exact scope", () => {
  const changes = planPreferenceUpdate(rows, { deviceClass: "desktop", ebookId: book.toUpperCase(), presentation: { lineHeight: 1.8 } });
  expect(changes).toEqual([{ scope: { deviceClass: "desktop", ebookId: book }, presentation: { fontSizePx: 24, theme: "paper", lineHeight: 1.8 } }]);
  expect(rows[1].presentation).toEqual({ fontSizePx: 24, theme: "paper" });
  expect(Object.isFrozen(changes[0].presentation)).toBe(true);
});

it("repairs defaults and clears only edited fields from the same book in one plan", () => {
  const changes = planPreferenceUpdate(rows, { deviceClass: "desktop", ebookId: null, clearBookOverrideId: book.toUpperCase(), presentation: { fontSizePx: 26, theme: undefined } });
  expect(changes).toHaveLength(2);
  expect(changes[0].presentation).toEqual({ ...PRESENTATION_DEFAULTS.desktop, fontSizePx: 26 });
  expect(changes[1].presentation).toEqual({ theme: "paper" });
  const preview = applyPreferenceChanges(rows, changes);
  expect(preview.find((row) => row.deviceClass === "phone")?.presentation).toEqual({ fontSizePx: 16 });
});

it("deletes empty overrides and never creates an absent override during default edits", () => {
  const empty = planPreferenceUpdate(rows, { deviceClass: "phone", ebookId: null, clearBookOverrideId: book, presentation: { fontSizePx: 18 } });
  expect(empty[1].presentation).toBeNull();
  expect(planPreferenceUpdate(rows, { deviceClass: "desktop", ebookId: null, clearBookOverrideId: other, presentation: { fontSizePx: 20 } })).toHaveLength(1);
});

it("keeps book reset and durable complete-default reset distinct", () => {
  expect(planPreferenceReset({ deviceClass: "desktop", ebookId: book })[0].presentation).toBeNull();
  expect(planPreferenceReset({ deviceClass: "desktop", ebookId: null })[0].presentation).toEqual(PRESENTATION_DEFAULTS.desktop);
});

it("refuses invalid/unknown input rather than repairing an incoming patch", () => {
  for (const presentation of [{}, { fontSizePx: 20.5 }, { theme: "white" }, { invented: true }, { fontSizePx: undefined }]) {
    expect(() => parsePreferenceUpdate({ deviceClass: "desktop", ebookId: book, presentation })).toThrow();
  }
  expect(() => parsePreferenceUpdate({ deviceClass: "desktop", ebookId: book, clearBookOverrideId: other, presentation: { fontSizePx: 20 } })).toThrow();
  expect(() => preferenceAdoptionSchema.parse({ deviceClass: "desktop", ebookId: book, legacy: {} })).toThrow();
  expect(() => preferenceListSchema.parse({ deviceClass: "phone", page: 0 })).toThrow();
});

it("filters out other books before effectivePresentation can choose an override", () => {
  const scoped = scopedPreferenceRows([...rows, { deviceClass: "desktop", ebookId: other, presentation: { fontSizePx: 40 } }], book);
  expect(scoped.map((row) => row.ebookId)).not.toContain(other);
  expect(scopedPreferenceRows(rows, null).every((row) => row.ebookId === null)).toBe(true);
});
