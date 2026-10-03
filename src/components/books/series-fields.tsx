"use client";
import { useId, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export function SeriesFields({
  options,
  seriesId,
  seriesName,
  position,
  onId,
  onName,
  onPosition,
}: {
  options: { value: string; label: string }[];
  seriesId: string;
  seriesName: string;
  position: string;
  onId: (id: string) => void;
  onName: (name: string) => void;
  onPosition: (position: string) => void;
}) {
  const id = useId();
  const [creating, setCreating] = useState(!seriesId && !!seriesName);
  return (
    <section>
      <h3 className="type-group-title mb-3">Series</h3>
      <div className="grid grid-cols-2 gap-3">
        <Select
          id={id}
          label="Series"
          value={creating ? "__new" : seriesId}
          options={[
            ...options,
            { value: "__new", label: "Create a new series…" },
          ]}
          onChange={(event) => {
            const value = event.target.value;
            setCreating(value === "__new");
            onId(value);
            onName("");
            if (!value) onPosition("");
          }}
        />
        <Input
          label="Series Position"
          value={position}
          onChange={(event) => onPosition(event.target.value)}
          placeholder="e.g. 1, 2.5"
          disabled={!seriesId && !creating}
        />
      </div>
      {creating && (
        <div className="mt-3">
          <Input
            label="New series name"
            value={seriesName}
            onChange={(event) => onName(event.target.value)}
            maxLength={300}
            placeholder="Series title"
            required
          />
          <p className="mt-1 text-xs text-fg-secondary">
            Created when you save the book. An existing series with the same
            name will be reused.
          </p>
        </div>
      )}
    </section>
  );
}
