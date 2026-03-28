"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  INSTANCE_FORMATS,
  INSTANCE_CONDITIONS,
  INSTANCE_STATUSES,
  ACQUISITION_TYPES,
  DISPOSITION_TYPES,
} from "@/lib/types/index";

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
  calibreId: string;
  calibreUrl: string;
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
  format: "",
  condition: "",
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
  calibreId: "",
  calibreUrl: "",
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

interface InstanceFormProps {
  value: InstanceDraft;
  onChange: (draft: InstanceDraft) => void;
  onRemove?: () => void;
  locations: LocationOption[];
  index: number;
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-glass-border pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-fg-secondary hover:text-fg-primary"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
        )}
        {title}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

export function InstanceForm({
  value,
  onChange,
  onRemove,
  locations,
  index,
}: InstanceFormProps) {
  function update<K extends keyof InstanceDraft>(field: K, v: InstanceDraft[K]) {
    onChange({ ...value, [field]: v });
  }

  const selectedLocation = locations.find((l) => l.id === value.locationId);
  const subLocations = selectedLocation?.subLocations ?? [];
  const isDigitalFormat = ["ebook", "pdf", "epub", "audiobook"].includes(
    value.format,
  );
  const isPhysicalFormat = ["hardcover", "paperback"].includes(value.format);

  return (
    <div className="rounded-sm border border-glass-border bg-bg-secondary p-4">
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
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Location"
            id={`inst-${index}-location`}
            value={value.locationId}
            onChange={(e) => {
              update("locationId", e.target.value);
              update("subLocationId", "");
            }}
            placeholder="Select location..."
            options={locations.map((l) => ({
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
        </div>

        {/* Format & Condition */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Format"
            id={`inst-${index}-format`}
            value={value.format}
            onChange={(e) => update("format", e.target.value)}
            placeholder="Select format..."
            options={INSTANCE_FORMATS.map((f) => ({
              value: f,
              label: f.replace(/_/g, " "),
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
              label: c.replace(/_/g, " "),
            }))}
          />
        </div>

        {isPhysicalFormat && (
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={value.hasDustJacket === true}
                onChange={(e) => update("hasDustJacket", e.target.checked)}
                className="rounded-sm"
              />
              Dust jacket
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
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
            label: s.replace(/_/g, " "),
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
            <Input
              label="Lent date"
              id={`inst-${index}-lent-date`}
              type="date"
              value={value.lentDate}
              onChange={(e) => update("lentDate", e.target.value)}
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
                label: t.replace(/_/g, " "),
              }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Disposition date"
                id={`inst-${index}-disposition-date`}
                type="date"
                value={value.dispositionDate}
                onChange={(e) => update("dispositionDate", e.target.value)}
              />
              <Input
                label="Disposed to"
                id={`inst-${index}-disposition-to`}
                value={value.dispositionTo}
                onChange={(e) => update("dispositionTo", e.target.value)}
                placeholder="Person or organisation..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
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
            </div>
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
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              id={`inst-${index}-acq-type`}
              value={value.acquisitionType}
              onChange={(e) => update("acquisitionType", e.target.value)}
              placeholder="Select..."
              options={ACQUISITION_TYPES.map((t) => ({
                value: t,
                label: t.replace(/_/g, " "),
              }))}
            />
            <Input
              label="Date"
              id={`inst-${index}-acq-date`}
              type="date"
              value={value.acquisitionDate}
              onChange={(e) => update("acquisitionDate", e.target.value)}
            />
          </div>
          <Input
            label="Source"
            id={`inst-${index}-acq-source`}
            value={value.acquisitionSource}
            onChange={(e) => update("acquisitionSource", e.target.value)}
            placeholder="Amazon, Waterstones, estate sale..."
          />
          <div className="grid grid-cols-2 gap-3">
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
                update("acquisitionCurrency", e.target.value.toUpperCase().slice(0, 3))
              }
              placeholder="EUR"
              maxLength={3}
            />
          </div>
        </Section>

        {/* Collector Details */}
        <Section title="Collector details">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={value.isSigned}
                onChange={(e) => update("isSigned", e.target.checked)}
                className="rounded-sm"
              />
              Signed
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
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
              label="Calibre ID"
              id={`inst-${index}-calibre-id`}
              type="number"
              value={value.calibreId}
              onChange={(e) => update("calibreId", e.target.value)}
            />
            <Input
              label="Calibre URL"
              id={`inst-${index}-calibre-url`}
              value={value.calibreUrl}
              onChange={(e) => update("calibreUrl", e.target.value)}
              placeholder="http://calibre-web:8083/book/..."
            />
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
