"use client";

import { useState, useTransition } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { AddressFields } from "./address-manual-form";
import type { GeocodingResult } from "@/app/api/geocode/route";

const COUNTRIES = [
  { value: "AR", label: "Argentina" },
  { value: "AU", label: "Australia" },
  { value: "AT", label: "Austria" },
  { value: "BE", label: "Belgium" },
  { value: "BR", label: "Brazil" },
  { value: "CA", label: "Canada" },
  { value: "CL", label: "Chile" },
  { value: "CN", label: "China" },
  { value: "CO", label: "Colombia" },
  { value: "CZ", label: "Czech Republic" },
  { value: "DK", label: "Denmark" },
  { value: "FI", label: "Finland" },
  { value: "FR", label: "France" },
  { value: "DE", label: "Germany" },
  { value: "GR", label: "Greece" },
  { value: "HU", label: "Hungary" },
  { value: "IN", label: "India" },
  { value: "IE", label: "Ireland" },
  { value: "IT", label: "Italy" },
  { value: "JP", label: "Japan" },
  { value: "MX", label: "Mexico" },
  { value: "NL", label: "Netherlands" },
  { value: "NZ", label: "New Zealand" },
  { value: "NO", label: "Norway" },
  { value: "PL", label: "Poland" },
  { value: "PT", label: "Portugal" },
  { value: "RO", label: "Romania" },
  { value: "RU", label: "Russia" },
  { value: "ZA", label: "South Africa" },
  { value: "KR", label: "South Korea" },
  { value: "ES", label: "Spain" },
  { value: "SE", label: "Sweden" },
  { value: "CH", label: "Switzerland" },
  { value: "TR", label: "Turkey" },
  { value: "GB", label: "United Kingdom" },
  { value: "US", label: "United States" },
  { value: "UY", label: "Uruguay" },
];

interface AddressPostalLookupProps {
  value: AddressFields;
  onChange: (fields: AddressFields) => void;
}

export function AddressPostalLookup({ value, onChange }: AddressPostalLookupProps) {
  const [countryInput, setCountryInput] = useState(value.countryCode || "");
  const [postalInput, setPostalInput] = useState(value.postalCode || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleLookup() {
    if (!postalInput.trim()) {
      setError("Enter a postal code");
      return;
    }
    setError(null);

    startTransition(async () => {
      try {
        const params = new URLSearchParams({
          mode: "postal",
          postalcode: postalInput.trim(),
        });
        if (countryInput) params.set("country", countryInput);

        const res = await fetch(`/api/geocode?${params}`);
        const data = (await res.json()) as { results: GeocodingResult[] };

        if (!data.results?.length) {
          setError("No results found for this postal code");
          return;
        }

        const result = data.results[0];
        onChange({
          street: result.street || value.street,
          city: result.city || "",
          region: result.region || "",
          country: result.country || "",
          countryCode: result.countryCode || countryInput,
          postalCode: result.postalCode || postalInput,
          latitude: result.latitude,
          longitude: result.longitude,
        });
      } catch {
        setError("Lookup failed. Try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <Select
        label="Country"
        id="postal-country"
        value={countryInput}
        onChange={(e) => setCountryInput(e.target.value)}
        options={COUNTRIES}
        placeholder="Select country..."
      />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Postal code"
            id="postal-code"
            value={postalInput}
            onChange={(e) => {
              setPostalInput(e.target.value);
              setError(null);
            }}
            placeholder="1012 AB"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleLookup();
              }
            }}
            error={error ?? undefined}
          />
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={handleLookup}
          disabled={isPending}
          className="mb-[1px]"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          Look up
        </Button>
      </div>
      {value.city && (
        <div className="rounded-sm border border-bg-tertiary bg-bg-primary p-3 text-xs text-fg-secondary">
          <p className="font-medium text-fg-primary">
            {[value.street, value.city, value.region, value.postalCode, value.country]
              .filter(Boolean)
              .join(", ")}
          </p>
          {value.latitude != null && value.longitude != null && (
            <p className="mt-1 font-mono text-fg-muted">
              {value.latitude.toFixed(4)}, {value.longitude.toFixed(4)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
