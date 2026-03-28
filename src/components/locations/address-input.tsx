"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { PenLine, Mail, Map } from "lucide-react";
import { AddressManualForm, type AddressFields } from "./address-manual-form";
import { AddressPostalLookup } from "./address-postal-lookup";
import { Spinner } from "@/components/ui/spinner";

// Leaflet accesses `window` — must skip SSR
const AddressMapPicker = dynamic(
  () => import("./address-map-picker").then((mod) => mod.AddressMapPicker),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[320px] items-center justify-center rounded-sm border border-glass-border bg-bg-primary">
        <Spinner className="h-5 w-5" />
      </div>
    ),
  },
);

export type { AddressFields };

const MODES = [
  { key: "manual", label: "Manual", icon: PenLine },
  { key: "postal", label: "Postal code", icon: Mail },
  { key: "map", label: "Map", icon: Map },
] as const;

type Mode = (typeof MODES)[number]["key"];

export const EMPTY_ADDRESS: AddressFields = {
  street: "",
  city: "",
  region: "",
  country: "",
  countryCode: "",
  postalCode: "",
  latitude: null,
  longitude: null,
};

interface AddressInputProps {
  value: AddressFields;
  onChange: (fields: AddressFields) => void;
}

export function AddressInput({ value, onChange }: AddressInputProps) {
  const [mode, setMode] = useState<Mode>("manual");

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-sm border border-glass-border bg-bg-primary p-0.5">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors ${
              mode === key
                ? "bg-bg-tertiary text-fg-primary"
                : "text-fg-muted hover:text-fg-secondary"
            }`}
          >
            <Icon className="h-3 w-3" strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>

      {/* Active mode */}
      {mode === "manual" && (
        <AddressManualForm value={value} onChange={onChange} />
      )}
      {mode === "postal" && (
        <AddressPostalLookup value={value} onChange={onChange} />
      )}
      {mode === "map" && (
        <AddressMapPicker value={value} onChange={onChange} />
      )}
    </div>
  );
}
