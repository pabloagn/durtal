"use client";

import {
  FormSection as Section,
  FormColumns,
} from "@/components/shared/form-section";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  INSTANCE_FORMATS,
  INSTANCE_CONDITIONS,
  INSTANCE_STATUSES,
  ACQUISITION_TYPES,
  DISPOSITION_TYPES,
} from "@/lib/types/index";
import type { AppSettings } from "@/lib/actions/settings";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import {
  COPY_CONDITION_LABELS,
  COPY_FORMAT_LABELS,
} from "@/lib/constants/catalogue";
import { enumLabel } from "@/lib/utils/labels";

export interface InstanceDraft {
  locationId: string;
  subLocationId: string;
  format: string;
  condition: string;
  status: string;
  acquisitionType: string;
  acquisitionDate: string;
  acquisitionSource: string;
  acquisitionPrice: string;
  acquisitionCurrency: string;
  isSigned: boolean;
  signedBy: string;
  inscription: string;
  isFirstPrinting: boolean;
  provenance: string;
  hasDustJacket: boolean | null;
  hasSlipcase: boolean | null;
  conditionNotes: string;
  fileSizeBytes: string;
  notes: string;
  lentTo: string;
  lentDate: string;
  dispositionType: string;
  dispositionDate: string;
  dispositionTo: string;
  dispositionPrice: string;
  dispositionCurrency: string;
  dispositionNotes: string;
}

export const EMPTY_INSTANCE: InstanceDraft = {
  locationId: "",
  subLocationId: "",
  format: "paperback",
  condition: "mint",
  status: "available",
  acquisitionType: "",
  acquisitionDate: "",
  acquisitionSource: "",
  acquisitionPrice: "",
  acquisitionCurrency: "",
  isSigned: false,
  signedBy: "",
  inscription: "",
  isFirstPrinting: false,
  provenance: "",
  hasDustJacket: null,
  hasSlipcase: null,
  conditionNotes: "",
  fileSizeBytes: "",
  notes: "",
  lentTo: "",
  lentDate: "",
  dispositionType: "",
  dispositionDate: "",
  dispositionTo: "",
  dispositionPrice: "",
  dispositionCurrency: "",
  dispositionNotes: "",
};

interface LocationOption {
  id: string;
  name: string;
  type: string;
  subLocations: { id: string; name: string }[];
}

/**
 * A new copy's draft: the format, condition and location new copies start
 * with (Settings, General). An empty string is "none".
 */
export function newCopyDraft(
  settings: Pick<AppSettings, "newCopyFormat" | "newCopyCondition">,
  locationId = "",
): InstanceDraft {
  return {
    ...EMPTY_INSTANCE,
    format: settings.newCopyFormat ?? "",
    condition: settings.newCopyCondition ?? "",
    locationId,
  };
}

/** The default location (Settings, General) first; the others keep their order. */
function sortLocations(
  locs: LocationOption[],
  defaultId: string | null,
): LocationOption[] {
  if (!defaultId) return locs;
  return [...locs].sort(
    (a, b) => Number(b.id === defaultId) - Number(a.id === defaultId),
  );
}

interface InstanceFormProps {
  value: InstanceDraft;
  onChange: (draft: InstanceDraft) => void;
  onRemove?: () => void;
  locations: LocationOption[];
  index: number;
}

/** A copy's form values as createInstance and updateInstance take them */
export function instancePayload(draft: InstanceDraft) {
  return {
    locationId: draft.locationId,
    subLocationId: draft.subLocationId || null,
    format: draft.format || null,
    condition: draft.condition || null,
    status:
      (draft.status as
        | "available"
        | "lent_out"
        | "in_transit"
        | "in_storage"
        | "missing"
        | "damaged"
        | "deaccessioned") || "available",
    acquisitionType: draft.acquisitionType || null,
    acquisitionDate: draft.acquisitionDate || null,
    acquisitionSource: draft.acquisitionSource || null,
    acquisitionPrice: draft.acquisitionPrice || null,
    acquisitionCurrency: draft.acquisitionCurrency || null,
    isSigned: draft.isSigned,
    signedBy: draft.signedBy || null,
    inscription: draft.inscription || null,
    isFirstPrinting: draft.isFirstPrinting,
    provenance: draft.provenance || null,
    hasDustJacket: draft.hasDustJacket,
    hasSlipcase: draft.hasSlipcase,
    conditionNotes: draft.conditionNotes || null,
    fileSizeBytes: draft.fileSizeBytes
      ? parseInt(draft.fileSizeBytes, 10)
      : null,
    notes: draft.notes || null,
    lentTo: draft.lentTo || null,
    lentDate: draft.lentDate || null,
    dispositionType:
      (draft.dispositionType as
        | "sold"
        | "donated"
        | "gifted"
        | "traded"
        | "lost"
        | "stolen"
        | "destroyed"
        | "returned"
        | "expired") || null,
    dispositionDate: draft.dispositionDate || null,
    dispositionTo: draft.dispositionTo || null,
    dispositionPrice: draft.dispositionPrice || null,
    dispositionCurrency: draft.dispositionCurrency || null,
    dispositionNotes: draft.dispositionNotes || null,
  };
}

