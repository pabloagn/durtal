import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { dataFingerprint, type StoredRow } from "./load";
import { existingCopyStampSchema, parseExistingCopyPatch, type ExistingCopyStamp,
  type EditableInstanceMetadataPatch } from "./manual-intents";

/** Explicit descriptive columns. Location, lifecycle status, identity and digital fields
 * are separate choices, never supplied through this metadata patch. */
export const EXISTING_COPY_METADATA_COLUMNS = {
  condition: "condition", hasDustJacket: "has_dust_jacket", hasSlipcase: "has_slipcase",
  conditionNotes: "condition_notes", isSigned: "is_signed", signedBy: "signed_by",
  inscription: "inscription", isFirstPrinting: "is_first_printing", provenance: "provenance",
  acquisitionType: "acquisition_type", acquisitionDate: "acquisition_date",
  acquisitionSource: "acquisition_source", acquisitionPrice: "acquisition_price",
  acquisitionCurrency: "acquisition_currency", dispositionType: "disposition_type",
  dispositionDate: "disposition_date", dispositionTo: "disposition_to",
  dispositionPrice: "disposition_price", dispositionCurrency: "disposition_currency",
  dispositionNotes: "disposition_notes", notes: "notes", lentTo: "lent_to", lentDate: "lent_date",
} as const;
export type ExistingCopyMetadataColumn = typeof EXISTING_COPY_METADATA_COLUMNS[keyof typeof EXISTING_COPY_METADATA_COLUMNS];
const pairs = Object.entries(EXISTING_COPY_METADATA_COLUMNS);
function metadata(row: StoredRow): StoredRow {
  const result: StoredRow = {};
  for (const [, column] of pairs) {
    if (!Object.hasOwn(row, column) || row[column] === undefined)
      throw new Error("Existing copy requires its complete raw metadata snapshot");
    result[column] = row[column];
  }
  // PostgreSQL JSON numbers remain raw in the fingerprint. The catalogue's
  // numeric input schema uses strings; conversion here only validates shape.
  const input = Object.fromEntries(pairs.map(([key, column]) => [key,
    (key === "acquisitionPrice" || key === "dispositionPrice") && typeof row[column] === "number"
      ? String(row[column]) : row[column]]));
  parseExistingCopyPatch(input);
  return result;
}
export function existingCopyMetadataFingerprint(row: StoredRow): string {
  return dataFingerprint(metadata(row));
}
/** Keep all six fractional digits. Date is used only to convert whole seconds
 * and timezone, never to round or compare the copy's concurrency version. */
export function existingCopyStampForRow(row: StoredRow): ExistingCopyStamp {
  if (typeof row.updated_at !== "string") throw new Error("Existing copy timestamp is missing");
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::\d{2})?)$/.exec(row.updated_at);
  if (!match) throw new Error("Existing copy timestamp is not a finite PostgreSQL timestamp");
  const timezone = /^[+-]\d{2}$/.test(match[3]) ? match[3] + ":00" : match[3];
  const whole = new Date(match[1] + timezone);
  if (!Number.isFinite(whole.getTime())) throw new Error("Existing copy timestamp is not finite");
  return existingCopyStampSchema.parse({ updatedAt: whole.toISOString().slice(0, 19) +
    "." + (match[2] ?? "").padEnd(6, "0") + "Z", metadataFingerprint: existingCopyMetadataFingerprint(row) });
}
export async function readExistingCopyStampOn(conn: Db, instanceId: string): Promise<ExistingCopyStamp> {
  const [value] = resultRows<{ row: StoredRow; updatedAt: string }>(await conn.execute(sql`
    select to_jsonb(r) row,
      to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') "updatedAt"
    from instances r where r.id=${instanceId}::uuid and isfinite(r.updated_at)`));
  if (!value) throw new Error("The selected existing copy is unavailable");
  return existingCopyStampSchema.parse({ updatedAt: value.updatedAt,
    metadataFingerprint: existingCopyMetadataFingerprint(value.row) });
}
export interface CopyMetadataProvenance {
  fields: readonly ExistingCopyMetadataColumn[];
  beforeStamp: ExistingCopyStamp;
}
export function copyMetadataProvenance(row: StoredRow, input: EditableInstanceMetadataPatch): CopyMetadataProvenance {
  const patch = parseExistingCopyPatch(input);
  return { fields: Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined)
    .map((key) => EXISTING_COPY_METADATA_COLUMNS[key as keyof typeof EXISTING_COPY_METADATA_COLUMNS]).sort(),
    beforeStamp: existingCopyStampForRow(row) };
}
/** Restore raw database values only after complete original/actual-after proof.
 * Every unclaimed descriptive column must be unchanged as well. */
export function copyMetadataRestoration(before: StoredRow, after: StoredRow,
  marker: CopyMetadataProvenance): EditableInstanceMetadataPatch {
  if (!marker || Object.keys(marker).sort().join(",") !== "beforeStamp,fields" ||
      !Array.isArray(marker.fields) || new Set(marker.fields).size !== marker.fields.length ||
      marker.fields.some((column) => !pairs.some(([, actual]) => actual === column)) ||
      dataFingerprint(existingCopyStampSchema.parse(marker.beforeStamp)) !== dataFingerprint(existingCopyStampForRow(before)))
    throw new Error("Existing copy metadata provenance is incomplete or inconsistent");
  metadata(after);
  const input: Record<string, unknown> = {};
  for (const [key, column] of pairs) {
    if (marker.fields.includes(column)) input[key] =
      (key === "acquisitionPrice" || key === "dispositionPrice") && typeof before[column] === "number"
        ? String(before[column]) : before[column];
    else if (dataFingerprint(before[column]) !== dataFingerprint(after[column]))
      throw new Error("An unclaimed descriptive copy field changed");
  }
  return parseExistingCopyPatch(input);
}
