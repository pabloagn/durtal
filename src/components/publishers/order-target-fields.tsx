"use client";
import { useEffect, useState } from "react";
import { getOrderAcquisitionOptions } from "@/lib/actions/publishers";
import { Select } from "@/components/ui/select";
export interface OrderTargetValue {
  acquisitionTargetId: string;
  editionId: string;
}
export function OrderTargetFields({
  workId,
  value,
  onChange,
}: {
  workId: string;
  value: OrderTargetValue;
  onChange: (v: OrderTargetValue) => void;
}) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof getOrderAcquisitionOptions>
  > | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError(false);
    getOrderAcquisitionOptions(workId)
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [workId]);
  if (error)
    return (
      <p role="alert" className="text-sm text-accent-red">
        Could not load edition preferences. Reopen the form to try again.
      </p>
    );
  if (!data)
    return (
      <p className="text-xs text-fg-muted">Loading edition preferences…</p>
    );
  const editions = data.editions.filter(
    (e) =>
      !value.acquisitionTargetId ||
      data.matches.some(
        (m) => m.targetId === value.acquisitionTargetId && m.editionId === e.id,
      ),
  );
  return (
    <div className="space-y-3 border-t border-glass-border pt-3">
      <Select
        label="Acquisition target"
        placeholder="No target"
        value={value.acquisitionTargetId}
        onChange={(e) => {
          const t = data.targets.find((t) => t.target.id === e.target.value);
          onChange({
            acquisitionTargetId: e.target.value,
            editionId: t?.target.editionId ?? "",
          });
        }}
        options={data.targets
          .filter(
            (t) =>
              t.state !== "received" ||
              t.target.id === value.acquisitionTargetId,
          )
          .map((t) => ({
            value: t.target.id,
            label: t.publisher
              ? `${t.publisher.name} edition`
              : t.edition
                ? `${t.edition.title} · ${t.edition.publisher ?? ""} · ${t.edition.isbn13 ?? t.edition.language}`
                : "Any edition",
          }))}
      />
      <Select
        label="Ordered edition"
        placeholder="Not identified yet"
        value={value.editionId}
        onChange={(e) => onChange({ ...value, editionId: e.target.value })}
        options={editions.map((e) => ({
          value: e.id,
          label: `${e.title} · ${e.publisher ?? "Unspecified publisher"} · ${e.isbn13 ?? e.language}${e.publicationYear ? ` · ${e.publicationYear}` : ""}`,
        }))}
      />
      {value.acquisitionTargetId && !value.editionId && (
        <p className="text-xs text-fg-muted">
          Identify the matching edition before marking this purchase as
          received. Add an edition on the book page if needed.
        </p>
      )}
    </div>
  );
}