export function InstanceForm({
  value,
  onChange,
  onRemove,
  locations,
  index,
}: InstanceFormProps) {
  function update<K extends keyof InstanceDraft>(
    field: K,
    v: InstanceDraft[K],
  ) {
    onChange({ ...value, [field]: v });
  }

  const { newCopyLocationId } = useAppSettings();
  const sortedLocations = sortLocations(locations, newCopyLocationId);
  const selectedLocation = locations.find((l) => l.id === value.locationId);
  const subLocations = selectedLocation?.subLocations ?? [];
  const isDigitalFormat = ["ebook", "pdf", "epub", "audiobook"].includes(
    value.format,
  );
  const isPhysicalFormat = ["hardcover", "paperback"].includes(value.format);

  return (
    <div className="@container rounded-sm border border-glass-border bg-bg-secondary p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-fg-secondary">
          Copy {index + 1}
        </span>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <X className="h-3 w-3" strokeWidth={1.5} />
            Remove
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {/* Location (required) */}
        <FormColumns>
          <Select
            label="Location"
            id={`inst-${index}-location`}
            value={value.locationId}
            onChange={(e) => {
              onChange({
                ...value,
                locationId: e.target.value,
                subLocationId: "",
              });
            }}
            placeholder="Select location..."
            options={sortedLocations.map((l) => ({
              value: l.id,
              label: `${l.name} (${l.type})`,
            }))}
          />
          {subLocations.length > 0 && (
            <Select
              label="Sub-location"
              id={`inst-${index}-sublocation`}
              value={value.subLocationId}
              onChange={(e) => update("subLocationId", e.target.value)}
              placeholder="Optional..."
              options={subLocations.map((s) => ({
                value: s.id,
                label: s.name,
              }))}
            />
          )}
        </FormColumns>

        {/* Format & Condition */}
        <FormColumns>
          <Select
            label="Format"
            id={`inst-${index}-format`}
            value={value.format}
            onChange={(e) => update("format", e.target.value)}
            placeholder="Select format..."
            options={INSTANCE_FORMATS.map((f) => ({
              value: f,
              label: COPY_FORMAT_LABELS[f],
            }))}
          />
          <Select
            label="Condition"
            id={`inst-${index}-condition`}
            value={value.condition}
            onChange={(e) => update("condition", e.target.value)}
            placeholder="Select condition..."
            options={INSTANCE_CONDITIONS.map((c) => ({
              value: c,
              label: COPY_CONDITION_LABELS[c],
            }))}
          />
        </FormColumns>

        {isPhysicalFormat && (
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={value.hasDustJacket === true}
                onChange={(e) => update("hasDustJacket", e.target.checked)}
                className="rounded-sm"
              />
              Dust jacket
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={value.hasSlipcase === true}
                onChange={(e) => update("hasSlipcase", e.target.checked)}
                className="rounded-sm"
              />
              Slipcase
            </label>
          </div>
        )}

        {/* Status */}
        <Select
          label="Status"
          id={`inst-${index}-status`}
          value={value.status}
          onChange={(e) => update("status", e.target.value)}
          options={INSTANCE_STATUSES.map((s) => ({
            value: s,
            label: enumLabel(s),
          }))}
        />

        {/* Lending (shown when status is lent_out) */}
        {value.status === "lent_out" && (
          <Section title="Lending" defaultOpen>
            <Input
              label="Lent to"
              id={`inst-${index}-lent-to`}
              value={value.lentTo}
              onChange={(e) => update("lentTo", e.target.value)}
              placeholder="Name of person..."
            />
            <DatePicker
              label="Lent date"
              id={`inst-${index}-lent-date`}
              value={value.lentDate}
              onChange={(v) => update("lentDate", v)}
            />
          </Section>
        )}

        {/* Disposition (shown when status is deaccessioned) */}
        {value.status === "deaccessioned" && (
          <Section title="Disposition" defaultOpen>
            <Select
              label="Disposition type"
              id={`inst-${index}-disposition-type`}
              value={value.dispositionType}
              onChange={(e) => update("dispositionType", e.target.value)}
              placeholder="Select..."
              options={DISPOSITION_TYPES.map((t) => ({
                value: t,
                label: enumLabel(t),
              }))}
            />
            <FormColumns>
              <DatePicker
                label="Disposition date"
                id={`inst-${index}-disposition-date`}
                value={value.dispositionDate}
                onChange={(v) => update("dispositionDate", v)}
              />
              <Input
                label="Disposed to"
                id={`inst-${index}-disposition-to`}
                value={value.dispositionTo}
                onChange={(e) => update("dispositionTo", e.target.value)}
                placeholder="Person or organisation..."
              />
            </FormColumns>
            <FormColumns>
              <Input
                label="Price"
                id={`inst-${index}-disposition-price`}
                type="number"
                step="0.01"
                value={value.dispositionPrice}
                onChange={(e) => update("dispositionPrice", e.target.value)}
                placeholder="0.00"
              />
              <Input
                label="Currency"
                id={`inst-${index}-disposition-currency`}
                value={value.dispositionCurrency}
                onChange={(e) =>
                  update(
                    "dispositionCurrency",
                    e.target.value.toUpperCase().slice(0, 3),
                  )
                }
                placeholder="EUR"
                maxLength={3}
              />
            </FormColumns>
            <Textarea
              label="Disposition notes"
              id={`inst-${index}-disposition-notes`}
              value={value.dispositionNotes}
              onChange={(e) => update("dispositionNotes", e.target.value)}
              placeholder="Notes about this disposition..."
            />
          </Section>
        )}

        {/* Acquisition */}
        <Section title="Acquisition">
          <FormColumns>
            <Select
              label="Type"
              id={`inst-${index}-acq-type`}
              value={value.acquisitionType}
              onChange={(e) => update("acquisitionType", e.target.value)}
              placeholder="Select..."
              options={ACQUISITION_TYPES.map((t) => ({
                value: t,
                label: enumLabel(t),
              }))}
            />
            <DatePicker
              label="Date"
              id={`inst-${index}-acq-date`}
              value={value.acquisitionDate}
              onChange={(v) => update("acquisitionDate", v)}
            />
          </FormColumns>
          <Input
            label="Source"
            id={`inst-${index}-acq-source`}
            value={value.acquisitionSource}
            onChange={(e) => update("acquisitionSource", e.target.value)}
            placeholder="Amazon, Waterstones, estate sale..."
          />
          <FormColumns>
            <Input
              label="Price"
              id={`inst-${index}-acq-price`}
              type="number"
              step="0.01"
              value={value.acquisitionPrice}
              onChange={(e) => update("acquisitionPrice", e.target.value)}
              placeholder="29.99"
            />
            <Input
              label="Currency"
              id={`inst-${index}-acq-currency`}
              value={value.acquisitionCurrency}
              onChange={(e) =>
                update(
                  "acquisitionCurrency",
                  e.target.value.toUpperCase().slice(0, 3),
                )
              }
              placeholder="EUR"
              maxLength={3}
            />
          </FormColumns>
        </Section>

        {/* Collector Details */}
        <Section title="Collector details">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={value.isSigned}
                onChange={(e) => update("isSigned", e.target.checked)}
                className="rounded-sm"
              />
              Signed
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={value.isFirstPrinting}
                onChange={(e) => update("isFirstPrinting", e.target.checked)}
                className="rounded-sm"
              />
              First printing
            </label>
          </div>
          {value.isSigned && (
            <>
              <Input
                label="Signed by"
                id={`inst-${index}-signed-by`}
                value={value.signedBy}
                onChange={(e) => update("signedBy", e.target.value)}
              />
              <Textarea
                label="Inscription"
                id={`inst-${index}-inscription`}
                value={value.inscription}
                onChange={(e) => update("inscription", e.target.value)}
              />
            </>
          )}
          <Textarea
            label="Provenance"
            id={`inst-${index}-provenance`}
            value={value.provenance}
            onChange={(e) => update("provenance", e.target.value)}
            placeholder="Provenance notes..."
          />
        </Section>

        {/* Digital Details */}
        {isDigitalFormat && (
          <Section title="Digital details">
            <Input
              label="File size (bytes)"
              id={`inst-${index}-file-size`}
              type="number"
              value={value.fileSizeBytes}
              onChange={(e) => update("fileSizeBytes", e.target.value)}
            />
          </Section>
        )}

        {/* Notes */}
        <Section title="Notes">
          <Textarea
            label="Notes"
            id={`inst-${index}-notes`}
            value={value.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Personal notes about this copy..."
          />
        </Section>
      </div>
    </div>
  );
}
