"use client";

import { Input } from "@/components/ui/input";

export interface AddressFields {
  street: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
}

interface AddressManualFormProps {
  value: AddressFields;
  onChange: (fields: AddressFields) => void;
}

export function AddressManualForm({ value, onChange }: AddressManualFormProps) {
  function update(field: keyof AddressFields, v: string) {
    onChange({ ...value, [field]: v });
  }

  return (
    <div className="space-y-3">
      <Input
        label="Street"
        id="addr-street"
        value={value.street}
        onChange={(e) => update("street", e.target.value)}
        placeholder="123 Main St"
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="City"
          id="addr-city"
          value={value.city}
          onChange={(e) => update("city", e.target.value)}
          placeholder="Amsterdam"
        />
        <Input
          label="Region"
          id="addr-region"
          value={value.region}
          onChange={(e) => update("region", e.target.value)}
          placeholder="North Holland"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Country"
          id="addr-country"
          value={value.country}
          onChange={(e) => update("country", e.target.value)}
          placeholder="Netherlands"
        />
        <Input
          label="Postal code"
          id="addr-postal"
          value={value.postalCode}
          onChange={(e) => update("postalCode", e.target.value)}
          placeholder="1012 AB"
        />
      </div>
    </div>
  );
}
