import type { ExistingCopyStamp, EditableInstanceMetadataPatch } from "@/lib/ebooks/match/manual-intents";
import type { InstanceDraft } from "@/components/books/instance-form";

export const COPY_METADATA_FIELDS = ["condition", "hasDustJacket", "hasSlipcase", "conditionNotes", "isSigned", "signedBy",
  "inscription", "isFirstPrinting", "provenance", "acquisitionType", "acquisitionDate", "acquisitionSource",
  "acquisitionPrice", "acquisitionCurrency", "dispositionType", "dispositionDate", "dispositionTo", "dispositionPrice",
  "dispositionCurrency", "dispositionNotes", "notes", "lentTo", "lentDate"] as const;
export const COPY_RESERVED_FIELDS = ["locationId", "subLocationId", "format", "fileSizeBytes", "status"] as const;
export const COPY_METADATA_LABELS: Record<typeof COPY_METADATA_FIELDS[number], string> = {
  condition: "Condition", hasDustJacket: "Dust jacket", hasSlipcase: "Slipcase", conditionNotes: "Condition notes",
  isSigned: "Signed", signedBy: "Signed by", inscription: "Inscription", isFirstPrinting: "First printing", provenance: "Provenance",
  acquisitionType: "Acquisition type", acquisitionDate: "Acquisition date", acquisitionSource: "Acquisition source",
  acquisitionPrice: "Acquisition price", acquisitionCurrency: "Acquisition currency", dispositionType: "Disposition type",
  dispositionDate: "Disposition date", dispositionTo: "Disposed to", dispositionPrice: "Disposition price",
  dispositionCurrency: "Disposition currency", dispositionNotes: "Disposition notes", notes: "Notes", lentTo: "Lent to", lentDate: "Lent date",
};
export interface ReviewExistingCopyContext {
  workId: string; editionId: string; instanceId: string; stamp: ExistingCopyStamp;
  metadata: EditableInstanceMetadataPatch;
  original: { locationId: string; subLocationId: string | null; format: string; fileSizeBytes: number | null; status: string };
}
export function existingCopyDraft(context: ReviewExistingCopyContext): InstanceDraft {
  const metadata = context.metadata, original = context.original;
  const value = (key: keyof EditableInstanceMetadataPatch) => String(metadata[key] ?? "");
  return { locationId: original.locationId, subLocationId: original.subLocationId ?? "", format: original.format,
    status: original.status, fileSizeBytes: original.fileSizeBytes === null ? "" : String(original.fileSizeBytes),
    condition: value("condition"), acquisitionType: value("acquisitionType"), acquisitionDate: value("acquisitionDate"),
    acquisitionSource: value("acquisitionSource"), acquisitionPrice: value("acquisitionPrice"), acquisitionCurrency: value("acquisitionCurrency"),
    isSigned: metadata.isSigned ?? false, signedBy: value("signedBy"), inscription: value("inscription"),
    isFirstPrinting: metadata.isFirstPrinting ?? false, provenance: value("provenance"),
    hasDustJacket: metadata.hasDustJacket ?? null, hasSlipcase: metadata.hasSlipcase ?? null, conditionNotes: value("conditionNotes"),
    notes: value("notes"), lentTo: value("lentTo"), lentDate: value("lentDate"), dispositionType: value("dispositionType"),
    dispositionDate: value("dispositionDate"), dispositionTo: value("dispositionTo"), dispositionPrice: value("dispositionPrice"),
    dispositionCurrency: value("dispositionCurrency"), dispositionNotes: value("dispositionNotes") };
}
/** Select only changed descriptive keys. The real shared server codec validates
 * this patch; create defaults and destination/digital fields never enter it. */
export function existingCopyChanges(before: Record<string, unknown>, after: Record<string, unknown>) {
  return { patch: Object.fromEntries(COPY_METADATA_FIELDS.filter((key) => before[key] !== after[key]).map((key) => [key, after[key]])),
    reserved: COPY_RESERVED_FIELDS.filter((key) => before[key] !== after[key]) };
}
export function sameExistingCopyStamp(actual: ExistingCopyStamp | null | undefined, shown: ExistingCopyStamp) {
  return !!actual && actual.updatedAt === shown.updatedAt && actual.metadataFingerprint === shown.metadataFingerprint;
}
